"""Миграция данных: расщепление существующих отгрузок на «Задачу упаковки»
(shipment_*) + «Отгрузку клиенту» (dispatch_*).

До рефакторинга одна сущность shipment_docs совмещала складскую подготовку и
рейсовую отгрузку. Теперь рейсы возит dispatch. Переносим исторические/активные
рейсовые отгрузки в новый домен:

- Для каждой shipment в рейсовом статусе (awaiting_trip / partially_shipped /
  shipped / completed_no_goods) создаём dispatch с ТЕМ ЖЕ id (и dispatch_lines с
  теми же id строк) — тогда привязки к рейсам перенаправляются по тождеству, без
  таблицы соответствий. Статус completed_no_goods → cancelled (товар не уехал).
- trip_lines.shipment_doc_id → dispatch_doc_id; trip_alloc.shipment_line_id →
  dispatch_line_id; журнальные движения списания (ready↔shipped) штампуем
  dispatch_line_id.
- Сама задача упаковки завершена → статус packed.

Идемпотентна по NOT EXISTS. Связь со складом (остаток ready по варианту) при
переносе не трогаем — она считается по варианту, а не по строке.

Revision ID: 0065
Revises: 0064
Create Date: 2026-06-23
"""

from __future__ import annotations

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None

_TRIP_STATUSES = "('awaiting_trip','partially_shipped','shipped','completed_no_goods')"


def upgrade() -> None:
    from alembic import op

    # 1. dispatch_docs из рейсовых отгрузок (id переиспользуем).
    op.execute(f"""
        WITH base AS (
            SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, 5) AS INTEGER)), 0) AS m
            FROM dispatch_docs WHERE doc_number LIKE 'DSP-%'
        ),
        src AS (
            SELECT s.*, ROW_NUMBER() OVER (ORDER BY s.created_at, s.id) AS rn
            FROM shipment_docs s
            WHERE COALESCE(s.is_deleted, 0) = 0
              AND s.status IN {_TRIP_STATUSES}
              AND NOT EXISTS (SELECT 1 FROM dispatch_docs d WHERE d.id = s.id)
        )
        INSERT INTO dispatch_docs
            (id, doc_number, cargo_type, client_id, client_name, destination, carrier,
             logistics_cost, ship_date, actual_ship_date, comment, priority_rank, status,
             created_at, created_by, updated_at, is_deleted)
        SELECT src.id,
               'DSP-' || LPAD((base.m + src.rn)::text, 4, '0'),
               COALESCE(src.cargo_type, 'good'), src.client_id, src.client_name,
               src.destination, src.carrier, src.logistics_cost, src.ship_date,
               src.actual_ship_date, src.comment, src.priority_rank,
               CASE src.status WHEN 'completed_no_goods' THEN 'cancelled' ELSE src.status END,
               src.created_at, src.created_by, src.updated_at, 0
        FROM src, base
    """)

    # 2. dispatch_lines из строк этих отгрузок (id строк переиспользуем).
    op.execute("""
        INSERT INTO dispatch_lines
            (id, doc_id, product_id, product_name, product_sku, color_id, color_name,
             size_id, size_name, qty, shipped_qty, site_url, store_id, store_name, created_at, is_deleted)
        SELECT sl.id, sl.doc_id, sl.product_id, sl.product_name, sl.product_sku,
               sl.color_id, sl.color_name, sl.size_id, sl.size_name,
               sl.qty, COALESCE(sl.shipped_qty, 0), NULL, sl.store_id, sl.store_name,
               sl.created_at, COALESCE(sl.is_deleted, 0)
        FROM shipment_lines sl
        WHERE EXISTS (SELECT 1 FROM dispatch_docs d WHERE d.id = sl.doc_id)
          AND NOT EXISTS (SELECT 1 FROM dispatch_lines dl WHERE dl.id = sl.id)
    """)

    # 3. trip_lines: привязка outbound-рейсов на dispatch.
    op.execute("""
        UPDATE trip_lines SET dispatch_doc_id = shipment_doc_id, shipment_doc_id = NULL
        WHERE shipment_doc_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM dispatch_docs d WHERE d.id = trip_lines.shipment_doc_id)
    """)

    # 4. trip_alloc: распределение по строкам на dispatch.
    op.execute("""
        UPDATE trip_alloc SET dispatch_line_id = shipment_line_id, shipment_line_id = NULL
        WHERE shipment_line_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM dispatch_lines dl WHERE dl.id = trip_alloc.shipment_line_id)
    """)

    # 5. Журнальные движения списания (ready↔shipped) — штамп dispatch_line_id для
    #    корректного сторно при отмене рейса.
    op.execute("""
        UPDATE zone_relocations SET dispatch_line_id = shipment_line_id
        WHERE shipment_line_id IS NOT NULL AND dispatch_line_id IS NULL
          AND (to_op = 'shipped' OR from_op = 'shipped')
          AND EXISTS (SELECT 1 FROM dispatch_lines dl WHERE dl.id = zone_relocations.shipment_line_id)
    """)

    # 6. Задача упаковки завершена.
    op.execute(f"""
        UPDATE shipment_docs SET status = 'packed'
        WHERE COALESCE(is_deleted, 0) = 0 AND status IN {_TRIP_STATUSES}
    """)


def downgrade() -> None:
    from alembic import op

    # Best-effort: вернуть привязки рейсов на shipment и удалить созданные dispatch.
    # Точные исходные статусы отгрузок не восстанавливаются (многие сведены в packed).
    op.execute("""
        UPDATE trip_alloc SET shipment_line_id = dispatch_line_id, dispatch_line_id = NULL
        WHERE dispatch_line_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM shipment_lines sl WHERE sl.id = trip_alloc.dispatch_line_id)
    """)
    op.execute("""
        UPDATE trip_lines SET shipment_doc_id = dispatch_doc_id, dispatch_doc_id = NULL
        WHERE dispatch_doc_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM shipment_docs s WHERE s.id = trip_lines.dispatch_doc_id)
    """)
    op.execute("""
        UPDATE zone_relocations SET dispatch_line_id = NULL
        WHERE dispatch_line_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM shipment_lines sl WHERE sl.id = zone_relocations.dispatch_line_id)
    """)
    op.execute("DELETE FROM dispatch_lines WHERE id IN (SELECT id FROM shipment_lines)")
    op.execute("DELETE FROM dispatch_docs WHERE id IN (SELECT id FROM shipment_docs)")
