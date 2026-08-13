from __future__ import annotations

from config import (
    DISPATCH_STATUS_CANCELLED,
    DISPATCH_STATUS_SHIPPED,
    RECEIPT_STATUS_CANCELLED,
    RECEIPT_STATUS_DONE,
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_RELOCATING,
)

# «Активные» документы для справочника скана = живые, не терминальные.
# Поступление: всё, кроме завершённого/аннулированного.
_RECEIPT_TERMINAL = (RECEIPT_STATUS_DONE, RECEIPT_STATUS_CANCELLED)
# Задача упаковки: только живой цикл; `packed`/легаси/`shipped`/`completed_no_goods`
# означают, что упаковка завершена (дальше товар возит dispatch) — это не «участие».
_SHIPMENT_ACTIVE = (
    SHIPMENT_STATUS_DRAFT,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_RELOCATING,
)
# Отгрузка: всё, кроме отгруженной/аннулированной (partially_shipped ещё живой).
_DISPATCH_TERMINAL = (DISPATCH_STATUS_SHIPPED, DISPATCH_STATUS_CANCELLED)


def _placeholders(n: int) -> str:
    return ",".join("?" * n)


def variant_context(connection, variant_id: str) -> list[dict]:
    """Живые документы (поступления / задачи упаковки / отгрузки), где участвует вариант.

    Сопоставление по тройке товар+цвет+размер (строки документов хранят её, не variant_id).
    """
    v = connection.execute(
        "SELECT product_id, color_id, size_id FROM product_variants "
        "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (variant_id,),
    ).fetchone()
    if not v:
        return []
    pid = str(v["product_id"])
    color_id = str(v["color_id"]) if v["color_id"] else None
    size_id = str(v["size_id"]) if v["size_id"] else None
    key = (pid, color_id, size_id)

    docs: list[dict] = []

    receipt_rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.status,
               SUM(l.planned_qty) AS planned,
               SUM(COALESCE(l.accepted_qty, 0)) AS done
        FROM receipt_lines l
        JOIN receipt_docs d ON d.id = l.doc_id
        WHERE l.product_id = ?
          AND l.color_id IS NOT DISTINCT FROM ?::text
          AND l.size_id  IS NOT DISTINCT FROM ?::text
          AND COALESCE(l.is_deleted, 0) = 0
          AND COALESCE(d.is_deleted, 0) = 0
          AND d.status NOT IN ({_placeholders(len(_RECEIPT_TERMINAL))})
        GROUP BY d.id, d.doc_number, d.status
        ORDER BY d.doc_number
        """,
        (*key, *_RECEIPT_TERMINAL),
    ).fetchall()
    for r in receipt_rows:
        docs.append({
            "doc_type": "receipt",
            "doc_id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "status": str(r["status"]),
            "planned_qty": int(r["planned"] or 0),
            "done_qty": int(r["done"] or 0),
        })

    shipment_rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.status, d.cargo_type, d.priority_rank,
               SUM(l.qty) AS planned,
               SUM(COALESCE(l.shipped_qty, 0)) AS done
        FROM shipment_lines l
        JOIN shipment_docs d ON d.id = l.doc_id
        WHERE l.product_id = ?
          AND l.color_id IS NOT DISTINCT FROM ?::text
          AND l.size_id  IS NOT DISTINCT FROM ?::text
          AND COALESCE(l.is_deleted, 0) = 0
          AND COALESCE(d.is_deleted, 0) = 0
          AND d.status IN ({_placeholders(len(_SHIPMENT_ACTIVE))})
        GROUP BY d.id, d.doc_number, d.status, d.cargo_type, d.priority_rank
        ORDER BY d.doc_number
        """,
        (*key, *_SHIPMENT_ACTIVE),
    ).fetchall()
    for r in shipment_rows:
        docs.append({
            "doc_type": "shipment",
            "doc_id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "status": str(r["status"]),
            "cargo_type": str(r["cargo_type"]) if r["cargo_type"] else None,
            "priority_rank": int(r["priority_rank"]) if r["priority_rank"] is not None else None,
            "planned_qty": int(r["planned"] or 0),
            "done_qty": int(r["done"] or 0),
        })

    dispatch_rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.status, d.priority_rank,
               SUM(l.qty) AS planned,
               SUM(COALESCE(l.shipped_qty, 0)) AS done
        FROM dispatch_lines l
        JOIN dispatch_docs d ON d.id = l.doc_id
        WHERE l.product_id = ?
          AND l.color_id IS NOT DISTINCT FROM ?::text
          AND l.size_id  IS NOT DISTINCT FROM ?::text
          AND COALESCE(l.is_deleted, 0) = 0
          AND COALESCE(d.is_deleted, 0) = 0
          AND d.status NOT IN ({_placeholders(len(_DISPATCH_TERMINAL))})
        GROUP BY d.id, d.doc_number, d.status, d.priority_rank
        ORDER BY d.doc_number
        """,
        (*key, *_DISPATCH_TERMINAL),
    ).fetchall()
    for r in dispatch_rows:
        docs.append({
            "doc_type": "dispatch",
            "doc_id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "status": str(r["status"]),
            "priority_rank": int(r["priority_rank"]) if r["priority_rank"] is not None else None,
            "planned_qty": int(r["planned"] or 0),
            "done_qty": int(r["done"] or 0),
        })

    return docs


def location_context(connection, location_id: str) -> list[dict]:
    """Живые документы, привязанные к месту: поступления кладут в него (storage_zone_id),
    задачи упаковки берут из него (storage_zone_id).

    v1: целевые зоны раскладки (упаковка/отгрузка) фиксируются в журнале при перемещении и
    в строках не хранятся — здесь не покрыты. Что лежит в ячейке сейчас — отдельный блок
    (остатки по месту), этот список отвечает на «подо что место занято».
    """
    docs: list[dict] = []

    receipt_rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.status
        FROM receipt_lines l
        JOIN receipt_docs d ON d.id = l.doc_id
        WHERE l.storage_zone_id = ?
          AND COALESCE(l.is_deleted, 0) = 0
          AND COALESCE(d.is_deleted, 0) = 0
          AND d.status NOT IN ({_placeholders(len(_RECEIPT_TERMINAL))})
        GROUP BY d.id, d.doc_number, d.status
        ORDER BY d.doc_number
        """,
        (location_id, *_RECEIPT_TERMINAL),
    ).fetchall()
    for r in receipt_rows:
        docs.append({
            "doc_type": "receipt",
            "doc_id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "status": str(r["status"]),
        })

    shipment_rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, d.status, d.cargo_type, d.priority_rank
        FROM shipment_lines l
        JOIN shipment_docs d ON d.id = l.doc_id
        WHERE l.storage_zone_id = ?
          AND COALESCE(l.is_deleted, 0) = 0
          AND COALESCE(d.is_deleted, 0) = 0
          AND d.status IN ({_placeholders(len(_SHIPMENT_ACTIVE))})
        GROUP BY d.id, d.doc_number, d.status, d.cargo_type, d.priority_rank
        ORDER BY d.doc_number
        """,
        (location_id, *_SHIPMENT_ACTIVE),
    ).fetchall()
    for r in shipment_rows:
        docs.append({
            "doc_type": "shipment",
            "doc_id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "status": str(r["status"]),
            "cargo_type": str(r["cargo_type"]) if r["cargo_type"] else None,
            "priority_rank": int(r["priority_rank"]) if r["priority_rank"] is not None else None,
        })

    return docs
