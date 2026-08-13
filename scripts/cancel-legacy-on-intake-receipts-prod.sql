-- Закрытие исторических поступлений, застрявших в легаси-статусе on_intake «На приёмке».
-- Старый ручной поток приёмки снят (приёмка идёт через разгрузку рейса), поэтому такие
-- документы висят в «Операционном плане» главного экрана навсегда: dashboard берёт
-- planned + on_intake с arrival_date <= сегодня. Штатного перехода из on_intake нет
-- (POST /receipts/{id}/cancel разрешён только из planned) — отсюда разовый SQL.
--
-- Переводим в cancelled: приход в сток не пишем, журнал zone_relocations не трогаем.
-- После правки документы уходят и из плана, и из «ожидается» в остатках.
--
-- Применение (с Windows, SSH Host wms-prod в ~/.ssh/config):
--   .\scripts\apply-cancel-legacy-on-intake-prod.ps1
-- На сервере (ssh alex@109.73.192.225):
--   cd /var/www/app-prod && docker exec -i wms_prod_db psql -U postgres -d app \
--     -v ON_ERROR_STOP=1 < scripts/cancel-legacy-on-intake-receipts-prod.sql
--
-- Скрипт транзакционный и самопроверяющийся: если в on_intake окажется не 2 документа,
-- или по их строкам уже есть журнальные движения, или они привязаны к незакрытому рейсу —
-- правка откатывается целиком.

\echo '=== ДО правки: поступления в статусе on_intake ==='
SELECT d.doc_number, d.status, cl.name AS client, d.arrival_date,
       COALESCE(SUM(l.planned_qty), 0)  AS planned_qty,
       COALESCE(SUM(l.accepted_qty), 0) AS accepted_qty
FROM receipt_docs d
LEFT JOIN clients cl ON cl.id = d.client_id
LEFT JOIN receipt_lines l ON l.doc_id = d.id AND COALESCE(l.is_deleted, 0) = 0
WHERE COALESCE(d.is_deleted, 0) = 0 AND d.status = 'on_intake'
GROUP BY d.doc_number, d.status, cl.name, d.arrival_date
ORDER BY d.arrival_date;

BEGIN;

CREATE TEMP TABLE _legacy_on_intake ON COMMIT DROP AS
SELECT d.id, d.doc_number
FROM receipt_docs d
WHERE COALESCE(d.is_deleted, 0) = 0 AND d.status = 'on_intake';

DO $guard$
DECLARE
  v_docs    int;
  v_journal int;
  v_trips   text;
BEGIN
  SELECT COUNT(*) INTO v_docs FROM _legacy_on_intake;
  IF v_docs <> 2 THEN
    RAISE EXCEPTION 'Ожидались 2 поступления в статусе on_intake, найдено % — правка отменена', v_docs;
  END IF;

  -- Журнальные движения по строкам означают, что приход реально заводился:
  -- такой документ закрывается как «Завершён», а не аннулированием.
  SELECT COUNT(*) INTO v_journal
  FROM zone_relocations zr
  JOIN receipt_lines l ON l.id = zr.receipt_line_id
  JOIN _legacy_on_intake t ON t.id = l.doc_id;
  IF v_journal > 0 THEN
    RAISE EXCEPTION 'По строкам найдено % журнальных движений — приход заводился, аннулировать нельзя', v_journal;
  END IF;

  -- Незакрытый рейс повезёт «мёртвую» строку, разгрузка попытается стартовать приёмку.
  SELECT string_agg(DISTINCT t.trip_number, ', ') INTO v_trips
  FROM trip_lines tl
  JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0
  JOIN _legacy_on_intake d ON d.id = tl.receipt_doc_id
  WHERE COALESCE(tl.is_deleted, 0) = 0
    AND t.status NOT IN ('closed', 'cancelled');
  IF v_trips IS NOT NULL THEN
    RAISE EXCEPTION 'Поступления привязаны к незакрытым рейсам (%) — сначала отвяжите', v_trips;
  END IF;
END $guard$;

UPDATE receipt_docs
   SET status = 'cancelled',
       updated_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
 WHERE id IN (SELECT id FROM _legacy_on_intake);

INSERT INTO receipt_ops (id, doc_id, op_type, comment, created_at, created_by)
SELECT gen_random_uuid()::text, t.id, 'cancel',
       'На приёмке → Аннулирован (закрытие исторического поступления легаси-потока приёмки)',
       to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),
       (SELECT u.id FROM users u WHERE u.role = 'admin' AND COALESCE(u.is_deleted, 0) = 0 ORDER BY u.created_at LIMIT 1)
FROM _legacy_on_intake t;

COMMIT;

\echo '=== ПОСЛЕ правки: те же документы ==='
SELECT d.doc_number, d.status, cl.name AS client, d.arrival_date, d.updated_at
FROM receipt_docs d
LEFT JOIN clients cl ON cl.id = d.client_id
WHERE COALESCE(d.is_deleted, 0) = 0 AND d.status = 'cancelled'
ORDER BY d.updated_at DESC NULLS LAST
LIMIT 5;

\echo '=== Осталось в on_intake (ожидается 0) ==='
SELECT COUNT(*) AS on_intake_left FROM receipt_docs
WHERE COALESCE(is_deleted, 0) = 0 AND status = 'on_intake';
