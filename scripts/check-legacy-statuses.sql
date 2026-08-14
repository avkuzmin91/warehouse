-- Проверка: остались ли живые документы в легаси-статусах.
-- Receipts: on_intake / on_review — легаси приёмки до перехода на рейсы.
-- Shipments: awaiting_trip легален для брак-потока (терминал), для good — легаси;
--            partially_shipped / shipped — легаси всегда (перевозку делает dispatch).
-- Read-only, можно гонять на проде без последствий.

SELECT 'receipt_docs' AS src, status, COUNT(*) AS cnt
FROM receipt_docs
WHERE COALESCE(is_deleted, 0) = 0
GROUP BY status
ORDER BY status;

SELECT 'shipment_docs' AS src, status, COALESCE(cargo_type, 'good') AS cargo, COUNT(*) AS cnt
FROM shipment_docs
WHERE COALESCE(is_deleted, 0) = 0
GROUP BY status, COALESCE(cargo_type, 'good')
ORDER BY status, cargo;
