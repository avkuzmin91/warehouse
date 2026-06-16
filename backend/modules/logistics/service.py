from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    INV_OP_INTAKE,
    INV_OP_READY,
    INV_OP_SHIPPED,
    INV_OP_STORAGE,
    INV_Q_GOOD,
    RECEIPT_OP_ARRIVAL_ACCEPT,
    RECEIPT_OP_ARRIVAL_FIX,
    RECEIPT_OP_INTAKE_START,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    RECEIPT_STATUS_PLANNED,
    RECEIPT_STATUS_RU,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_OP_PRIORITY_UPDATE,
    SHIPMENT_OP_SHIP,
    SHIPMENT_STATUS_AWAITING_TRIP,
    SHIPMENT_STATUS_CANCELLED,
    SHIPMENT_STATUS_LABELS,
    SHIPMENT_STATUS_PARTIALLY_SHIPPED,
    SHIPMENT_STATUS_SHIPPED,
    TRIP_OP_RECEIPT_LINK,
    TRIP_OP_SHIPMENT_LINK,
)
from dbconn import like_substring_param

_CARGO_RU = {SHIPMENT_CARGO_GOOD: "товар", SHIPMENT_CARGO_DEFECT: "брак"}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def next_trip_number(connection) -> str:
    """Следующий номер рейса формата TR-00001 (MAX, как у поступлений)."""
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(trip_number, 4) AS INTEGER)), 0) AS max_n
        FROM trip_docs
        WHERE trip_number LIKE 'TR-%'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"TR-{n:05d}"


def list_trips_aggregated(
    connection,
    *,
    page: int,
    limit: int,
    direction: str | None,
    status: str | None,
    statuses: list[str] | None,
    carrier_id: str | None,
    search: str | None,
    eta_from: str | None,
    eta_to: str | None,
    statuses_all: frozenset[str],
) -> tuple[int, list[dict]]:
    conds = ["d.is_deleted = 0"]
    params: list = []

    if direction:
        conds.append("d.direction = ?")
        params.append(direction)
    if status and status in statuses_all:
        conds.append("d.status = ?")
        params.append(status)
    elif statuses:
        valid = [s for s in statuses if s in statuses_all]
        if valid:
            placeholders = ",".join("?" for _ in valid)
            conds.append(f"d.status IN ({placeholders})")
            params += valid
    if carrier_id:
        conds.append("d.carrier_id = ?")
        params.append(carrier_id.strip())
    if eta_from:
        conds.append("SUBSTR(d.eta, 1, 10) >= ?")
        params.append(eta_from)
    if eta_to:
        conds.append("SUBSTR(d.eta, 1, 10) <= ?")
        params.append(eta_to)
    if search:
        s = like_substring_param(search)
        conds.append("(d.trip_number LIKE ? OR COALESCE(d.origin_name,'') LIKE ? OR COALESCE(d.carrier_name,'') LIKE ?)")
        params += [s, s, s]

    where = " AND ".join(conds)

    total_row = connection.execute(
        f"SELECT COUNT(*) AS cnt FROM trip_docs d WHERE {where}", params
    ).fetchone()
    total = int(total_row["cnt"]) if total_row else 0

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT
            d.id, d.trip_number, d.direction, d.cargo_type, d.status, d.origin_name, d.carrier_name,
            d.vehicle_type_name, d.eta, d.arrived_at, d.cost_estimate, d.logistics_cost_actual,
            d.created_at,
            COUNT(l.id) AS receipts_count
        FROM trip_docs d
        LEFT JOIN trip_lines l ON l.trip_id = d.id AND l.is_deleted = 0
        WHERE {where}
        GROUP BY d.id
        ORDER BY NULLIF(d.eta, '') IS NULL, NULLIF(d.eta, '') DESC, d.created_at DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    return total, [dict(r) for r in rows]


def link_receipts(connection, trip_id: str, items: list[dict], uid: str) -> int:
    """Привязывает поступления к inbound-рейсу с распределением по строкам.

    items: [{receipt_doc_id, allocations: [{line_id, qty}]}]. Пустой allocations —
    берём весь остаток по каждой строке. Одно поступление может приезжать
    несколькими рейсами; гейт qty ≤ остаток (план − уже распределённое).
    Зеркало link_shipments.
    """
    from modules.receipts.service import receipt_alloc_remaining

    norm: list[tuple[str, list]] = []
    for it in items:
        rid = str(it.get("receipt_doc_id") or "").strip()
        if rid:
            norm.append((rid, it.get("allocations") or []))
    if not norm:
        return 0

    linked_numbers: list[str] = []
    now = _now()
    for rid, allocations in norm:
        rec = connection.execute(
            "SELECT id, doc_number, client_id FROM receipt_docs WHERE id = ? AND is_deleted = 0",
            (rid,),
        ).fetchone()
        if not rec:
            raise HTTPException(status_code=400, detail=f"Поступление не найдено: {rid}")

        # Уже привязано к ЭТОМУ рейсу — заменяем распределение: убираем прежние строки,
        # остаток пересчитываем уже без них (чтобы правка количеств не упёрлась в свой же остаток).
        existing = connection.execute(
            "SELECT id FROM trip_lines WHERE trip_id = ? AND receipt_doc_id = ? AND is_deleted = 0",
            (trip_id, rid),
        ).fetchone()
        if existing:
            connection.execute(
                "UPDATE trip_alloc SET is_deleted = 1 WHERE trip_line_id = ? AND COALESCE(is_deleted, 0) = 0",
                (str(existing["id"]),),
            )

        remaining = receipt_alloc_remaining(connection, rid)
        if allocations:
            alloc_map: dict[str, int] = {}
            for a in allocations:
                lid = str(a.get("line_id") or "").strip()
                qty = int(a.get("qty") or 0)
                if not lid or qty <= 0:
                    continue
                if lid not in remaining:
                    raise HTTPException(status_code=400, detail="Строка не принадлежит поступлению")
                if qty > remaining[lid]:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Превышен остаток по строке поступления {rec['doc_number']}: "
                            f"можно не больше {remaining[lid]} шт."
                        ),
                    )
                alloc_map[lid] = alloc_map.get(lid, 0) + qty
        else:
            alloc_map = {lid: rem for lid, rem in remaining.items() if rem > 0}

        # Пустой alloc_map допустим для поступления без строк; со строками — ошибка.
        if not alloc_map and remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Нет остатка для распределения по поступлению {rec['doc_number']}",
            )

        if existing:
            trip_line_id = str(existing["id"])
        else:
            client_id = rec["client_id"]
            client_row = connection.execute(
                "SELECT name FROM clients WHERE id = ?", (client_id,)
            ).fetchone()
            trip_line_id = str(uuid4())
            connection.execute(
                "INSERT INTO trip_lines (id, trip_id, receipt_doc_id, client_id, client_name, created_at, created_by) "
                "VALUES (?,?,?,?,?,?,?)",
                (trip_line_id, trip_id, rid, client_id,
                 client_row["name"] if client_row else None, now, uid),
            )
        for lid, qty in alloc_map.items():
            connection.execute(
                "INSERT INTO trip_alloc (id, trip_line_id, receipt_line_id, qty, created_at, created_by) "
                "VALUES (?,?,?,?,?,?)",
                (str(uuid4()), trip_line_id, lid, qty, now, uid),
            )
        linked_numbers.append(str(rec["doc_number"]))

    if linked_numbers:
        connection.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_RECEIPT_LINK,
             "Привязаны поступления: " + ", ".join(linked_numbers), now, uid),
        )

    return len(linked_numbers)


def link_shipments(connection, trip_id: str, items: list[dict], uid: str) -> int:
    """Привязывает отгрузки к outbound-рейсу с распределением по строкам.

    items: [{shipment_doc_id, allocations: [{line_id, qty}]}]. Пустой allocations —
    берём весь остаток по каждой строке. Одна отгрузка может ехать несколькими
    рейсами; гейт qty ≤ остаток (план − уже распределённое в любые рейсы). Тип
    груза отгрузки должен совпадать с типом груза рейса.
    """
    from modules.shipments.service import shipment_alloc_remaining

    norm: list[tuple[str, list]] = []
    for it in items:
        sid = str(it.get("shipment_doc_id") or "").strip()
        if sid:
            norm.append((sid, it.get("allocations") or []))
    if not norm:
        return 0

    trip_row = connection.execute(
        "SELECT cargo_type FROM trip_docs WHERE id = ?", (trip_id,)
    ).fetchone()
    trip_cargo = str(trip_row["cargo_type"]) if trip_row and trip_row["cargo_type"] else SHIPMENT_CARGO_GOOD

    linked_numbers: list[str] = []
    now = _now()
    for sid, allocations in norm:
        ship = connection.execute(
            "SELECT id, doc_number, client_id, cargo_type FROM shipment_docs WHERE id = ? AND is_deleted = 0",
            (sid,),
        ).fetchone()
        if not ship:
            raise HTTPException(status_code=400, detail=f"Отгрузка не найдена: {sid}")

        ship_cargo = str(ship["cargo_type"]) if ship["cargo_type"] else SHIPMENT_CARGO_GOOD
        if ship_cargo != trip_cargo:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Отгрузка {ship['doc_number']} ({_CARGO_RU.get(ship_cargo, ship_cargo)}) "
                    f"не подходит для рейса {_CARGO_RU.get(trip_cargo, trip_cargo)}а"
                ),
            )

        # Уже привязана к ЭТОМУ рейсу — заменяем распределение: убираем прежние строки,
        # остаток пересчитываем уже без них (чтобы правка количеств не упёрлась в свой же остаток).
        existing = connection.execute(
            "SELECT id FROM trip_lines WHERE trip_id = ? AND shipment_doc_id = ? AND is_deleted = 0",
            (trip_id, sid),
        ).fetchone()
        if existing:
            connection.execute(
                "UPDATE trip_alloc SET is_deleted = 1 WHERE trip_line_id = ? AND COALESCE(is_deleted, 0) = 0",
                (str(existing["id"]),),
            )

        remaining = shipment_alloc_remaining(connection, sid)
        if allocations:
            alloc_map: dict[str, int] = {}
            for a in allocations:
                lid = str(a.get("line_id") or "").strip()
                qty = int(a.get("qty") or 0)
                if not lid or qty <= 0:
                    continue
                if lid not in remaining:
                    raise HTTPException(status_code=400, detail="Строка не принадлежит отгрузке")
                if qty > remaining[lid]:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Превышен остаток по строке отгрузки {ship['doc_number']}: "
                            f"можно не больше {remaining[lid]} шт."
                        ),
                    )
                alloc_map[lid] = alloc_map.get(lid, 0) + qty
        else:
            alloc_map = {lid: rem for lid, rem in remaining.items() if rem > 0}

        # Пустой alloc_map допустим для отгрузки без строк (каскад спишет ноль);
        # для отгрузки со строками пустой остаток — ошибка (нечего везти).
        if not alloc_map and remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Нет остатка для распределения по отгрузке {ship['doc_number']}",
            )

        if existing:
            trip_line_id = str(existing["id"])
        else:
            client_id = ship["client_id"]
            client_row = connection.execute(
                "SELECT name FROM clients WHERE id = ?", (client_id,)
            ).fetchone()
            trip_line_id = str(uuid4())
            connection.execute(
                "INSERT INTO trip_lines (id, trip_id, shipment_doc_id, client_id, client_name, created_at, created_by) "
                "VALUES (?,?,?,?,?,?,?)",
                (trip_line_id, trip_id, sid, client_id,
                 client_row["name"] if client_row else None, now, uid),
            )
        for lid, qty in alloc_map.items():
            connection.execute(
                "INSERT INTO trip_alloc (id, trip_line_id, shipment_line_id, qty, created_at, created_by) "
                "VALUES (?,?,?,?,?,?)",
                (str(uuid4()), trip_line_id, lid, qty, now, uid),
            )
        linked_numbers.append(str(ship["doc_number"]))

    if linked_numbers:
        connection.execute(
            "INSERT INTO trip_ops (id, trip_id, op_type, comment, created_at, created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), trip_id, TRIP_OP_SHIPMENT_LINK,
             "Привязаны отгрузки: " + ", ".join(linked_numbers), now, uid),
        )

    return len(linked_numbers)


def sync_actual_arrival(connection, trip_id: str, arrived_at: str | None) -> None:
    """Копирует фактическую дату прибытия рейса в привязанные поступления.

    Берём дату из `arrived_at` (YYYY-MM-DDTHH:mm → YYYY-MM-DD). Пустое значение → NULL.
    """
    date_part = (str(arrived_at).strip()[:10] or None) if arrived_at else None
    connection.execute(
        "UPDATE receipt_docs SET actual_arrival_date = ? "
        "WHERE id IN (SELECT receipt_doc_id FROM trip_lines WHERE trip_id = ? AND COALESCE(is_deleted, 0) = 0)",
        (date_part, trip_id),
    )


def sync_actual_ship_date(connection, trip_id: str, arrived_at: str | None) -> None:
    """Копирует фактическую дату прибытия машины в привязанные отгрузки."""
    date_part = (str(arrived_at).strip()[:10] or None) if arrived_at else None
    connection.execute(
        "UPDATE shipment_docs SET actual_ship_date = ? "
        "WHERE id IN (SELECT shipment_doc_id FROM trip_lines WHERE trip_id = ? AND COALESCE(is_deleted, 0) = 0 AND shipment_doc_id IS NOT NULL)",
        (date_part, trip_id),
    )


def receive_receipts_for_trip(
    connection, trip_id: str, trip_number: str, uid: str, *,
    accepted_by_line: dict[str, int], zone_by_line: dict[str, dict],
) -> int:
    """При завершении разгрузки inbound-рейса: проводим приёмку привезённого этим рейсом.

    Кладовщик в шаге разгрузки посчитал фактически принятое по строкам аллокации
    рейса (accepted_by_line: receipt_line_id → шт.; по умолчанию — вся аллокация).
    Привезти больше, чем планировалось на рейс, можно (нормальная ситуация): излишек
    поднимает аллокацию рейса до факта, accepted_qty может превысить план поступления →
    документ закрывается в done. На принятое
    пишем движение intake→storage@место (штамп trip_id+receipt_line_id), наращиваем
    receipt_lines.accepted_qty и пересчитываем статус поступления (partially_received
    /done). Счёт ручной — это не авто-приход по плану. Идёт в одной транзакции со
    сменой статуса рейса. Зеркало cascade_shipments_to_shipped.
    """
    from modules.balances.service import insert_inventory_move
    from modules.receipts.service import recompute_trip_receipt_status

    lines = connection.execute(
        "SELECT id, receipt_doc_id FROM trip_lines "
        "WHERE trip_id = ? AND is_deleted = 0 AND receipt_doc_id IS NOT NULL",
        (trip_id,),
    ).fetchall()
    now = _now()
    affected: list[str] = []
    for ln in lines:
        rid = str(ln["receipt_doc_id"])
        rec = connection.execute(
            "SELECT d.status, d.doc_number, d.client_id, cl.name AS client_name "
            "FROM receipt_docs d LEFT JOIN clients cl ON cl.id = d.client_id "
            "WHERE d.id = ? AND d.is_deleted = 0", (rid,),
        ).fetchone()
        if not rec or str(rec["status"]) not in (
            RECEIPT_STATUS_PLANNED, RECEIPT_STATUS_PARTIALLY_RECEIVED
        ):
            continue
        alloc_rows = connection.execute(
            "SELECT ta.id AS alloc_id, ta.qty, ta.receipt_line_id, "
            "rl.product_id, rl.product_name, rl.product_sku, rl.color_id, rl.color_name, "
            "rl.size_id, rl.size_name, rl.storage_zone_id, rl.storage_zone_name, rl.accepted_qty "
            "FROM trip_alloc ta JOIN receipt_lines rl ON rl.id = ta.receipt_line_id "
            "WHERE ta.trip_line_id = ? AND COALESCE(ta.is_deleted, 0) = 0 "
            "AND COALESCE(rl.is_deleted, 0) = 0",
            (str(ln["id"]),),
        ).fetchall()
        for a in alloc_rows:
            lid = str(a["receipt_line_id"])
            alloc_qty = int(a["qty"] or 0)
            received = int(accepted_by_line.get(lid, alloc_qty))
            if received < 0:
                received = 0
            attrs = " / ".join(x for x in [a["color_name"], a["size_name"]] if x)
            label = f"{a['product_sku']}" + (f" ({attrs})" if attrs else "")
            surplus = max(received - alloc_qty, 0)
            zone = zone_by_line.get(lid)
            zone_id = (zone.get("id") if zone else None) or a["storage_zone_id"]
            zone_name = (zone.get("name") if zone else None) or a["storage_zone_name"]
            if received > 0 and not str(zone_id or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail=f"Укажите место хранения ({label})",
                )
            # Зону строки фиксируем (пригодится журналу и следующим рейсам по строке).
            if zone and (zone_id != a["storage_zone_id"] or zone_name != a["storage_zone_name"]):
                connection.execute(
                    "UPDATE receipt_lines SET storage_zone_id = ?, storage_zone_name = ? WHERE id = ?",
                    (zone_id, zone_name, lid),
                )
            if received <= 0:
                continue
            # Привезли больше, чем планировалось на рейс — нормальная ситуация. Поднимаем
            # аллокацию рейса до фактически принятого: тогда «привезено рейсами»
            # (arrived_qty_by_line) и «остаток к распределению» считаются от факта, а не
            # от плана, и гейт корректировки приёмки не конфликтует с излишком.
            if surplus > 0:
                connection.execute(
                    "UPDATE trip_alloc SET qty = ? WHERE id = ?", (received, str(a["alloc_id"])),
                )
            new_accepted = int(a["accepted_qty"] or 0) + received
            connection.execute(
                "UPDATE receipt_lines SET accepted_qty = ? WHERE id = ?", (new_accepted, lid),
            )
            surplus_note = f", из них сверх плана рейса +{surplus}" if surplus > 0 else ""
            connection.execute(
                "INSERT INTO receipt_ops (id,doc_id,line_id,op_type,qty,comment,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
                (str(uuid4()), rid, lid, RECEIPT_OP_ARRIVAL_ACCEPT, received,
                 f"Принято рейсом {trip_number}: +{received} шт.{surplus_note} (итого {new_accepted}) ({label})", now, uid),
            )
            insert_inventory_move(
                connection,
                product_id=str(a["product_id"]), product_name=a["product_name"], product_sku=a["product_sku"],
                color_id=a["color_id"], color_name=a["color_name"],
                size_id=a["size_id"], size_name=a["size_name"],
                client_id=rec["client_id"], client_name=rec["client_name"],
                from_op=INV_OP_INTAKE, to_op=INV_OP_STORAGE,
                from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
                from_zone_id=zone_id, from_zone_name=zone_name,
                to_zone_id=zone_id, to_zone_name=zone_name,
                qty=received, user_id=uid, receipt_line_id=lid, trip_id=trip_id,
                comment=f"Приёмка по рейсу {trip_number}: {received} шт.",
            )
        if rid not in affected:
            affected.append(rid)
    for rid in affected:
        recompute_trip_receipt_status(connection, rid, uid, note=f"разгрузка рейса {trip_number}")
    return len(affected)


def reverse_receipt_intake_for_trip(connection, trip_id: str, uid: str) -> None:
    """Сторно приёмки при отмене inbound-рейса: возврат storage → intake.

    На каждое движение приёмки этого рейса (intake→storage) пишем обратное
    (storage→intake, привязка reverses_id), уменьшаем receipt_lines.accepted_qty и
    пересчитываем статус поступления. Рейс, отменённый до разгрузки, приёмку не
    проводил — движений нет, поступление так и осталось «В плане». Зеркало
    reverse_shipment_consume_for_trip. Без commit.
    """
    from modules.balances.service import insert_inventory_move
    from modules.receipts.service import recompute_trip_receipt_status

    moves = connection.execute(
        "SELECT * FROM zone_relocations "
        "WHERE trip_id = ? AND from_op = ? AND to_op = ? AND reverses_id IS NULL",
        (trip_id, INV_OP_INTAKE, INV_OP_STORAGE),
    ).fetchall()
    reduced_by_line: dict[str, int] = {}
    for mv in moves:
        already = connection.execute(
            "SELECT 1 FROM zone_relocations WHERE reverses_id = ? LIMIT 1", (str(mv["id"]),)
        ).fetchone()
        if already:
            continue
        insert_inventory_move(
            connection,
            product_id=str(mv["product_id"]), product_name=mv["product_name"], product_sku=mv["product_sku"],
            color_id=mv["color_id"], color_name=mv["color_name"],
            size_id=mv["size_id"], size_name=mv["size_name"],
            client_id=mv["client_id"], client_name=mv["client_name"],
            from_op=INV_OP_STORAGE, to_op=INV_OP_INTAKE,
            from_quality=str(mv["to_quality"]), to_quality=str(mv["from_quality"]),
            from_zone_id=mv["to_zone_id"], from_zone_name=mv["to_zone_name"],
            to_zone_id=None, to_zone_name=None,
            qty=int(mv["qty"]), user_id=uid,
            receipt_line_id=mv["receipt_line_id"], trip_id=trip_id,
            reverses_id=str(mv["id"]),
            comment=f"Возврат приёмки при отмене рейса: {int(mv['qty'])} шт.",
        )
        lid = mv["receipt_line_id"]
        if lid:
            reduced_by_line[str(lid)] = reduced_by_line.get(str(lid), 0) + int(mv["qty"])

    affected: set[str] = set()
    for lid, qty in reduced_by_line.items():
        connection.execute(
            "UPDATE receipt_lines SET accepted_qty = GREATEST(COALESCE(accepted_qty, 0) - ?, 0) WHERE id = ?",
            (qty, lid),
        )
        doc = connection.execute("SELECT doc_id FROM receipt_lines WHERE id = ?", (lid,)).fetchone()
        if doc:
            affected.add(str(doc["doc_id"]))
    for rid in affected:
        recompute_trip_receipt_status(connection, rid, uid, note="отмена рейса")


def assert_shipments_ready_for_load(connection, trip_id: str) -> None:
    """Гейт перед завершением погрузки outbound-рейса.

    Кладовщик завершает погрузку только когда все привязанные отгрузки готовы к
    рейсу (статус «Ожидает рейс»). Аннулированные пропускаем — они не поедут.
    """
    rows = connection.execute(
        "SELECT s.doc_number, s.status FROM trip_lines l "
        "JOIN shipment_docs s ON s.id = l.shipment_doc_id AND COALESCE(s.is_deleted, 0) = 0 "
        "WHERE l.trip_id = ? AND l.is_deleted = 0 AND l.shipment_doc_id IS NOT NULL "
        "ORDER BY s.doc_number",
        (trip_id,),
    ).fetchall()
    blocking = [
        str(r["doc_number"])
        for r in rows
        if str(r["status"]) not in (
            SHIPMENT_STATUS_AWAITING_TRIP,
            SHIPMENT_STATUS_PARTIALLY_SHIPPED,
            SHIPMENT_STATUS_CANCELLED,
        )
    ]
    if blocking:
        raise HTTPException(
            status_code=400,
            detail="Нельзя завершить погрузку: отгрузки ещё не готовы к рейсу — " + ", ".join(blocking),
        )


def cascade_shipments_to_shipped(connection, trip_id: str, trip_number: str, uid: str) -> int:
    """При завершении погрузки outbound-рейса: списываем аллокацию рейса по каждой
    привязанной отгрузке.

    Отгрузка, увёзшая весь план, → shipped «Завершён»; иначе → partially_shipped
    «Частично отгружено» (остаток поедет следующими рейсами). Списание —
    журнальными движениями (… → shipped) на распределённое в этот рейс количество
    (trip_alloc). Идёт в одной транзакции со сменой статуса рейса.
    """
    from modules.shipments.service import (
        _check_duplicate_lines,
        consume_stock_for_shipment,
        shipment_fully_shipped,
    )

    lines = connection.execute(
        "SELECT id, shipment_doc_id FROM trip_lines "
        "WHERE trip_id = ? AND is_deleted = 0 AND shipment_doc_id IS NOT NULL",
        (trip_id,),
    ).fetchall()
    now = _now()
    moved = 0
    for ln in lines:
        sid = str(ln["shipment_doc_id"])
        ship = connection.execute(
            "SELECT status, priority_rank, cargo_type FROM shipment_docs WHERE id = ? AND is_deleted = 0", (sid,)
        ).fetchone()
        if not ship or str(ship["status"]) not in (
            SHIPMENT_STATUS_AWAITING_TRIP, SHIPMENT_STATUS_PARTIALLY_SHIPPED
        ):
            continue
        _check_duplicate_lines(connection, sid)

        alloc_rows = connection.execute(
            "SELECT shipment_line_id, qty FROM trip_alloc "
            "WHERE trip_line_id = ? AND COALESCE(is_deleted, 0) = 0 AND shipment_line_id IS NOT NULL",
            (str(ln["id"]),),
        ).fetchall()
        alloc = {str(r["shipment_line_id"]): int(r["qty"]) for r in alloc_rows}

        consume_stock_for_shipment(connection, sid, uid, alloc=alloc, trip_id=trip_id)

        done = shipment_fully_shipped(connection, sid)
        new_status = SHIPMENT_STATUS_SHIPPED if done else SHIPMENT_STATUS_PARTIALLY_SHIPPED
        prev_ru = SHIPMENT_STATUS_LABELS.get(str(ship["status"]), str(ship["status"]))
        new_ru = SHIPMENT_STATUS_LABELS[new_status]
        if done:
            connection.execute(
                "UPDATE shipment_docs SET status = ?, priority_rank = NULL, updated_at = ? WHERE id = ?",
                (new_status, now, sid),
            )
            if ship.get("priority_rank") is not None:
                connection.execute(
                    "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                    (str(uuid4()), sid, SHIPMENT_OP_PRIORITY_UPDATE,
                     "Приоритет снят: отгрузка завершена", now, uid),
                )
        else:
            connection.execute(
                "UPDATE shipment_docs SET status = ?, updated_at = ? WHERE id = ?",
                (new_status, now, sid),
            )
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), sid, "advance",
             f"{prev_ru} → {new_ru} (погрузка рейса {trip_number})", now, uid),
        )
        shipped_now = sum(alloc.values())
        if shipped_now > 0:
            verb = "Возвращено" if str(ship["cargo_type"] or SHIPMENT_CARGO_GOOD) == SHIPMENT_CARGO_DEFECT else "Отгружено"
            connection.execute(
                "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                (str(uuid4()), sid, SHIPMENT_OP_SHIP, f"{verb}: {shipped_now} шт.", now, uid),
            )
        moved += 1
    return moved


def reverse_shipment_consume_for_trip(connection, trip_id: str, uid: str) -> None:
    """Сторно частичного списания при отмене outbound-рейса: возврат shipped → ready.

    На каждое движение списания этого рейса пишем обратное (то же место и
    количество, привязка reverses_id), уменьшаем shipped_qty и откатываем статус
    отгрузки: → partially_shipped, если по другим рейсам что-то уже уехало, иначе
    awaiting_trip. Без commit — коммитит вызывающий.
    """
    from modules.balances.service import insert_inventory_move

    moves = connection.execute(
        "SELECT * FROM zone_relocations WHERE trip_id = ? AND to_op = ? AND reverses_id IS NULL",
        (trip_id, INV_OP_SHIPPED),
    ).fetchall()
    if not moves:
        return
    now = _now()
    returned_by_line: dict[str, int] = {}
    for mv in moves:
        already = connection.execute(
            "SELECT 1 FROM zone_relocations WHERE reverses_id = ? LIMIT 1", (str(mv["id"]),)
        ).fetchone()
        if already:
            continue
        insert_inventory_move(
            connection,
            product_id=str(mv["product_id"]), product_name=mv["product_name"], product_sku=mv["product_sku"],
            color_id=mv["color_id"], color_name=mv["color_name"],
            size_id=mv["size_id"], size_name=mv["size_name"],
            client_id=mv["client_id"], client_name=mv["client_name"],
            from_op=INV_OP_SHIPPED, to_op=INV_OP_READY,
            from_quality=str(mv["to_quality"]), to_quality=str(mv["from_quality"]),
            from_zone_id=None, from_zone_name=None,
            to_zone_id=mv["from_zone_id"], to_zone_name=mv["from_zone_name"],
            qty=int(mv["qty"]), user_id=uid,
            shipment_line_id=mv["shipment_line_id"], trip_id=trip_id,
            reverses_id=str(mv["id"]),
            comment=f"Возврат при отмене рейса: {int(mv['qty'])} шт.",
        )
        lid = mv["shipment_line_id"]
        if lid:
            returned_by_line[str(lid)] = returned_by_line.get(str(lid), 0) + int(mv["qty"])

    affected_docs: set[str] = set()
    for lid, qty in returned_by_line.items():
        connection.execute(
            "UPDATE shipment_lines SET shipped_qty = GREATEST(COALESCE(shipped_qty, 0) - ?, 0) WHERE id = ?",
            (qty, lid),
        )
        doc = connection.execute("SELECT doc_id FROM shipment_lines WHERE id = ?", (lid,)).fetchone()
        if doc:
            affected_docs.add(str(doc["doc_id"]))

    for sid in affected_docs:
        cur = connection.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (sid,)
        ).fetchone()
        if not cur or str(cur["status"]) not in (
            SHIPMENT_STATUS_SHIPPED, SHIPMENT_STATUS_PARTIALLY_SHIPPED
        ):
            continue
        any_shipped = connection.execute(
            "SELECT COALESCE(SUM(shipped_qty), 0) AS s FROM shipment_lines "
            "WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (sid,),
        ).fetchone()
        new_status = (
            SHIPMENT_STATUS_PARTIALLY_SHIPPED if int(any_shipped["s"]) > 0 else SHIPMENT_STATUS_AWAITING_TRIP
        )
        prev_ru = SHIPMENT_STATUS_LABELS.get(str(cur["status"]), str(cur["status"]))
        new_ru = SHIPMENT_STATUS_LABELS[new_status]
        connection.execute(
            "UPDATE shipment_docs SET status = ?, updated_at = ? WHERE id = ?",
            (new_status, now, sid),
        )
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), sid, "advance",
             f"{prev_ru} → {new_ru} (отмена рейса)", now, uid),
        )
