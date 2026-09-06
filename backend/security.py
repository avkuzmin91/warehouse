"""Единые проверки ролей для HTTP-зависимостей (RBAC)."""

from __future__ import annotations

from typing import Any, Mapping

from fastapi import HTTPException, status

from config import MP_SUPPLY_PICK_ROLES

# Сообщение для 403: одна строка — проще сопоставлять в тестах и логах.
FORBIDDEN_DETAIL = "Недостаточно прав"

# Роли склада (осторожно с именами): "warehouse_manager" — это Кладовщик,
# "shift_supervisor" — Начальник смены, а "warehouse_head" — Начальник склада,
# который объединяет права обоих. Поэтому warehouse_head добавлен в каждую проверку,
# где встречается warehouse_manager ИЛИ shift_supervisor, и НЕ добавлен туда, где
# доступ только у admin/manager (создание документов, стоимости, финансы, приоритет).


def user_client_id_opt(user: Mapping[str, Any]) -> str | None:
    """Значение users.client_id из результата SELECT (доступ по ключу, без .get)."""
    try:
        raw = user["client_id"]
    except (KeyError, IndexError):
        return None
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def ensure_backoffice_account(user: Mapping[str, Any]) -> None:
    """Админ-разделы бэк-офиса (справочники, товары): admin, manager, warehouse_manager, warehouse_head.

    Это НЕ проверка «только admin» — для строго админских операций
    (управление пользователями) используется отдельная проверка role == "admin".
    """
    if user["role"] not in ("admin", "manager", "warehouse_manager", "warehouse_head"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_manager_staff(user: Mapping[str, Any]) -> None:
    if user["role"] not in ("manager", "admin", "warehouse_manager", "warehouse_head"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_shipment_view_access(user: Mapping[str, Any]) -> None:
    if user["role"] not in ("manager", "admin", "warehouse_manager", "shift_supervisor", "warehouse_head"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_dashboard_access(user: Mapping[str, Any]) -> None:
    ensure_shipment_view_access(user)


def ensure_task_view_access(user: Mapping[str, Any]) -> None:
    """Очередь «Мои задачи»: те же роли, что видят документы, плюс сборщик.

    Сборщику доступна только его очередь — карточки документов и сводка склада
    остаются закрытыми, поэтому проверка отдельная, а не расширение dashboard.
    """
    if user["role"] in MP_SUPPLY_PICK_ROLES:
        return
    ensure_shipment_view_access(user)


def ensure_stock_write_access(user: Mapping[str, Any]) -> None:
    """Ручные операции с остатками (перемещение, перевод в брак, списание): весь складской
    и менеджерский состав, включая начальника смены."""
    if user["role"] not in ("manager", "admin", "warehouse_manager", "shift_supervisor", "warehouse_head"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_packing_access(user: Mapping[str, Any]) -> None:
    """Внесение результата упаковки: менеджерский состав, начальник смены и начальник склада."""
    if user["role"] not in ("manager", "admin", "shift_supervisor", "warehouse_head"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_warehouse_staff(user: Mapping[str, Any]) -> None:
    """Складские действия (приёмка, разгрузка рейса): кладовщик, начальник склада и менеджерский состав."""
    if user["role"] not in ("warehouse_manager", "manager", "admin", "warehouse_head"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_create_documents(user: Mapping[str, Any]) -> bool:
    """Создание документов (рейсы, поступления, отгрузки) — менеджерский состав, не кладовщик."""
    return user["role"] in ("admin", "manager")


def ensure_document_create_access(user: Mapping[str, Any]) -> None:
    if not can_create_documents(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_correct_received(user: Mapping[str, Any]) -> bool:
    """Пост-фактум корректировка обсчёта приёмки (правит остатки) — менеджер и
    начальник склада. Рядовой кладовщик и начальник смены такую правку не делают."""
    return user["role"] in ("admin", "manager", "warehouse_head")


def ensure_received_correction_access(user: Mapping[str, Any]) -> None:
    if not can_correct_received(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_view_costs(user: Mapping[str, Any]) -> bool:
    return user["role"] in ("admin", "manager")


def can_manage_finance(user: Mapping[str, Any]) -> bool:
    """Счета (финансы) ведут только менеджер и админ — как и просмотр стоимостей."""
    return user["role"] in ("admin", "manager")


def ensure_finance_access(user: Mapping[str, Any]) -> None:
    if not can_manage_finance(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def is_admin(user: Mapping[str, Any]) -> bool:
    """Только администратор. Для операций, где админ обходит гейт менеджера
    (например, правка палет по уже отгруженной отгрузке с выставленным счётом)."""
    return user["role"] == "admin"


def can_manage_admin_finance(user: Mapping[str, Any]) -> bool:
    """Расходы-«фиксы» (аренда склада, ЗП) и сводный реестр «Транзакции» —
    только админ. Менеджер их не видит и не заводит."""
    return user["role"] == "admin"


def ensure_admin_finance(user: Mapping[str, Any]) -> None:
    if not can_manage_admin_finance(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_marketplace_access(user: Mapping[str, Any]) -> None:
    """FBS-маркетплейсы — заказы, связка товаров и подключения кабинетов (включая
    API-ключи продавцов) — менеджерский состав (admin, manager), не кладовщик."""
    if user["role"] not in ("admin", "manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_scan_lookup_access(user: Mapping[str, Any]) -> None:
    """Разбор отсканированного QR (место хранения, короб) — read-only.

    Сборщик сканирует место и короб на каждой позиции листа подбора, поэтому
    lookup ему открыт, хотя операции с остатками и содержимым короба — нет.
    """
    if user["role"] in MP_SUPPLY_PICK_ROLES:
        return
    ensure_stock_write_access(user)


def ensure_supply_work_access(user: Mapping[str, Any]) -> None:
    """Станция упаковки и грузовые места FBS-поставки: те же руки, что и сборка,
    плюс менеджер — он ведёт поставку и может допаковать заказ у ПК с принтером."""
    if user["role"] in MP_SUPPLY_PICK_ROLES or user["role"] == "manager":
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=FORBIDDEN_DETAIL,
    )


def ensure_supply_pick_access(user: Mapping[str, Any]) -> None:
    """Сборка FBS-поставки на ТСД: сборщик, кладовщик и начальник склада.

    Роль «picker» — специализация, а не эксклюзив: на малом складе выделенного
    сборщика нет, и очередь не должна вставать без него.
    """
    if user["role"] not in MP_SUPPLY_PICK_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_edit_shipment_priority(user: Mapping[str, Any]) -> bool:
    return user["role"] in ("admin", "manager")


def can_edit_shipment_planning(user: Mapping[str, Any]) -> bool:
    return user["role"] in ("admin", "manager")


def ensure_shipment_priority_access(user: Mapping[str, Any]) -> None:
    if not can_edit_shipment_priority(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_shipment_planning_access(user: Mapping[str, Any]) -> None:
    if not can_edit_shipment_planning(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_cost_access(user: Mapping[str, Any]) -> None:
    if not can_view_costs(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_edit_planned_arrival(user: Mapping[str, Any]) -> bool:
    """Плановую дату прибытия правит менеджерский состав, но не кладовщик."""
    return user["role"] in ("admin", "manager")


def ensure_planned_arrival_access(user: Mapping[str, Any]) -> None:
    if not can_edit_planned_arrival(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def ensure_timesheet_access(user: Mapping[str, Any]) -> None:
    """Табель (план/факт) и справочник сотрудников: начальник смены ведёт табель,
    плюс менеджерский состав. warehouse_head включает права начальника смены."""
    if user["role"] not in ("manager", "admin", "shift_supervisor", "warehouse_head"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_view_payroll(user: Mapping[str, Any]) -> bool:
    """Деньги табеля (ставки, заработок, выплаты) — только менеджер и админ,
    как и прочие стоимости (`can_view_costs`). Начальник смены сумм не видит."""
    return user["role"] in ("admin", "manager")


def ensure_payroll_access(user: Mapping[str, Any]) -> None:
    if not can_view_payroll(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=FORBIDDEN_DETAIL,
        )


def can_view_salary(user: Mapping[str, Any]) -> bool:
    """Оклад окладников (fixed) и любые деньги по ним — только администратор.
    Менеджер ведёт деньги почасовиков, но окладов в месяц не видит."""
    return user["role"] == "admin"


def ensure_salary_access(user: Mapping[str, Any]) -> None:
    if not can_view_salary(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Оклады доступны только администратору",
        )
