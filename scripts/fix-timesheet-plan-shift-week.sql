-- Перенос ошибочно внесённого плана табеля: неделя 20–26 июня → 13–19 июня (сдвиг -7 дней).
-- План был внесён не на ту неделю по всем сотрудникам. work_date — text (ISO).
-- created_by для журнальных записей — автор исходного плана (c8c37ac5-…).

BEGIN;

-- 1) Коллизии: сотрудник, у которого в целевом дне (13–19) уже есть запись
--    (например, 19 июня уже стоит факт). Переносим план в существующую запись,
--    а исходную (20–26) гасим soft-delete, чтобы не нарушить unique(employee_id, work_date).
CREATE TEMP TABLE _coll ON COMMIT DROP AS
SELECT s.id AS src_id,
       t.id AS tgt_id,
       s.planned_start,
       s.planned_end,
       s.work_date AS src_date,
       t.work_date AS tgt_date
FROM timesheet_entries s
JOIN timesheet_entries t
  ON t.employee_id = s.employee_id
 AND COALESCE(t.is_deleted, 0) = 0
 AND t.work_date = to_char(to_date(s.work_date, 'YYYY-MM-DD') - 7, 'YYYY-MM-DD')
WHERE COALESCE(s.is_deleted, 0) = 0
  AND s.work_date BETWEEN '2026-06-20' AND '2026-06-26';

UPDATE timesheet_entries t
SET planned_start = c.planned_start,
    planned_end   = c.planned_end,
    updated_at    = now()::text
FROM _coll c
WHERE t.id = c.tgt_id;

INSERT INTO timesheet_ops (id, entry_id, op_type, comment, created_at, created_by)
SELECT gen_random_uuid()::text, c.tgt_id, 'plan_set',
       'Перенос плана с ' || c.src_date || ': ' || c.planned_start || '–' || c.planned_end,
       now()::text, 'c8c37ac5-98fd-47a3-ba46-39be3cd21822'
FROM _coll c;

UPDATE timesheet_entries
SET is_deleted = 1, updated_at = now()::text
WHERE id IN (SELECT src_id FROM _coll);

-- 2) Остальные исходные строки (20–26) просто сдвигаем на -7 дней.
CREATE TEMP TABLE _shift ON COMMIT DROP AS
SELECT id,
       work_date AS old_date,
       to_char(to_date(work_date, 'YYYY-MM-DD') - 7, 'YYYY-MM-DD') AS new_date
FROM timesheet_entries
WHERE COALESCE(is_deleted, 0) = 0
  AND work_date BETWEEN '2026-06-20' AND '2026-06-26';

UPDATE timesheet_entries t
SET work_date = s.new_date, updated_at = now()::text
FROM _shift s
WHERE t.id = s.id;

INSERT INTO timesheet_ops (id, entry_id, op_type, comment, created_at, created_by)
SELECT gen_random_uuid()::text, s.id, 'plan_set',
       'Дата плана исправлена: ' || s.old_date || ' → ' || s.new_date,
       now()::text, 'c8c37ac5-98fd-47a3-ba46-39be3cd21822'
FROM _shift s;

COMMIT;
