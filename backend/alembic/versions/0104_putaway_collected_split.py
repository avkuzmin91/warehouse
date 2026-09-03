"""Расщепление задачи размещения: сборка (collected) и развозка по местам.

Живые задачи размещения переводятся на новую модель корзин: и годный, и брак
теперь ждут развозки в корзине `boxed` («Ждёт размещения»), а не в `packed`.
Собранное «мимо короба» (брак, габарит) до этой ревизии оставалось в `packed` и
попадало бы в пул отгрузки, минуя стеллаж, — переносим журнальной записью.

Revision ID: 0104
Revises: 0103
Create Date: 2026-09-03
"""

from __future__ import annotations

revision = "0104"
down_revision = "0103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from datetime import UTC, datetime
    from uuid import uuid4

    from alembic import op

    conn = op.get_bind()
    now = datetime.now(UTC).isoformat()

    # Нетто корзины `packed` по строкам незакрытых задач размещения, в разрезе
    # качества и места: журнал append-only, поэтому переносим компенсирующей записью.
    rows = conn.exec_driver_sql(
        """
        SELECT l.id AS line_id,
               MIN(l.product_id)   AS product_id,
               MIN(l.product_name) AS product_name,
               MIN(l.product_sku)  AS product_sku,
               MIN(l.color_id)     AS color_id,
               MIN(l.color_name)   AS color_name,
               MIN(l.size_id)      AS size_id,
               MIN(l.size_name)    AS size_name,
               MIN(d.client_id)    AS client_id,
               t.quality           AS quality,
               t.zone_id           AS zone_id,
               MIN(t.zone_name)    AS zone_name,
               SUM(t.net)          AS net
        FROM shipment_lines l
        JOIN shipment_docs d ON d.id = l.doc_id
        JOIN (
            SELECT shipment_line_id, to_quality AS quality, to_zone_id AS zone_id,
                   to_zone_name AS zone_name, qty AS net
            FROM zone_relocations WHERE to_op = 'packed'
            UNION ALL
            SELECT shipment_line_id, from_quality, from_zone_id, from_zone_name, -qty
            FROM zone_relocations WHERE from_op = 'packed'
        ) t ON t.shipment_line_id = l.id
        WHERE COALESCE(l.is_deleted, 0) = 0
          AND COALESCE(d.is_deleted, 0) = 0
          AND d.task_kind = 'putaway'
          AND d.status = 'on_packing'
        GROUP BY l.id, t.quality, t.zone_id
        HAVING SUM(t.net) > 0
        """
    ).mappings().all()

    for r in rows:
        conn.exec_driver_sql(
            """INSERT INTO zone_relocations
               (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
                client_id,from_op,to_op,from_quality,to_quality,
                from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,shipment_line_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'packed','boxed',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                str(uuid4()), r["product_id"], r["product_name"], r["product_sku"],
                r["color_id"], r["color_name"], r["size_id"], r["size_name"],
                r["client_id"], r["quality"], r["quality"],
                r["zone_id"], r["zone_name"], r["zone_id"], r["zone_name"],
                int(r["net"]),
                "Перевод на раздельную сборку и развозку: ждёт размещения по местам",
                now, r["line_id"],
            ),
        )


def downgrade() -> None:
    # Обратный перенос не делаем: журнал append-only, а старая модель различала
    # корзины по качеству — восстановить её по нетто нельзя однозначно.
    pass
