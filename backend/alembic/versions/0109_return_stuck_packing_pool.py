"""Возврат зависшего пула «На упаковке» у аннулированных задач и вычеркнутых строк.

Пул адресуется по строке задачи, а состав правился в том же статусе, в котором
товар уже уезжает в зону упаковки: удалённая строка уносила свой пул из-под
возврата, и он навсегда оставался в корзине «На упаковке» — в остатках товар
числился на упаковке у аннулированного документа. Журнал append-only, поэтому
разбор — компенсирующие движения packing/good → storage/good в исходные места.

Revision ID: 0109
Revises: 0108
Create Date: 2026-09-04
"""

from __future__ import annotations

revision = "0109"
down_revision = "0108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from datetime import UTC, datetime
    from uuid import uuid4

    from alembic import op

    conn = op.get_bind()
    now = datetime.now(UTC).isoformat()

    # Строки, чей пул на упаковке уже некому вернуть: документ аннулирован/удалён
    # либо сама строка вычеркнута из состава.
    stuck = conn.exec_driver_sql(
        """
        SELECT l.id AS line_id, l.product_id, l.product_name, l.product_sku,
               l.color_id, l.color_name, l.size_id, l.size_name, d.client_id,
                 COALESCE(SUM(CASE WHEN zr.to_op = 'packing' AND zr.to_quality = 'good'
                                   THEN zr.qty ELSE 0 END), 0)
               - COALESCE(SUM(CASE WHEN zr.from_op = 'packing' AND zr.from_quality = 'good'
                                   THEN zr.qty ELSE 0 END), 0) AS pool
        FROM shipment_lines l
        JOIN shipment_docs d ON d.id = l.doc_id
        JOIN zone_relocations zr ON zr.shipment_line_id = l.id
        WHERE d.status = 'cancelled'
           OR COALESCE(d.is_deleted, 0) = 1
           OR COALESCE(l.is_deleted, 0) = 1
        GROUP BY l.id, d.client_id
        HAVING COALESCE(SUM(CASE WHEN zr.to_op = 'packing' AND zr.to_quality = 'good'
                                 THEN zr.qty ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN zr.from_op = 'packing' AND zr.from_quality = 'good'
                                 THEN zr.qty ELSE 0 END), 0) > 0
        """
    ).mappings().all()

    for line in stuck:
        line_id = line["line_id"]

        # Куда вернуть: нетто исходных мест передачи (откуда товар уехал на упаковку).
        targets = conn.exec_driver_sql(
            """
            SELECT zone_id, MIN(zone_name) AS zone_name, SUM(net) AS net FROM (
                SELECT from_zone_id AS zone_id, from_zone_name AS zone_name, qty AS net
                FROM zone_relocations
                WHERE shipment_line_id = %s AND from_op = 'storage' AND to_op = 'packing'
                  AND from_quality = 'good' AND to_quality = 'good'
                UNION ALL
                SELECT to_zone_id, to_zone_name, -qty
                FROM zone_relocations
                WHERE shipment_line_id = %s AND from_op = 'packing' AND to_op = 'storage'
                  AND from_quality = 'good' AND to_quality = 'good'
            ) t
            GROUP BY zone_id HAVING SUM(net) > 0 ORDER BY SUM(net) DESC
            """,
            (line_id, line_id),
        ).mappings().all()

        # Откуда снять: фактические ячейки корзины packing (пул могли переставить).
        holders = conn.exec_driver_sql(
            """
            SELECT zone_id, MIN(zone_name) AS zone_name, SUM(net) AS net FROM (
                SELECT to_zone_id AS zone_id, to_zone_name AS zone_name, qty AS net
                FROM zone_relocations
                WHERE shipment_line_id = %s AND to_op = 'packing' AND to_quality = 'good'
                UNION ALL
                SELECT from_zone_id, from_zone_name, -qty
                FROM zone_relocations
                WHERE shipment_line_id = %s AND from_op = 'packing' AND from_quality = 'good'
            ) t
            GROUP BY zone_id HAVING SUM(net) > 0 ORDER BY SUM(net) DESC
            """,
            (line_id, line_id),
        ).mappings().all()

        pool = [[h["zone_id"], h["zone_name"], int(h["net"])] for h in holders]
        remaining = int(line["pool"])
        for tgt in targets:
            if remaining <= 0:
                break
            take = min(int(tgt["net"]), remaining)
            while take > 0:
                if pool and pool[0][2] > 0:
                    src_id, src_name, avail = pool[0]
                    part = min(avail, take)
                    pool[0][2] -= part
                    if pool[0][2] <= 0:
                        pool.pop(0)
                else:
                    src_id, src_name, part = None, None, take
                conn.exec_driver_sql(
                    """INSERT INTO zone_relocations
                       (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
                        client_id,from_op,to_op,from_quality,to_quality,
                        from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,shipment_line_id)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'packing','storage','good','good',
                               %s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        str(uuid4()), line["product_id"], line["product_name"], line["product_sku"],
                        line["color_id"], line["color_name"], line["size_id"], line["size_name"],
                        line["client_id"], src_id, src_name, tgt["zone_id"], tgt["zone_name"], part,
                        "Возврат зависшего пула с упаковки: задача аннулирована",
                        now, line_id,
                    ),
                )
                take -= part
                remaining -= part


def downgrade() -> None:
    # Журнал append-only: обратный перенос вернул бы товар в корзину аннулированной
    # задачи, откуда его снова некому забрать.
    pass
