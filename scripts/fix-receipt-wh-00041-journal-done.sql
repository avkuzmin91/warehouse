-- WH-00041 (f09704f5-b314-454c-998c-47cf10ff2c4c): легаси-поступление застряло в
-- статусе on_intake (старый ручной поток приёмки, снят при переходе на приёмку в рейсе).
-- Принято 503 шт., но журнального прихода (intake->storage) не было -> остаток невидим.
-- Товар физически на складе (подтверждено). Восстанавливаем приход и закрываем документ,
-- как это сделала бы штатная приёмка через рейс (receive_receipts_for_trip + recompute).
--
-- Транзакционно, с защитой: правка отменяется, если статус изменился или журнал уже есть.
-- Все русские названия берутся из справочников (INSERT ... SELECT) — не хардкодим.

BEGIN;

DO $$
DECLARE
  v_status  text;
  v_lines   int;
  v_journal int;
BEGIN
  SELECT status INTO v_status FROM receipt_docs
   WHERE id = 'f09704f5-b314-454c-998c-47cf10ff2c4c' AND COALESCE(is_deleted, 0) = 0;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'WH-00041: документ не найден или удалён';
  END IF;
  IF v_status <> 'on_intake' THEN
    RAISE EXCEPTION 'WH-00041: статус изменился (%), ожидался on_intake — правка отменена', v_status;
  END IF;
  SELECT COUNT(*) INTO v_lines FROM receipt_lines
   WHERE doc_id = 'f09704f5-b314-454c-998c-47cf10ff2c4c' AND COALESCE(is_deleted, 0) = 0;
  IF v_lines <> 1 THEN
    RAISE EXCEPTION 'WH-00041: ожидалась 1 активная строка, найдено % — правка отменена', v_lines;
  END IF;
  SELECT COUNT(*) INTO v_journal FROM zone_relocations
   WHERE receipt_line_id = 'dbec9f72-f14e-4cab-9b30-726dc3ff9290';
  IF v_journal <> 0 THEN
    RAISE EXCEPTION 'WH-00041: журнал уже содержит % движений по строке — приход не задваиваем', v_journal;
  END IF;
END $$;

-- 1) Журнальный приход приёмки: intake -> storage, годный, в зону хранения строки.
--    Зеркало insert_inventory_move из receive_receipts_for_trip (без trip_id — рейса не было).
INSERT INTO zone_relocations
  (id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
   client_id, client_name, from_op, to_op, from_quality, to_quality,
   from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment,
   created_at, created_by, receipt_line_id)
SELECT
  gen_random_uuid()::text,
  l.product_id, l.product_name, l.product_sku, l.color_id, l.color_name, l.size_id, l.size_name,
  d.client_id, cl.name,
  'intake', 'storage', 'good', 'good',
  l.storage_zone_id, uz.name, l.storage_zone_id, uz.name,
  l.accepted_qty,
  'Восстановление прихода легаси-поступления WH-00041: ' || l.accepted_qty || ' шт. → ' || COALESCE(uz.name, '—'),
  to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),
  'c8c37ac5-98fd-47a3-ba46-39be3cd21822',
  l.id
FROM receipt_lines l
JOIN receipt_docs d   ON d.id  = l.doc_id
LEFT JOIN clients cl  ON cl.id = d.client_id
LEFT JOIN unloading_zones uz ON uz.id = l.storage_zone_id
WHERE l.id = 'dbec9f72-f14e-4cab-9b30-726dc3ff9290';

-- 2) Журнал операций поступления: запись прихода.
INSERT INTO receipt_ops (id, doc_id, line_id, op_type, qty, comment, created_at, created_by)
SELECT
  gen_random_uuid()::text, l.doc_id, l.id, 'arrival_accept', l.accepted_qty,
  'Восстановление журнального прихода (легаси on_intake без движения): ' || l.accepted_qty || ' шт. на «' || COALESCE(uz.name, '—') || '»',
  to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),
  'c8c37ac5-98fd-47a3-ba46-39be3cd21822'
FROM receipt_lines l
LEFT JOIN unloading_zones uz ON uz.id = l.storage_zone_id
WHERE l.id = 'dbec9f72-f14e-4cab-9b30-726dc3ff9290';

-- 3) Статус документа -> done (принято 503 >= план 500 => полностью принято).
UPDATE receipt_docs
   SET status = 'done',
       updated_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
 WHERE id = 'f09704f5-b314-454c-998c-47cf10ff2c4c';

-- 4) Журнал операций: смена статуса.
INSERT INTO receipt_ops (id, doc_id, op_type, comment, created_at, created_by)
VALUES (
  gen_random_uuid()::text, 'f09704f5-b314-454c-998c-47cf10ff2c4c', 'arrival_fix',
  'На приёмке → Завершён (ручное закрытие легаси-поступления, приход восстановлен)',
  to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),
  'c8c37ac5-98fd-47a3-ba46-39be3cd21822'
);

COMMIT;
