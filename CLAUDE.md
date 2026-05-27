# Warehouse WMS — Claude instructions

## Database
- PostgreSQL (psycopg). The `dbconn.py` adapter auto-converts `?` → `%s`, so `?` placeholders are fine in queries.
- Boolean columns use integers (0/1), not TRUE/FALSE — `COALESCE(is_deleted, 0) = 0` is correct.

## Inventory system — legacy warning
`inventory_operations` is **dead legacy (v1)**. It has ~8 rows and is only populated by an old Excel import path. **Never use it for balance/stock/defect calculations.**

All real inventory data lives in:
- `receipt2_docs`, `receipt2_lines`, `receipt2_ops` — receipts
- `shipment2_docs`, `shipment2_lines` — shipments

Use these tables for any stock, good qty, or defect qty queries.
