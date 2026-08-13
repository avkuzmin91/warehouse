from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from config import (
    DISPATCH_STATUS_PARTIALLY_SHIPPED,
    DISPATCH_STATUS_PREPARING,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_STATUS_ASSIGNED,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_RELOCATING,
    TRIP_DIRECTION_OUTBOUND,
    TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_COSTING,
    TRIP_STATUS_UNLOADING,
)
from modules.dispatch.service import list_stuck_partial_dispatches
from modules.receipts.service import list_shortage_receipts

ROLE_WAREHOUSE = "warehouse_manager"
ROLE_MANAGER = "manager"
ROLE_SHIFT = "shift_supervisor"
# Начальник склада видит очереди и кладовщика, и начальника смены.
ROLE_WAREHOUSE_HEAD = "warehouse_head"

_TRIP_TASKS = {
    TRIP_STATUS_AWAITING_ARRIVAL: (ROLE_WAREHOUSE, "trip_arrival", "Встретить рейс {num}"),
    TRIP_STATUS_UNLOADING:        (ROLE_WAREHOUSE, "trip_unload", "Завершить {phase} рейса {num}"),
    TRIP_STATUS_COSTING:          (ROLE_MANAGER, "trip_cost", "Уточнить стоимость рейса {num}"),
}

# Поступления больше не порождают задачу приёмки в карточке: приёмка идёт в рейсе
# (задача «Завершить разгрузку рейса»). Карточная приёмка (on_intake) убрана.


def _prev_working_day(d: date) -> date:
    """Предыдущий рабочий день (воскресенье — нерабочее, захардкожено)."""
    result = d - timedelta(days=1)
    while result.weekday() == 6:  # 6 = воскресенье
        result -= timedelta(days=1)
    return result


def list_my_tasks(connection, *, user) -> list[dict]:
    """Очередь задач текущего пользователя — агрегат по статусам рейсов и поступлений.

    Read-only: источник правды — статус документа, без отдельного хранилища.
    """
    role = str(user["role"])
    see_warehouse = role in (ROLE_WAREHOUSE, ROLE_WAREHOUSE_HEAD, "admin")
    see_manager = role in (ROLE_MANAGER, "admin")
    see_shift = role in (ROLE_SHIFT, ROLE_WAREHOUSE_HEAD, "admin")
    # Приёмку задачи упаковки в работу делает начальник склада (менеджерский состав —
    # как подстраховка через деталку); в очередь-карточек кладём её начальнику склада.
    see_head = role in (ROLE_WAREHOUSE_HEAD, "admin")
    visible_roles = set()
    if see_warehouse:
        visible_roles.add(ROLE_WAREHOUSE)
    if see_manager:
        visible_roles.add(ROLE_MANAGER)
    if see_shift:
        visible_roles.add(ROLE_SHIFT)
    if see_head:
        visible_roles.add(ROLE_WAREHOUSE_HEAD)
    if not visible_roles:
        return []

    tasks: list[dict] = []

    trip_rows = connection.execute(
        "SELECT id, trip_number, status, direction, eta, vehicle_number, updated_at, created_at FROM trip_docs "
        "WHERE is_deleted = 0 AND status IN (?,?,?)",
        (TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_UNLOADING, TRIP_STATUS_COSTING),
    ).fetchall()
    for r in trip_rows:
        task_role, kind, title_tpl = _TRIP_TASKS[str(r["status"])]
        if task_role not in visible_roles:
            continue
        direction = str(r["direction"] or "")
        phase = "погрузку" if direction == TRIP_DIRECTION_OUTBOUND else "разгрузку"
        tasks.append({
            "kind": kind,
            "title": title_tpl.format(num=r["trip_number"], phase=phase),
            "doc_type": "trip",
            "doc_id": str(r["id"]),
            "doc_number": str(r["trip_number"]),
            "status": str(r["status"]),
            "role": task_role,
            "direction": direction or None,
            "eta": r["eta"],
            "vehicle_number": r["vehicle_number"],
            "since": r["updated_at"] or r["created_at"],
        })

    if ROLE_SHIFT in visible_roles or ROLE_WAREHOUSE in visible_roles:
        # Задача отгрузки — прямая функция статуса:
        #   «В плане» (+за 1 рабочий день до отгрузки) → кладовщик передаёт на упаковку;
        #   «На упаковке»              → начальник смены разбивает годный/брак;
        #   «Перемещение»              → кладовщик раскладывает по местам к рейсу;
        #   «Перемещение» (брак, +срок наступил) → кладовщик готовит брак к отгрузке.
        today_date = date.today()
        today = today_date.isoformat()
        shipment_rows = connection.execute(
            "SELECT id, doc_number, status, cargo_type, ship_date, priority_rank, updated_at, created_at FROM shipment_docs "
            "WHERE COALESCE(is_deleted, 0) = 0 AND status IN (?,?,?)",
            (SHIPMENT_STATUS_PACKING, SHIPMENT_STATUS_ON_PACKING, SHIPMENT_STATUS_RELOCATING),
        ).fetchall()
        for r in shipment_rows:
            status = str(r["status"])
            is_defect_cargo = str(r["cargo_type"] or "") == SHIPMENT_CARGO_DEFECT
            if status == SHIPMENT_STATUS_PACKING:
                ship_date = r["ship_date"]
                if not ship_date or _prev_working_day(date.fromisoformat(str(ship_date)[:10])) > today_date:
                    continue  # задача появляется за 1 рабочий день до отгрузки (вс — нерабочее)
                task_role, kind, title = ROLE_WAREHOUSE, "shipment_move_in", f"Передать на упаковку {r['doc_number']}"
            elif status == SHIPMENT_STATUS_ON_PACKING:
                task_role, kind, title = ROLE_SHIFT, "shipment_pack", f"Упаковать {r['doc_number']}"
            elif is_defect_cargo:  # SHIPMENT_STATUS_RELOCATING, брак-отгрузка
                ship_date = r["ship_date"]
                if ship_date and str(ship_date) > today:
                    continue  # срок подготовки ещё не наступил
                task_role, kind, title = ROLE_WAREHOUSE, "shipment_defect_prepare", f"Подготовить к отгрузке {r['doc_number']}"
            else:  # SHIPMENT_STATUS_RELOCATING
                task_role, kind, title = ROLE_WAREHOUSE, "shipment_relocate", f"Разложить по местам {r['doc_number']}"
            if task_role not in visible_roles:
                continue
            tasks.append({
                "kind": kind, "title": title,
                "doc_type": "shipment", "doc_id": str(r["id"]),
                "doc_number": str(r["doc_number"]), "status": status,
                "role": task_role, "since": r["updated_at"] or r["created_at"],
                "priority_rank": int(r["priority_rank"]) if r.get("priority_rank") is not None else None,
            })

    if ROLE_WAREHOUSE_HEAD in visible_roles:
        # «Ожидает принятия» — менеджер поставил задачу упаковки, начальник склада
        # принимает её в работу (или отклоняет). Брак-отгрузка этот шаг минует.
        assigned_rows = connection.execute(
            "SELECT id, doc_number, status, priority_rank, updated_at, created_at FROM shipment_docs "
            "WHERE COALESCE(is_deleted, 0) = 0 AND status = ?",
            (SHIPMENT_STATUS_ASSIGNED,),
        ).fetchall()
        for r in assigned_rows:
            tasks.append({
                "kind": "shipment_accept",
                "title": f"Принять в работу {r['doc_number']}",
                "doc_type": "shipment", "doc_id": str(r["id"]),
                "doc_number": str(r["doc_number"]), "status": SHIPMENT_STATUS_ASSIGNED,
                "role": ROLE_WAREHOUSE_HEAD, "since": r["updated_at"] or r["created_at"],
                "priority_rank": int(r["priority_rank"]) if r.get("priority_rank") is not None else None,
            })

    if ROLE_WAREHOUSE in visible_roles:
        # «Отгрузка» (dispatch) в статусе «Подготовка отгрузки» — задача кладовщику
        # собрать и подготовить отгрузку. После отметки «Отгрузка подготовлена»
        # (preparing → awaiting_trip) задача снимается; снимается и сама собой, если
        # рейс увёз отгрузку прямо из подготовки.
        dispatch_rows = connection.execute(
            "SELECT id, doc_number, status, priority_rank, updated_at, created_at FROM dispatch_docs "
            "WHERE COALESCE(is_deleted, 0) = 0 AND status = ?",
            (DISPATCH_STATUS_PREPARING,),
        ).fetchall()
        for r in dispatch_rows:
            tasks.append({
                "kind": "dispatch_prepare",
                "title": f"Подготовить отгрузку {r['doc_number']}",
                "doc_type": "dispatch",
                "doc_id": str(r["id"]),
                "doc_number": str(r["doc_number"]),
                "status": str(r["status"]),
                "role": ROLE_WAREHOUSE,
                "since": r["updated_at"] or r["created_at"],
                "priority_rank": int(r["priority_rank"]) if r.get("priority_rank") is not None else None,
            })

    if see_manager:
        # Поступление приняли рейсами с недопоставкой (рейсы кончились, план не закрыт) —
        # менеджер решает: закрыть с недопоставкой или довезти следующим рейсом.
        for r in list_shortage_receipts(connection):
            tasks.append({
                "kind": "receipt_close_short",
                "title": f"Закрыть {r['doc_number']} с недопоставкой",
                "doc_type": "receipt",
                "doc_id": r["id"],
                "doc_number": r["doc_number"],
                "status": RECEIPT_STATUS_PARTIALLY_RECEIVED,
                "role": ROLE_MANAGER,
                "since": r["since"],
            })

        # Отгрузка увезена не полностью и давно без рейса — менеджер решает: заказать
        # рейс на остаток или закрыть с недовозом.
        for r in list_stuck_partial_dispatches(connection):
            tasks.append({
                "kind": "dispatch_close_short",
                "title": f"Закрыть {r['doc_number']} с недовозом",
                "doc_type": "dispatch",
                "doc_id": r["id"],
                "doc_number": r["doc_number"],
                "status": DISPATCH_STATUS_PARTIALLY_SHIPPED,
                "role": ROLE_MANAGER,
                "since": r["since"],
            })

    # Новые задачи — вверх (как в почте): внутри приоритета сортируем по `since`
    # убыванием. Стабильная сортировка позволяет задать поля с разным направлением
    # двумя проходами.
    tasks.sort(key=lambda t: t["since"] or "", reverse=True)
    tasks.sort(key=lambda t: (
        t.get("priority_rank") is None,
        t.get("priority_rank") or 0,
    ))
    return tasks


def task_key(task: dict) -> str:
    """Стабильный ключ вычисляемой задачи — тот же формат, что в push_notified_tasks."""
    return f"{task['kind']}:{task['doc_id']}"


def annotate_task_reads(connection, tasks: list[dict], *, user_id: str) -> None:
    """Проставляет is_read по отметкам task_reads текущего пользователя."""
    read_keys = {
        str(r["task_key"])
        for r in connection.execute(
            "SELECT task_key FROM task_reads WHERE user_id = ?", (user_id,)
        ).fetchall()
    }
    for t in tasks:
        t["is_read"] = task_key(t) in read_keys


def mark_task_read(connection, *, user_id: str, kind: str, doc_id: str) -> None:
    connection.execute(
        "INSERT INTO task_reads (user_id, task_key, read_at) VALUES (?,?,?) "
        "ON CONFLICT (user_id, task_key) DO NOTHING",
        (user_id, f"{kind}:{doc_id}", datetime.now(UTC).isoformat()),
    )


def mark_all_tasks_read(connection, *, user) -> None:
    """Отмечает прочитанными все задачи, видимые пользователю сейчас."""
    now = datetime.now(UTC).isoformat()
    uid = str(user["id"])
    for t in list_my_tasks(connection, user=user):
        connection.execute(
            "INSERT INTO task_reads (user_id, task_key, read_at) VALUES (?,?,?) "
            "ON CONFLICT (user_id, task_key) DO NOTHING",
            (uid, task_key(t), now),
        )
