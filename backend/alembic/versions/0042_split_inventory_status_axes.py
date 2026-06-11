"""Split inventory status into two axes: operational (op) and quality.

Revision ID: 0042
Revises: 0041
Create Date: 2026-06-10

Единая ось from_status/to_status (on_review|on_packing|good|defect) разделяется на:
  - операционный статус: storage («На хранении») | packing («На упаковке») |
    ready («Готов к отгрузке») | shipped («Отгружен», терминальный);
  - качество: good («Годный») | defect («Брак»).

Маппинг истории (решение бизнеса: после приёмки товар годный — «Не проверен»
существует только внутри приёмки и на остатки не попадает):
  on_review  → (storage, good)
  on_packing → (packing, good)
  good       → (ready, good), если строка привязана к упаковке/отгрузке
               (pack_entry_id / shipment_line_id), иначе (storage, good)
  defect     → качество defect; op по контексту: запись упаковки → packing,
               раскладка брака к рейсу → packing→storage, иначе storage

Дополнительно: списание по уже отгруженным документам переводится из вычитания
по shipment_lines в журнальные движения (… → shipped):
  - строки с раскладкой по местам — списываются из фактических мест (ready);
  - старые строки без следов в журнале — из storage@storage_zone_id строки.
После этого баланс = чистый replay журнала + accepted-приход поступлений,
CTE по shipment_docs.status='shipped' из расчёта остатков уходит.
"""

from __future__ import annotations

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS from_op TEXT")
    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS to_op TEXT")
    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS from_quality TEXT")
    op.execute("ALTER TABLE zone_relocations ADD COLUMN IF NOT EXISTS to_quality TEXT")

    # --- Бэкфилл качества: good/defect остаются, on_review/on_packing → good. ---
    op.execute("""
        UPDATE zone_relocations SET
            from_quality = CASE WHEN from_status = 'defect' THEN 'defect' ELSE 'good' END,
            to_quality   = CASE WHEN to_status   = 'defect' THEN 'defect' ELSE 'good' END
        WHERE from_quality IS NULL OR to_quality IS NULL
    """)

    # --- Бэкфилл операционного статуса (по контексту строки). ---
    # from-сторона:
    #   on_review → storage; on_packing → packing;
    #   good → ready, если запись упаковки/отгрузки (pack_entry_id или shipment_line_id);
    #   defect → packing, если запись упаковки (pack_entry_id) или раскладка
    #            defect→defect по строке отгрузки; иначе storage.
    op.execute("""
        UPDATE zone_relocations SET from_op = CASE
            WHEN from_status = 'on_review'  THEN 'storage'
            WHEN from_status = 'on_packing' THEN 'packing'
            WHEN from_status = 'good' THEN
                CASE WHEN pack_entry_id IS NOT NULL OR shipment_line_id IS NOT NULL
                     THEN 'ready' ELSE 'storage' END
            WHEN from_status = 'defect' THEN
                CASE WHEN pack_entry_id IS NOT NULL THEN 'packing'
                     WHEN shipment_line_id IS NOT NULL AND to_status = 'defect' THEN 'packing'
                     ELSE 'storage' END
            ELSE 'storage' END
        WHERE from_op IS NULL
    """)
    # to-сторона:
    #   good → ready только для записей упаковки и раскладки good→good по отгрузке;
    #   defect → packing для записей упаковки (брак найден на столе),
    #            storage для раскладки брака и свободных перемещений.
    op.execute("""
        UPDATE zone_relocations SET to_op = CASE
            WHEN to_status = 'on_review'  THEN 'storage'
            WHEN to_status = 'on_packing' THEN 'packing'
            WHEN to_status = 'good' THEN
                CASE WHEN pack_entry_id IS NOT NULL OR shipment_line_id IS NOT NULL
                     THEN 'ready' ELSE 'storage' END
            WHEN to_status = 'defect' THEN
                CASE WHEN pack_entry_id IS NOT NULL THEN 'packing' ELSE 'storage' END
            ELSE 'storage' END
        WHERE to_op IS NULL
    """)
    # Откат передачи на упаковку (on_packing→on_review) и возврат нерешённого пула
    # уже покрыты общими ветками: (packing,good) → (storage,good).

    # --- Журнальное списание по уже отгруженным документам. ---
    # 1) Строки с следами ready в журнале: списываем net ready по фактическим местам.
    op.execute("""
        WITH ready_by_zone AS (
            -- net ready по (строка, место): приход в ready@место − уход из ready@место
            SELECT line_id, doc_id, zone_id, MIN(zone_name) AS zone_name, SUM(gain) AS net FROM (
                SELECT zr.shipment_line_id AS line_id, sl.doc_id,
                       zr.to_zone_id AS zone_id, zr.to_zone_name AS zone_name, zr.qty AS gain
                FROM zone_relocations zr
                JOIN shipment_lines sl ON sl.id = zr.shipment_line_id
                JOIN shipment_docs sd ON sd.id = sl.doc_id
                WHERE sd.status = 'shipped' AND COALESCE(sd.is_deleted, 0) = 0 AND zr.to_op = 'ready'
                UNION ALL
                SELECT zr.shipment_line_id, sl.doc_id,
                       zr.from_zone_id, zr.from_zone_name, -zr.qty
                FROM zone_relocations zr
                JOIN shipment_lines sl ON sl.id = zr.shipment_line_id
                JOIN shipment_docs sd ON sd.id = sl.doc_id
                WHERE sd.status = 'shipped' AND COALESCE(sd.is_deleted, 0) = 0 AND zr.from_op = 'ready'
            ) t
            GROUP BY line_id, doc_id, zone_id
            HAVING SUM(gain) > 0
        )
        INSERT INTO zone_relocations
            (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
             client_id, client_name, from_status, to_status, from_op, to_op, from_quality, to_quality,
             from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment, created_at, shipment_line_id)
        SELECT gen_random_uuid()::text, sl.product_id, sl.product_name, sl.product_sku,
               sl.color_id, sl.color_name, sl.size_id, sl.size_name,
               sd.client_id, sd.client_name, 'good', 'good',
               'ready', 'shipped', 'good', 'good',
               rz.zone_id, rz.zone_name, NULL, NULL, rz.net,
               'Миграция: списание по отгрузке ' || sd.doc_number,
               COALESCE(sd.updated_at, sd.created_at), rz.line_id
        FROM ready_by_zone rz
        JOIN shipment_lines sl ON sl.id = rz.line_id
        JOIN shipment_docs sd ON sd.id = rz.doc_id
    """)

    # 2) Строки отгруженных документов без следов ready: списываем из storage
    #    по месту строки (как делал старый CTE-вычет), качество = cargo_type.
    op.execute("""
        INSERT INTO zone_relocations
            (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
             client_id, client_name, from_status, to_status, from_op, to_op, from_quality, to_quality,
             from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment, created_at, shipment_line_id)
        SELECT gen_random_uuid()::text, sl.product_id, sl.product_name, sl.product_sku,
               sl.color_id, sl.color_name, sl.size_id, sl.size_name,
               sd.client_id, sd.client_name,
               CASE WHEN COALESCE(sd.cargo_type, 'good') = 'defect' THEN 'defect' ELSE 'good' END,
               CASE WHEN COALESCE(sd.cargo_type, 'good') = 'defect' THEN 'defect' ELSE 'good' END,
               'storage', 'shipped',
               CASE WHEN COALESCE(sd.cargo_type, 'good') = 'defect' THEN 'defect' ELSE 'good' END,
               CASE WHEN COALESCE(sd.cargo_type, 'good') = 'defect' THEN 'defect' ELSE 'good' END,
               sl.storage_zone_id, sl.storage_zone_name, NULL, NULL,
               COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty),
               'Миграция: списание по отгрузке ' || sd.doc_number,
               COALESCE(sd.updated_at, sd.created_at), sl.id
        FROM shipment_lines sl
        JOIN shipment_docs sd ON sd.id = sl.doc_id
        WHERE sd.status = 'shipped' AND COALESCE(sd.is_deleted, 0) = 0
          AND COALESCE(sl.is_deleted, 0) = 0
          AND COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty) > 0
          AND NOT EXISTS (
              SELECT 1 FROM zone_relocations zr
              WHERE zr.shipment_line_id = sl.id
                AND (zr.to_op = 'ready' OR zr.from_op = 'ready')
          )
    """)

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zone_relocations_axes "
        "ON zone_relocations (from_op, from_quality, to_op, to_quality, product_id, client_id, color_id, size_id)"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DELETE FROM zone_relocations WHERE to_op = 'shipped'")
    op.execute("DROP INDEX IF EXISTS idx_zone_relocations_axes")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS from_op")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS to_op")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS from_quality")
    op.execute("ALTER TABLE zone_relocations DROP COLUMN IF EXISTS to_quality")
