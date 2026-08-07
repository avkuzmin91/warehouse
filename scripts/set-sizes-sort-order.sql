-- Проставить sizes.sort_order по текущим значениям справочника (прод, разово).
-- Правила:
--   буквенные размеры  → фиксированная сетка: XXS=10, XS=20, S=30, M=40, L=50,
--                        XL=60, XXL/2XL=70, XXXL/3XL=80, 4XL=90, 5XL=100
--   числовые («44», «44-46», «46/48») → 1000 + первое число (внутри одного
--                        артикула соседствуют только размеры одной сетки,
--                        поэтому диапазоны букв и чисел не конфликтуют)
--   прочее («One size», «Универсальный») → остаётся NULL (после упорядоченных)
-- Обновляются только записи с sort_order IS NULL — вручную заданный порядок не трогаем.

BEGIN;

UPDATE sizes
SET sort_order = CASE UPPER(TRIM(name))
    WHEN 'XXS'  THEN 10
    WHEN 'XS'   THEN 20
    WHEN 'S'    THEN 30
    WHEN 'M'    THEN 40
    WHEN 'L'    THEN 50
    WHEN 'XL'   THEN 60
    WHEN 'XXL'  THEN 70
    WHEN '2XL'  THEN 70
    WHEN 'XXXL' THEN 80
    WHEN '3XL'  THEN 80
    WHEN '4XL'  THEN 90
    WHEN '5XL'  THEN 100
END
WHERE sort_order IS NULL
  AND UPPER(TRIM(name)) IN ('XXS','XS','S','M','L','XL','XXL','2XL','XXXL','3XL','4XL','5XL');

UPDATE sizes
SET sort_order = 1000 + (substring(TRIM(name) FROM '^\d+'))::int
WHERE sort_order IS NULL
  AND TRIM(name) ~ '^\d+([-/].*)?$';

-- Контроль: итоговый порядок, как его увидят списки.
SELECT name, sort_order, is_active
FROM sizes
WHERE COALESCE(is_deleted, 0) = 0
ORDER BY sort_order IS NULL, sort_order, LOWER(name);

COMMIT;
