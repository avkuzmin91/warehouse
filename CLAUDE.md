# Warehouse WMS — Claude instructions

## Database
- PostgreSQL (psycopg). The `dbconn.py` adapter auto-converts `?` → `%s`, so `?` placeholders are fine in queries.
- Boolean columns use integers (0/1), not TRUE/FALSE — `COALESCE(is_deleted, 0) = 0` is correct.

## Inventory tables
All real inventory data lives in these tables (current names after migration 0002):

**Receipts**
- `receipt_docs` — документы поступлений
- `receipt_lines` — строки (товар, SKU, плановые кол-ва)
- `receipt_ops` — журнал операций (приёмка, брак, QC)

**Shipments**
- `shipment_docs` — документы отгрузок
- `shipment_lines` — строки (товар, SKU, кол-ва)
- `shipment_ops` — журнал операций

**Балансы** считаются из `receipt_ops` (op_type: receiving / receiving_correction / defect_fix / defect_correction) минус `shipment_lines` где `shipment_docs.status = 'shipped'`.

## Legacy — не использовать
- `inventory_operations` — удалена (migration 0003). Не использовать ни в каких расчётах.
- `app_migrations` — удалена (migration 0004).
- Имена `receipt2_*` / `shipment2_*` — исторические, таблиц с таким именем больше нет.
