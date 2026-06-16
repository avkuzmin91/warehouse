from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    INV_OP_INTAKE,
    INV_OP_STORAGE,
    INV_Q_GOOD,
    RECEIPT_OP_ARRIVAL_ACCEPT,
    RECEIPT_OP_ARRIVAL_FIX,
    RECEIPT_OP_PLAN_FIX,
    RECEIPT_OP_RECEIVING_CORRECTION,
    RECEIPT_STATUS_CANCELLED,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_RU,
    RECEIPT_STATUS_TRANSITIONS,
    TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_CANCELLED,
    TRIP_STATUS_DRAFT,
    TRIP_STATUS_UNLOADING,
)
from dbconn import like_substring_param


def _now() -> str:
    return datetime.now(UTC).isoformat()


def next_doc_number(connection) -> str:
    """Генерирует следующий номер документа поступления.

    Использует MAX вместо COUNT, чтобы не давать дубликатов при пустых дырках.
    UNIQUE constraint на doc_number в baseline-миграции гарантирует атомарность.
    """
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, 4) AS INTEGER)), 0) AS max_n
        FROM receipt_docs
        WHERE doc_number LIKE 'WH-%'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"WH-{n:05d}"


def compute_state(connection, doc_id: str) -> dict:
    """Сводка документа поступления по строкам (без QC — годность определяется при упаковке)."""
    lines_rows = connection.execute(
        "SELECT * FROM receipt_lines WHERE doc_id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchall()

    line_list = [
        {
            "id": str(lr["id"]),
            "product_id": str(lr["product_id"]),
            "product_name": str(lr["product_name"]),
            "product_sku": str(lr["product_sku"]),
            "color_id": lr["color_id"],
            "color_name": lr["color_name"],
            "size_id": lr["size_id"],
            "size_name": lr["size_name"],
            "storage_zone_id": lr["storage_zone_id"],
            "storage_zone_name": lr["storage_zone_name"],
            "planned_qty": int(lr["planned_qty"]),
            "accepted_qty": int(lr["accepted_qty"]) if lr["accepted_qty"] is not None else None,
        }
        for lr in lines_rows
    ]

    return {
        "lines": line_list,
        "sku_count": len(line_list),
        "total_planned": sum(l["planned_qty"] for l in line_list),
        "total_accepted_qty": sum(l["accepted_qty"] or 0 for l in line_list),
    }


def list_receipts_aggregated(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    status: str | None,
    overdue: bool,
    search: str | None,
    sku: str | None,
    date_from: str | None,
    date_to: str | None,
    unlinked_to_trip: bool,
    available_for_trip_id: str | None,
    statuses_all: frozenset[str],
) -> tuple[int, list[dict]]:
    """Агрегирующий запрос для списка поступлений — без N+1.

    Возвращает (total, rows). Каждый row содержит агрегаты sku_count, total_planned,
    total_accepted, total_defect, вычисленные одним SQL.
    """
    from datetime import date as _date
    today = _date.today().isoformat()

    conds = ["d.is_deleted = 0"]
    params: list = []

    if client_id:
        conds.append("d.client_id = ?")
        params.append(client_id.strip())
    if overdue:
        conds.append("d.status IN ('planned', 'on_intake', 'on_review')")
        conds.append("d.arrival_date < ?")
        params.append(today)
    elif status:
        # Поддерживаем как одно значение, так и CSV ("planned,partially_received" —
        # кандидаты для привязки к рейсу).
        requested = [s.strip() for s in str(status).split(",") if s.strip()]
        allowed = [s for s in requested if s in statuses_all]
        if len(allowed) == 1:
            conds.append("d.status = ?")
            params.append(allowed[0])
        elif len(allowed) > 1:
            placeholders = ",".join("?" for _ in allowed)
            conds.append(f"d.status IN ({placeholders})")
            params.extend(allowed)
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR COALESCE(cl.name,'') LIKE ?)")
        params += [s, s]
    if sku:
        conds.append(
            "EXISTS (SELECT 1 FROM receipt_lines rl"
            " WHERE rl.doc_id = d.id AND COALESCE(rl.is_deleted,0)=0 AND rl.product_sku LIKE ?)"
        )
        params.append(like_substring_param(sku))
    if date_from:
        conds.append("d.arrival_date >= ?")
        params.append(date_from)
    if date_to:
        conds.append("d.arrival_date <= ?")
        params.append(date_to)
    if available_for_trip_id and str(available_for_trip_id).strip():
        # Поступление может приезжать несколькими рейсами: исключаем только привязанные
        # к ЭТОМУ рейсу; привязанные к другим рейсам остаются кандидатами (остаток).
        conds.append(
            "NOT EXISTS (SELECT 1 FROM trip_lines tl"
            " WHERE tl.receipt_doc_id = d.id AND COALESCE(tl.is_deleted, 0) = 0 AND tl.trip_id = ?)"
        )
        params.append(str(available_for_trip_id).strip())
    elif unlinked_to_trip:
        conds.append(
            "NOT EXISTS (SELECT 1 FROM trip_lines tl"
            " WHERE tl.receipt_doc_id = d.id AND COALESCE(tl.is_deleted, 0) = 0)"
        )

    where = " AND ".join(conds)

    # В контексте подбора кандидатов для рейса (фильтры привязки к рейсу) сортируем по
    # свежести работы с документом, а не по дате прибытия: иначе только что принятое
    # поступление с проставленной датой тонет под недатированными, и при limit его не
    # видно в пикере. На обычном списке (без этих фильтров) — порядок по дате прибытия.
    candidate_context = bool(
        (available_for_trip_id and str(available_for_trip_id).strip()) or unlinked_to_trip
    )
    order_by = (
        "COALESCE(d.updated_at, d.created_at) DESC, d.created_at DESC"
        if candidate_context
        else "COALESCE(d.actual_arrival_date, d.arrival_date) DESC, d.created_at DESC"
    )

    total_row = connection.execute(
        f"SELECT COUNT(*) AS cnt FROM receipt_docs d LEFT JOIN clients cl ON cl.id = d.client_id WHERE {where}",
        params,
    ).fetchone()
    total = int(total_row["cnt"]) if total_row else 0

    offset = (page - 1) * limit

    # Агрегаты по строкам вычисляются одним JOIN — нет N+1.
    # accepted = последняя receiving_correction ИЛИ сумма receiving.
    # defect   = последняя defect_correction ИЛИ сумма defect_fix.
    rows = connection.execute(
        f"""
        SELECT
            d.id, d.doc_number, d.client_id, d.supplier_name, d.arrival_date,
            d.actual_arrival_date,
            d.comment, d.status, d.zone_id, d.zone_name, d.ttn, d.logistics_cost,
            d.created_at, d.created_by,
            MAX(cl.name) AS client_name,
            COUNT(DISTINCT CASE WHEN l.is_deleted = 0 THEN l.id END) AS sku_count,
            COALESCE(SUM(CASE WHEN l.is_deleted = 0 THEN l.planned_qty ELSE 0 END), 0) AS total_planned,
            COALESCE(SUM(CASE WHEN l.is_deleted = 0 THEN COALESCE(l.accepted_qty, 0) ELSE 0 END), 0) AS total_accepted_qty
        FROM receipt_docs d
        LEFT JOIN clients cl ON cl.id = d.client_id
        LEFT JOIN receipt_lines l ON l.doc_id = d.id
        WHERE {where}
        GROUP BY d.id
        ORDER BY {order_by}
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    return total, [dict(r) for r in rows]


def list_receipt_lines(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    status: str | None,
    overdue: bool,
    search: str | None,
    sku: str | None,
    date_from: str | None,
    date_to: str | None,
    statuses_all: frozenset[str],
) -> tuple[int, list[dict]]:
    """Плоский список позиций поступлений (разрез «По товарам»): одна строка = строка документа."""
    from datetime import date as _date
    today = _date.today().isoformat()

    conds = ["d.is_deleted = 0", "l.is_deleted = 0"]
    params: list = []

    if client_id:
        conds.append("d.client_id = ?")
        params.append(client_id.strip())
    if overdue:
        conds.append("d.status IN ('planned', 'on_intake', 'on_review')")
        conds.append("d.arrival_date < ?")
        params.append(today)
    elif status:
        # Поддерживаем как одно значение, так и CSV ("planned,partially_received" —
        # кандидаты для привязки к рейсу).
        requested = [s.strip() for s in str(status).split(",") if s.strip()]
        allowed = [s for s in requested if s in statuses_all]
        if len(allowed) == 1:
            conds.append("d.status = ?")
            params.append(allowed[0])
        elif len(allowed) > 1:
            placeholders = ",".join("?" for _ in allowed)
            conds.append(f"d.status IN ({placeholders})")
            params.extend(allowed)
    if search:
        s = like_substring_param(search)
        conds.append("(d.doc_number LIKE ? OR COALESCE(cl.name,'') LIKE ?)")
        params += [s, s]
    if sku:
        s = like_substring_param(sku)
        conds.append("(l.product_sku LIKE ? OR l.product_name LIKE ?)")
        params += [s, s]
    if date_from:
        conds.append("d.arrival_date >= ?")
        params.append(date_from)
    if date_to:
        conds.append("d.arrival_date <= ?")
        params.append(date_to)

    where = " AND ".join(conds)

    total_row = connection.execute(
        f"""SELECT COUNT(*) AS cnt
            FROM receipt_lines l
            JOIN receipt_docs d ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE {where}""",
        params,
    ).fetchone()
    total = int(total_row["cnt"]) if total_row else 0

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""SELECT
                l.id AS line_id, l.doc_id,
                l.product_id, l.product_name, l.product_sku,
                l.color_name, l.size_name,
                l.planned_qty, l.accepted_qty, l.storage_zone_name,
                d.doc_number, d.client_id, d.arrival_date, d.actual_arrival_date, d.status,
                cl.name AS client_name
            FROM receipt_lines l
            JOIN receipt_docs d ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE {where}
            ORDER BY COALESCE(d.actual_arrival_date, d.arrival_date) DESC, d.created_at DESC, l.created_at
            LIMIT ? OFFSET ?""",
        params + [limit, offset],
    ).fetchall()

    return total, [dict(r) for r in rows]


def arrived_qty_by_line(connection, doc_id: str, *, exclude_trip_id: str | None = None) -> dict[str, int]:
    """Сколько каждой строки уже привезли разгруженные рейсы — план приёмки в карточке.

    Строки без распределения по рейсам (ручное поступление) — весь план: приёмка идёт
    по плану. Рейсовые строки — сумма аллокаций по рейсам, которые уже разгружены
    (unload_finished_at задан) и не отменены. `exclude_trip_id` исключает конкретный
    рейс — нужно при его отмене, пока он ещё не помечен отменённым. Кладовщик не может
    принять больше, чем фактически привезли.
    """
    exclude_sql = "AND td.id != ?" if exclude_trip_id else ""
    params: list = [TRIP_STATUS_CANCELLED]
    if exclude_trip_id:
        params.append(exclude_trip_id)
    params.append(doc_id)
    rows = connection.execute(
        f"""SELECT rl.id AS line_id, rl.planned_qty AS planned,
                  EXISTS(SELECT 1 FROM trip_alloc ta
                         WHERE ta.receipt_line_id = rl.id AND COALESCE(ta.is_deleted, 0) = 0) AS has_alloc,
                  COALESCE((SELECT SUM(ta.qty) FROM trip_alloc ta
                            JOIN trip_lines tl ON tl.id = ta.trip_line_id
                            JOIN trip_docs td ON td.id = tl.trip_id
                            WHERE ta.receipt_line_id = rl.id
                              AND COALESCE(ta.is_deleted, 0) = 0
                              AND COALESCE(tl.is_deleted, 0) = 0
                              AND td.status != ?
                              AND td.unload_finished_at IS NOT NULL
                              {exclude_sql}), 0) AS arrived
           FROM receipt_lines rl
           WHERE rl.doc_id = ? AND COALESCE(rl.is_deleted, 0) = 0""",
        params,
    ).fetchall()
    out: dict[str, int] = {}
    for r in rows:
        out[str(r["line_id"])] = int(r["planned"]) if not r["has_alloc"] else int(r["arrived"] or 0)
    return out


def receipt_alloc_remaining(connection, doc_id: str) -> dict[str, int]:
    """Остаток к распределению по строкам поступления: planned − активные trip_alloc.

    Исключает аллокации отменённых рейсов. Гейт пере-аллокации при привязке к рейсу.
    """
    rows = connection.execute(
        """SELECT rl.id AS line_id, rl.planned_qty AS planned,
                  COALESCE((SELECT SUM(ta.qty) FROM trip_alloc ta
                            JOIN trip_lines tl ON tl.id = ta.trip_line_id
                            JOIN trip_docs td ON td.id = tl.trip_id
                            WHERE ta.receipt_line_id = rl.id
                              AND COALESCE(ta.is_deleted, 0) = 0
                              AND COALESCE(tl.is_deleted, 0) = 0
                              AND td.status != ?), 0) AS allocated
           FROM receipt_lines rl
           WHERE rl.doc_id = ? AND COALESCE(rl.is_deleted, 0) = 0""",
        (TRIP_STATUS_CANCELLED, doc_id),
    ).fetchall()
    return {str(r["line_id"]): int(r["planned"]) - int(r["allocated"]) for r in rows}


def _has_pending_delivery_trip(connection, doc_id: str) -> bool:
    """Есть ли привязанный рейс, который ещё может что-то привезти (черновик / в пути / разгрузка)."""
    row = connection.execute(
        "SELECT 1 FROM trip_lines tl "
        "JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
        "WHERE tl.receipt_doc_id = ? AND COALESCE(tl.is_deleted, 0) = 0 "
        "AND t.status IN (?,?,?) LIMIT 1",
        (doc_id, TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_UNLOADING),
    ).fetchone()
    return row is not None


def receipt_shortage_final(connection, doc_id: str) -> bool:
    """True, если приёмка рейсами завершилась недопоставкой и ждёт решения менеджера.

    «Рейсы кончились, привезли меньше плана» = три условия:
      • статус «Частично принято» (что-то принято, план не закрыт);
      • нет активного рейса — всё, что разложено по рейсам, уже привезли;
      • план разложен по рейсам на 100% (распределять больше нечего) — иначе это не
        недопоставка, а ожидание следующего рейса.
    Это гейт для close-short и источник задачи менеджеру.
    """
    row = connection.execute(
        "SELECT status FROM receipt_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchone()
    if not row or str(row["status"]) != RECEIPT_STATUS_PARTIALLY_RECEIVED:
        return False
    if _has_pending_delivery_trip(connection, doc_id):
        return False
    remaining = receipt_alloc_remaining(connection, doc_id)
    return all(v <= 0 for v in remaining.values())


def list_shortage_receipts(connection) -> list[dict]:
    """Поступления, завершившие приёмку недопоставкой — кандидаты на close-short.

    Источник задачи менеджеру «Закрыть поступление с недопоставкой»; условие —
    receipt_shortage_final по каждому «Частично принятому» документу.
    """
    rows = connection.execute(
        "SELECT id, doc_number, updated_at, created_at FROM receipt_docs "
        "WHERE COALESCE(is_deleted, 0) = 0 AND status = ? ORDER BY updated_at DESC",
        (RECEIPT_STATUS_PARTIALLY_RECEIVED,),
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        doc_id = str(r["id"])
        if _has_pending_delivery_trip(connection, doc_id):
            continue
        remaining = receipt_alloc_remaining(connection, doc_id)
        if any(v > 0 for v in remaining.values()):
            continue
        out.append({
            "id": doc_id,
            "doc_number": str(r["doc_number"]),
            "since": r["updated_at"] or r["created_at"],
        })
    return out


def release_shortfall_for_redelivery(connection, doc_id: str, uid: str) -> int:
    """«Ожидается довоз»: освобождает недовоз уже разгруженных рейсов под новый рейс.

    Зеркальная close-short ветка той же развилки. Когда рейсы поступления приехали
    короче плана, но недостающее довезут новым рейсом, аллокации разгруженных рейсов
    ужимаются до фактически принятого этим рейсом (intake→storage по штампу
    trip_id+receipt_line_id). За счёт этого receipt_alloc_remaining снова > 0 — план
    перестаёт быть разложенным на 100%, receipt_shortage_final гаснет, и освобождённый
    остаток можно разложить на новый рейс (link_receipts). Сток не трогаем — принятое
    уже лежит на остатках. Возвращает суммарно освобождённое кол-во. Без commit.
    """
    rows = connection.execute(
        """SELECT ta.id AS alloc_id, ta.qty AS alloc_qty, ta.receipt_line_id AS line_id,
                  td.id AS trip_id, td.trip_number,
                  rl.product_sku, rl.color_name, rl.size_name,
                  COALESCE((SELECT SUM(zr.qty) FROM zone_relocations zr
                            WHERE zr.trip_id = td.id
                              AND zr.receipt_line_id = ta.receipt_line_id
                              AND zr.from_op = ? AND zr.to_op = ?), 0) AS delivered
           FROM trip_alloc ta
           JOIN trip_lines tl ON tl.id = ta.trip_line_id
           JOIN trip_docs td ON td.id = tl.trip_id
           JOIN receipt_lines rl ON rl.id = ta.receipt_line_id
           WHERE tl.receipt_doc_id = ?
             AND COALESCE(ta.is_deleted, 0) = 0
             AND COALESCE(tl.is_deleted, 0) = 0
             AND COALESCE(rl.is_deleted, 0) = 0
             AND td.status != ?
             AND td.unload_finished_at IS NOT NULL""",
        (INV_OP_INTAKE, INV_OP_STORAGE, doc_id, TRIP_STATUS_CANCELLED),
    ).fetchall()
    now = _now()
    released_total = 0
    for r in rows:
        alloc_qty = int(r["alloc_qty"] or 0)
        delivered = int(r["delivered"] or 0)
        gap = alloc_qty - delivered
        if gap <= 0:
            continue
        connection.execute(
            "UPDATE trip_alloc SET qty = ? WHERE id = ?", (delivered, str(r["alloc_id"]))
        )
        released_total += gap
        attrs = " / ".join(x for x in [r["color_name"], r["size_name"]] if x)
        label = f"{r['product_sku']}" + (f" ({attrs})" if attrs else "")
        connection.execute(
            "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (str(uuid4()), doc_id, str(r["line_id"]), RECEIPT_OP_ARRIVAL_FIX, gap,
             f"Ожидается довоз: освобождён недовоз {gap} шт. ({label}, рейс {r['trip_number']}: "
             f"принято {delivered} из {alloc_qty} шт.)", now, uid),
        )
    return released_total


def receipt_fully_received(connection, doc_id: str) -> bool:
    """True, если по всем строкам принято не меньше плана (приёмка завершена)."""
    row = connection.execute(
        """SELECT COUNT(*) AS pending
           FROM receipt_lines
           WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0
             AND COALESCE(accepted_qty, 0) < planned_qty""",
        (doc_id,),
    ).fetchone()
    return int(row["pending"]) == 0 if row else True


def recompute_trip_receipt_status(connection, doc_id: str, user_id: str, *, note: str) -> None:
    """Производный статус рейсового поступления по принятому количеству.

    Приёмка рейсовых поступлений идёт в рейсе (см. receive_receipts_for_trip),
    поэтому статус документа — функция от принятого: всё принято → done «Завершён»;
    что-то принято, но план не закрыт → partially_received «Частично принято»;
    ничего не принято → planned «В плане». Из cancelled не выводим (отменённый
    документ не воскрешаем); из done выводим — нужно при сторно отмены рейса.
    Без commit — коммитит вызывающий.
    """
    cur = connection.execute(
        "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not cur:
        return
    status = str(cur["status"])
    if status == RECEIPT_STATUS_CANCELLED:
        return
    agg = connection.execute(
        "SELECT COALESCE(SUM(accepted_qty), 0) AS acc, COUNT(*) AS n "
        "FROM receipt_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchone()
    accepted = int(agg["acc"]) if agg else 0
    n = int(agg["n"]) if agg else 0
    if n > 0 and receipt_fully_received(connection, doc_id):
        new_status = RECEIPT_STATUS_DONE
    elif accepted > 0:
        new_status = RECEIPT_STATUS_PARTIALLY_RECEIVED
    else:
        new_status = RECEIPT_STATUS_PLANNED
    if new_status == status:
        return
    now = _now()
    connection.execute(
        "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
        (new_status, now, doc_id),
    )
    connection.execute(
        "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (
            str(uuid4()), doc_id, RECEIPT_OP_ARRIVAL_FIX,
            f"{RECEIPT_STATUS_RU.get(status, status)} → {RECEIPT_STATUS_RU[new_status]} ({note})",
            now, user_id,
        ),
    )


def correct_received(
    connection, doc_id: str, line_id: str, *,
    new_accepted: int, reason: str, uid: str,
) -> dict:
    """Пост-фактум корректировка обсчёта приёмщика по строке принятого поступления.

    Правит не голое число, а дельту: синхронно меняет accepted_qty И сток в журнале
    (intake→storage на +дельту / storage→intake на −дельту), пишет receiving_correction
    и пересчитывает статус. Гейты: вверх — не выше привезённого рейсами; вниз — не ниже
    того, что ещё лежит в зоне (иначе сначала реверс downstream). Без commit.
    """
    from modules.balances.service import insert_inventory_move, net_storage_good_in_zone

    doc = connection.execute(
        "SELECT d.status, d.client_id, cl.name AS client_name FROM receipt_docs d "
        "LEFT JOIN clients cl ON cl.id = d.client_id WHERE d.id = ? AND d.is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(doc["status"]) not in (RECEIPT_STATUS_PARTIALLY_RECEIVED, RECEIPT_STATUS_DONE):
        raise HTTPException(
            status_code=400,
            detail="Корректировать принятое можно только у принятого поступления (частично принято / завершён)",
        )
    line = connection.execute(
        "SELECT * FROM receipt_lines WHERE id = ? AND doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (line_id, doc_id),
    ).fetchone()
    if not line:
        raise HTTPException(status_code=404, detail="Строка не найдена")
    if new_accepted < 0:
        raise HTTPException(status_code=400, detail="Количество не может быть отрицательным")
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Укажите причину корректировки")

    attrs = " / ".join(x for x in [line["color_name"], line["size_name"]] if x)
    label = f"{line['product_sku']}" + (f" ({attrs})" if attrs else "")

    current = int(line["accepted_qty"] or 0)
    delta = new_accepted - current
    if delta == 0:
        return {"changed": False, "accepted_qty": current}

    arrived = arrived_qty_by_line(connection, doc_id).get(line_id, int(line["planned_qty"] or 0))
    if new_accepted > arrived:
        raise HTTPException(
            status_code=400,
            detail=f"Принято не может превышать привезённое рейсами — не больше {arrived} шт. ({label})",
        )

    zone_id = line["storage_zone_id"]
    zone_name = line["storage_zone_name"]
    if not str(zone_id or "").strip():
        raise HTTPException(status_code=400, detail=f"У строки не задано место хранения ({label})")

    move = dict(
        product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
        color_id=line["color_id"], color_name=line["color_name"],
        size_id=line["size_id"], size_name=line["size_name"],
        client_id=doc["client_id"], client_name=doc["client_name"],
        from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
        from_zone_id=zone_id, from_zone_name=zone_name, to_zone_id=zone_id, to_zone_name=zone_name,
        user_id=uid, receipt_line_id=line_id,
    )
    if delta < 0:
        need = -delta
        available = net_storage_good_in_zone(
            connection, product_id=str(line["product_id"]), client_id=doc["client_id"],
            color_id=line["color_id"], size_id=line["size_id"], zone_id=zone_id,
        )
        if available < need:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Нельзя уменьшить на {need} шт.: на хранении в «{zone_name or '—'}» только {available} шт. "
                    f"(остальное уже отгружено или перемещено) — сначала отмените отгрузку/перемещение ({label})"
                ),
            )
        insert_inventory_move(
            connection, from_op=INV_OP_STORAGE, to_op=INV_OP_INTAKE, qty=need,
            comment=f"Корректировка приёмки: −{need} шт. ({reason})", **move,
        )
    else:
        insert_inventory_move(
            connection, from_op=INV_OP_INTAKE, to_op=INV_OP_STORAGE, qty=delta,
            comment=f"Корректировка приёмки: +{delta} шт. ({reason})", **move,
        )

    now = _now()
    connection.execute("UPDATE receipt_lines SET accepted_qty = ? WHERE id = ?", (new_accepted, line_id))
    connection.execute(
        "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
        (str(uuid4()), doc_id, line_id, RECEIPT_OP_RECEIVING_CORRECTION, new_accepted,
         f"Корректировка принятого: {current} → {new_accepted} шт. ({reason}) ({label})", now, uid),
    )
    recompute_trip_receipt_status(connection, doc_id, uid, note="корректировка приёмки")
    return {"changed": True, "delta": delta, "accepted_qty": new_accepted}


def advance_receipt(connection, doc_id: str, user_id: str) -> str:
    """Переводит документ на следующий статус по цепочке. Возвращает новый статус."""
    doc_row = connection.execute(
        "SELECT status FROM receipt_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not doc_row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Документ не найден")

    current = str(doc_row["status"])
    next_status = RECEIPT_STATUS_TRANSITIONS.get(current)
    if next_status is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Документ уже в финальном статусе")

    # Единственный ручной переход — draft → planned (дальше двигает рейс).
    now = _now()
    connection.execute(
        "UPDATE receipt_docs SET status = ?, updated_at = ? WHERE id = ?",
        (next_status, now, doc_id),
    )
    connection.execute(
        "INSERT INTO receipt_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (
            str(uuid4()), doc_id, RECEIPT_OP_PLAN_FIX,
            f"{RECEIPT_STATUS_RU.get(current, current)} → {RECEIPT_STATUS_RU.get(next_status, next_status)}",
            now, user_id,
        ),
    )
    connection.commit()
    return next_status
