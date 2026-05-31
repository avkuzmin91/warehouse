from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_STATUS_SHIPPED,
    SHIPMENT_TRANSITIONS,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def next_doc_number(connection) -> str:
    """Генерирует следующий номер документа отгрузки.

    Использует MAX вместо COUNT, чтобы не давать дубликатов при пустых дырках.
    UNIQUE constraint на doc_number в baseline-миграции гарантирует атомарность.
    """
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, 5) AS INTEGER)), 0) AS max_n
        FROM shipment_docs
        WHERE doc_number LIKE 'SHP-%'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"SHP-{n:04d}"


def normalize_cargo_type(raw: str | None) -> str:
    s = str(raw or SHIPMENT_CARGO_GOOD).strip().lower()
    return s if s in (SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT) else SHIPMENT_CARGO_GOOD


def _check_stock_for_shipment(connection, doc_id: str) -> None:
    """Проверяет доступность остатков для всех строк документа.

    Вызывается перед переходом packing → shipped.
    Бросает HTTPException(409) если какой-то позиции не хватает.
    """
    from modules.balances.service import get_available_good_qty_by_zone

    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchall()

    doc_row = connection.execute(
        "SELECT client_id, cargo_type FROM shipment_docs WHERE id = ?",
        (doc_id,),
    ).fetchone()

    cargo_type = normalize_cargo_type(doc_row["cargo_type"] if doc_row else None)

    for line in lines:
        shipped_qty = int(line["shipped_qty"] or 0)
        plan_qty = int(line["qty"] or 0)
        if shipped_qty <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Укажите отгруженное количество больше 0 для «{line['product_name']}»",
            )
        if shipped_qty > plan_qty:
            raise HTTPException(
                status_code=400,
                detail=f"Отгруженное количество не должно превышать план для «{line['product_name']}»",
            )

    # Проверка остатков только для отгрузки годного товара.
    # Для брака остатки считаются отдельно — пока не блокируем.
    if cargo_type != SHIPMENT_CARGO_GOOD:
        return

    client_id = doc_row["client_id"] if doc_row else None

    for line in lines:
        shipped_qty = int(line["shipped_qty"] or 0)
        if not line["storage_zone_id"]:
            raise HTTPException(
                status_code=400,
                detail=f"Выберите место хранения для «{line['product_name']}»",
            )
        available = get_available_good_qty_by_zone(
            connection,
            product_id=str(line["product_id"]),
            color_id=line["color_id"],
            size_id=line["size_id"],
            client_id=client_id,
            storage_zone_id=line["storage_zone_id"],
        )
        if available < shipped_qty:
            zone_label = line["storage_zone_name"] or "Без зоны"
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Недостаточно товара в зоне «{zone_label}» для «{line['product_name']}» "
                    f"(нужно {shipped_qty}, доступно {available})"
                ),
            )


def _check_duplicate_lines(connection, doc_id: str) -> None:
    """Проверяет отсутствие дублей товар+зона перед переходом статуса."""
    rows = connection.execute(
        """SELECT MIN(product_name) AS product_name,
                  MIN(storage_zone_name) AS storage_zone_name,
                  storage_zone_id,
                  COUNT(*) AS cnt
           FROM shipment_lines
           WHERE doc_id = ? AND is_deleted = 0
           GROUP BY product_id, color_id, size_id, storage_zone_id
           HAVING COUNT(*) > 1
           LIMIT 1""",
        (doc_id,),
    ).fetchone()
    if rows:
        zone_label = rows["storage_zone_name"] or ("без зоны" if rows["storage_zone_id"] is None else rows["storage_zone_id"])
        raise HTTPException(
            status_code=400,
            detail=f"Товар «{rows['product_name']}» добавлен дважды в зону «{zone_label}» — удалите дубль перед сохранением",
        )


def advance_shipment(connection, doc_id: str, user_id: str) -> str:
    """Переводит документ на следующий статус. При переходе packing → shipped проверяет остатки."""
    row = connection.execute(
        "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Документ не найден")

    current = str(row["status"])
    next_status = SHIPMENT_TRANSITIONS.get(current)
    if not next_status:
        raise HTTPException(status_code=400, detail=f"Нельзя продвинуть из статуса «{current}»")

    _check_duplicate_lines(connection, doc_id)
    if next_status == SHIPMENT_STATUS_SHIPPED:
        _check_stock_for_shipment(connection, doc_id)

    now = _now()
    connection.execute(
        "UPDATE shipment_docs SET status=?, updated_at=? WHERE id=?",
        (next_status, now, doc_id),
    )
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, "advance", f"{current} → {next_status}", now, user_id),
    )
    connection.commit()
    return next_status
