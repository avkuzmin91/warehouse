-- READ-ONLY проверка реконструкции на выборке записей.
WITH cutoff AS (SELECT '2026-06-19 13:17:00+00'::timestamptz AS t),
ev AS (
  SELECT id, employee_id, work_date,
         planned_start, planned_end, actual_start, actual_end,
         COALESCE(is_absent,0) AS is_absent, COALESCE(is_deleted,0) AS is_deleted
  FROM timesheet_entries
  WHERE work_date BETWEEN '2026-06-13' AND '2026-06-26'
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
existed AS (SELECT DISTINCT entry_id FROM op),
recon AS (
  SELECT ev.work_date, right(ev.employee_id,6) AS emp, ev.is_deleted AS del,
         (ev.id IN (SELECT entry_id FROM existed)) AS had_ops,
         ev.planned_start||'/'||COALESCE(ev.planned_end,'') AS cur_plan,
         ev.actual_start ||'/'||COALESCE(ev.actual_end,'')  AS cur_fact,
         ev.is_absent AS cur_abs,
         COALESCE(pl.ps,'-')||'/'||COALESCE(pl.pe,'-') AS rec_plan,
         COALESCE(fa.fs,'-')||'/'||COALESCE(fa.fe,'-') AS rec_fact,
         COALESCE(ab.ab,0) AS rec_abs
  FROM ev
  LEFT JOIN plan_last pl ON pl.entry_id=ev.id
  LEFT JOIN fact_last fa ON fa.entry_id=ev.id
  LEFT JOIN abs_last  ab ON ab.entry_id=ev.id
  WHERE ev.employee_id='ce5c5286-6e29-4154-b015-97182ce5d525'
     OR (ev.work_date='2026-06-19')
)
SELECT * FROM recon ORDER BY work_date, emp;
