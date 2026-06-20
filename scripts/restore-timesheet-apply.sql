-- Восстановление табеля до аварии 2026-06-19 13:17:04.944 (откат массовой перезаписи).
-- Реконструкция состояния из журнала timesheet_ops (ops с created_at < cutoff).
-- Non-ASCII литералы — через U&-escape (исходник чистый ASCII), чтобы не пострадали
-- при передаче через psql-канал. Значения времени/флагов — ASCII, безопасны.

BEGIN;

CREATE TEMP TABLE recon ON COMMIT DROP AS
WITH cutoff AS (SELECT '2026-06-19 13:17:00+00'::timestamptz AS t),
ev AS (
  SELECT id, employee_id, work_date,
         planned_start, planned_end, actual_start, actual_end,
         COALESCE(is_absent,0) AS is_absent, COALESCE(is_deleted,0) AS is_deleted
  FROM timesheet_entries
  WHERE work_date BETWEEN '2026-06-13' AND '2026-06-26'
    AND COALESCE(is_deleted,0)=0
),
op AS (
  SELECT o.entry_id, o.op_type, o.created_at::timestamptz AS ts,
         CASE WHEN o.comment LIKE '%'||U&'\2192'||'%'
              THEN regexp_replace(o.comment, '^.*'||U&'\2192', '')
              ELSE o.comment END AS rhs
  FROM timesheet_ops o
  JOIN ev ON ev.id = o.entry_id
  WHERE o.created_at::timestamptz < (SELECT t FROM cutoff)
),
opv AS (
  SELECT entry_id, op_type, ts, rhs,
    (SELECT array_agg(m[1] ORDER BY ord)
       FROM regexp_matches(rhs, '\d{2}:\d{2}', 'g') WITH ORDINALITY AS r(m, ord)) AS toks,
    (rhs LIKE '%'||U&'\043D\0435\0442'||'%') AS has_net
  FROM op
),
opb AS (
  SELECT entry_id, op_type, ts,
    CASE WHEN array_length(toks,1) >= 2 THEN toks[1] END AS v_s,
    CASE WHEN array_length(toks,1) >= 2 THEN toks[2] END AS v_e,
    (array_length(toks,1) >= 2 OR has_net) AS bearing
  FROM opv WHERE op_type IN ('plan_set','fact_set')
),
plan_last AS (SELECT DISTINCT ON (entry_id) entry_id, v_s ps, v_e pe FROM opb WHERE op_type='plan_set' AND bearing ORDER BY entry_id, ts DESC),
fact_last AS (SELECT DISTINCT ON (entry_id) entry_id, v_s fs, v_e fe FROM opb WHERE op_type='fact_set' AND bearing ORDER BY entry_id, ts DESC),
abs_last  AS (SELECT DISTINCT ON (entry_id) entry_id, CASE WHEN op_type='absent_mark' THEN 1 ELSE 0 END ab FROM op WHERE op_type IN ('absent_mark','absent_clear') ORDER BY entry_id, ts DESC),
existed AS (SELECT DISTINCT entry_id FROM op)
SELECT ev.id, ev.work_date,
       (ev.id IN (SELECT entry_id FROM existed)) AS had_ops,
       pl.ps, pl.pe, fa.fs, fa.fe, COALESCE(ab.ab,0) AS rabsent,
       ev.planned_start AS cur_ps, ev.planned_end AS cur_pe,
       ev.actual_start  AS cur_fs, ev.actual_end  AS cur_fe, ev.is_absent AS cur_abs
FROM ev
LEFT JOIN plan_last pl ON pl.entry_id=ev.id
LEFT JOIN fact_last fa ON fa.entry_id=ev.id
LEFT JOIN abs_last  ab ON ab.entry_id=ev.id;

-- 1) Восстановить значения у записей, существовавших до аварии.
UPDATE timesheet_entries t
SET planned_start = r.ps, planned_end = r.pe,
    actual_start  = r.fs, actual_end  = r.fe,
    is_absent     = r.rabsent,
    updated_at    = now()::text
FROM recon r
WHERE t.id = r.id AND r.had_ops;

-- 2) Удалить (soft) записи, рождённые аварией (до аварии их не было).
UPDATE timesheet_entries t
SET is_deleted = 1, updated_at = now()::text
FROM recon r
WHERE t.id = r.id AND NOT r.had_ops;

-- 3) Аудит в журнал — только там, где состояние реально изменилось.
INSERT INTO timesheet_ops (id, entry_id, op_type, comment, created_at, created_by)
SELECT gen_random_uuid()::text, r.id, 'plan_set',
       U&'\041E\0442\043A\0430\0442 \043C\0430\0441\0441\043E\0432\043E\0439 \043F\0435\0440\0435\0437\0430\043F\0438\0441\0438 13:17; \0432\043E\0441\0441\0442\0430\043D\043E\0432\043B\0435\043D\043E \0438\0437 \0436\0443\0440\043D\0430\043B\0430',
       now()::text, 'c8c37ac5-98fd-47a3-ba46-39be3cd21822'
FROM recon r
WHERE r.had_ops
  AND (r.ps IS DISTINCT FROM r.cur_ps OR r.pe IS DISTINCT FROM r.cur_pe
    OR r.fs IS DISTINCT FROM r.cur_fs OR r.fe IS DISTINCT FROM r.cur_fe
    OR r.rabsent IS DISTINCT FROM r.cur_abs);

-- Сводка результата перед COMMIT.
SELECT work_date,
  COUNT(*) FILTER (WHERE COALESCE(is_deleted,0)=0) AS live,
  COUNT(planned_start) FILTER (WHERE COALESCE(is_deleted,0)=0) AS planned,
  COUNT(actual_start)  FILTER (WHERE COALESCE(is_deleted,0)=0) AS actual,
  SUM(is_absent) FILTER (WHERE COALESCE(is_deleted,0)=0) AS absent
FROM timesheet_entries
WHERE work_date BETWEEN '2026-06-13' AND '2026-06-26'
GROUP BY work_date ORDER BY work_date;

COMMIT;
