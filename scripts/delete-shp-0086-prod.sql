-- SHP-0086: soft-delete документа (товар возвращён вручную, упаковка откатана).
-- Гейты: документ существует, статус on_packing, и нетто журнала zone_relocations
-- по всем строкам документа = 0 (иначе удаление застрянет остатком).
--   .\scripts\prod-psql.ps1 -SqlFile scripts\delete-shp-0086-prod.sql

DO $guard$
DECLARE
    v_doc_id   text := '22bd5491-b277-47fe-939b-2659f2fcbcbd';
    v_status   text;
    v_imbalance int;
BEGIN
    SELECT status INTO v_status
    FROM shipment_docs WHERE id = v_doc_id AND COALESCE(is_deleted, 0) = 0;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'SHP-0086 не найден или уже удалён';
    END IF;
    IF v_status <> 'on_packing' THEN
        RAISE EXCEPTION 'SHP-0086 в статусе % — ожидался on_packing', v_status;
    END IF;

    SELECT COUNT(*) INTO v_imbalance FROM (
        SELECT 1
        FROM zone_relocations zr
        JOIN shipment_lines sl ON sl.id = zr.shipment_line_id
        WHERE sl.doc_id = v_doc_id
        GROUP BY zr.shipment_line_id
        HAVING SUM(CASE WHEN zr.to_op   = 'storage' AND zr.to_quality   = 'good' THEN zr.qty ELSE 0 END)
             - SUM(CASE WHEN zr.from_op = 'storage' AND zr.from_quality = 'good' THEN zr.qty ELSE 0 END) <> 0
            OR SUM(CASE WHEN zr.to_op   = 'packing' AND zr.to_quality   = 'good' THEN zr.qty ELSE 0 END)
             - SUM(CASE WHEN zr.from_op = 'packing' AND zr.from_quality = 'good' THEN zr.qty ELSE 0 END) <> 0
            OR SUM(CASE WHEN zr.to_op   = 'packed'  AND zr.to_quality   = 'good' THEN zr.qty ELSE 0 END)
             - SUM(CASE WHEN zr.from_op = 'packed'  AND zr.from_quality = 'good' THEN zr.qty ELSE 0 END) <> 0
    ) t;

    IF v_imbalance > 0 THEN
        RAISE EXCEPTION 'SHP-0086: журнал не сбалансирован (% строк с ненулевым нетто) — удаление отменено', v_imbalance;
    END IF;
END $guard$;

BEGIN;

INSERT INTO shipment_ops (id, doc_id, op_type, comment, created_at, created_by)
SELECT
    gen_random_uuid()::text,
    '22bd5491-b277-47fe-939b-2659f2fcbcbd',
    'cancel',
    'Документ удалён (правка данных): товар возвращён вручную, упаковка откатана.',
    to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),
    (SELECT id FROM users WHERE role = 'admin' AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at ASC LIMIT 1);

UPDATE shipment_lines
SET is_deleted = 1
WHERE doc_id = '22bd5491-b277-47fe-939b-2659f2fcbcbd' AND COALESCE(is_deleted, 0) = 0;

UPDATE shipment_docs
SET is_deleted = 1, priority_rank = NULL,
    updated_at = to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
WHERE id = '22bd5491-b277-47fe-939b-2659f2fcbcbd';

COMMIT;

SELECT doc_number, status, is_deleted FROM shipment_docs
WHERE id = '22bd5491-b277-47fe-939b-2659f2fcbcbd';
