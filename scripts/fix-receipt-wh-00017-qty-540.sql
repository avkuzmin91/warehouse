-- WH-00017: план и принятое количество → 540 по всем активным строкам документа.
-- Синхронизирует receipt_lines и append-only журнал receipt_ops (остатки / detail-view).
--
-- С Windows (SSH Host wms-prod в ~/.ssh/config):
--   .\scripts\apply-fix-receipt-wh-00017-prod.ps1
-- или вручную:
--   .\scripts\prod-psql.ps1 -Query "SELECT d.doc_number, d.status, l.product_sku, l.planned_qty, l.accepted_qty FROM receipt_docs d JOIN receipt_lines l ON l.doc_id = d.id WHERE d.doc_number = 'WH-00017' AND COALESCE(d.is_deleted,0)=0 AND COALESCE(l.is_deleted,0)=0;"
--   .\scripts\prod-psql.ps1 -SqlFile scripts\fix-receipt-wh-00017-qty-540.sql
--
-- На сервере (ssh wms-prod):
--   cd /var/www/app-prod && docker exec -i wms_prod_db psql -U postgres -d app -v ON_ERROR_STOP=1 < scripts/fix-receipt-wh-00017-qty-540.sql
--
-- Если в документе несколько SKU и менять нужно не все строки — добавьте фильтр
-- в CREATE TEMP TABLE (например AND l.product_sku = '...').

DO $guard$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM receipt_docs
        WHERE doc_number = 'WH-00017' AND COALESCE(is_deleted, 0) = 0
    ) THEN
        RAISE EXCEPTION 'Документ WH-00017 не найден';
    END IF;
END $guard$;

BEGIN;

CREATE TEMP TABLE _fix_wh_00017_lines ON COMMIT DROP AS
SELECT
    l.id AS line_id,
    l.doc_id,
    l.planned_qty AS old_planned,
    l.accepted_qty AS old_accepted,
    td.status AS doc_status,
    COALESCE(
        (
            SELECT o2.qty
            FROM receipt_ops o2
            WHERE o2.line_id = l.id AND o2.op_type = 'receiving_correction'
            ORDER BY o2.created_at DESC
            LIMIT 1
        ),
        (
            SELECT COALESCE(SUM(o2.qty), 0)
            FROM receipt_ops o2
            WHERE o2.line_id = l.id AND o2.op_type = 'receiving'
        ),
        0
    ) AS current_received_ops
FROM receipt_lines l
JOIN receipt_docs td ON td.id = l.doc_id
WHERE td.doc_number = 'WH-00017'
  AND COALESCE(td.is_deleted, 0) = 0
  AND COALESCE(l.is_deleted, 0) = 0;

UPDATE receipt_lines l
SET planned_qty = 540, accepted_qty = 540
FROM _fix_wh_00017_lines tl
WHERE l.id = tl.line_id
  AND (tl.old_planned <> 540 OR COALESCE(tl.old_accepted, -1) <> 540);

INSERT INTO receipt_ops (id, doc_id, line_id, op_type, qty, comment, created_at, created_by)
SELECT
    gen_random_uuid()::text,
    tl.doc_id,
    tl.line_id,
    'line_update',
    540,
    'План: ' || tl.old_planned::text || ' → 540 шт.; Принят: '
        || COALESCE(tl.old_accepted::text, '—') || ' → 540 шт. (правка данных)',
    to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),
    (
        SELECT id FROM users
        WHERE role = 'admin' AND COALESCE(is_deleted, 0) = 0
        ORDER BY created_at ASC
        LIMIT 1
    )
FROM _fix_wh_00017_lines tl
WHERE tl.old_planned <> 540 OR COALESCE(tl.old_accepted, -1) <> 540;

INSERT INTO receipt_ops (id, doc_id, line_id, op_type, qty, comment, created_at, created_by)
SELECT
    gen_random_uuid()::text,
    tl.doc_id,
    tl.line_id,
    'receiving_correction',
    540,
    'Корректировка принятого: 540 шт. (правка данных)',
    to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),
    (
        SELECT id FROM users
        WHERE role = 'admin' AND COALESCE(is_deleted, 0) = 0
        ORDER BY created_at ASC
        LIMIT 1
    )
FROM _fix_wh_00017_lines tl
WHERE tl.doc_status IN ('on_review', 'done')
  AND tl.current_received_ops <> 540;

COMMIT;

SELECT d.doc_number, d.status, l.product_sku, l.planned_qty, l.accepted_qty
FROM receipt_docs d
JOIN receipt_lines l ON l.doc_id = d.id
WHERE d.doc_number = 'WH-00017'
  AND COALESCE(d.is_deleted, 0) = 0
  AND COALESCE(l.is_deleted, 0) = 0;
