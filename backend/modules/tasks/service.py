from __future__ import annotations

from config import (
    RECEIPT_STATUS_ON_INTAKE,
    TRIP_DIRECTION_OUTBOUND,
    TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_COSTING,
    TRIP_STATUS_UNLOADING,
)

ROLE_WAREHOUSE = "warehouse_manager"
ROLE_MANAGER = "manager"

_TRIP_TASKS = {
    TRIP_STATUS_AWAITING_ARRIVAL: (ROLE_WAREHOUSE, "trip_arrival", "Встретить рейс {num}"),
    TRIP_STATUS_UNLOADING:        (ROLE_WAREHOUSE, "trip_unload", "Завершить {phase} рейса {num}"),
    TRIP_STATUS_COSTING:          (ROLE_MANAGER, "trip_cost", "Уточнить стоимость рейса {num}"),
}

_RECEIPT_TASKS = {
    RECEIPT_STATUS_ON_INTAKE: (ROLE_WAREHOUSE, "receipt_intake", "Принять товары — {num}"),
}


def _receipt_task_statuses(visible_roles: set[str]) -> tuple[str, ...]:
    statuses: list[str] = []
    if ROLE_WAREHOUSE in visible_roles:
        statuses.append(RECEIPT_STATUS_ON_INTAKE)
    return tuple(statuses)


def list_my_tasks(connection, *, user) -> list[dict]:
    """Очередь задач текущего пользователя — агрегат по статусам рейсов и поступлений.

    Read-only: источник правды — статус документа, без отдельного хранилища.
    """
    role = str(user["role"])
    see_warehouse = role in (ROLE_WAREHOUSE, "admin")
    see_manager = role in (ROLE_MANAGER, "admin")
    visible_roles = set()
    if see_warehouse:
        visible_roles.add(ROLE_WAREHOUSE)
    if see_manager:
        visible_roles.add(ROLE_MANAGER)
    if not visible_roles:
        return []

    tasks: list[dict] = []

    trip_rows = connection.execute(
        "SELECT id, trip_number, status, direction, updated_at, created_at FROM trip_docs "
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
            "since": r["updated_at"] or r["created_at"],
        })

    receipt_statuses = _receipt_task_statuses(visible_roles)
    if receipt_statuses:
        placeholders = ",".join("?" for _ in receipt_statuses)
        receipt_rows = connection.execute(
            "SELECT id, doc_number, status, updated_at, created_at FROM receipt_docs "
            f"WHERE is_deleted = 0 AND status IN ({placeholders})",
            receipt_statuses,
        ).fetchall()
        for r in receipt_rows:
            task_role, kind, title_tpl = _RECEIPT_TASKS[str(r["status"])]
            if task_role not in visible_roles:
                continue
            tasks.append({
                "kind": kind,
                "title": title_tpl.format(num=r["doc_number"]),
                "doc_type": "receipt",
                "doc_id": str(r["id"]),
                "doc_number": str(r["doc_number"]),
                "status": str(r["status"]),
                "role": task_role,
                "since": r["updated_at"] or r["created_at"],
            })

    tasks.sort(key=lambda t: (t["since"] or ""))
    return tasks
