import type { User } from '../api/typesUser'

export function canViewCosts(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canEditPlannedArrival(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

// Страница «Пользователи»: просмотр списка + не-деструктивное ведение учёток
// (роль, привязка клиента, отображаемое имя) — админ и менеджер. Менеджер не может
// выдавать/править роль admin и manager, а удаление доступно только админу (в UI
// удаления нет; на backend это гейтит _get_users_admin).
export function canManageUsers(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

// Справочник «Наши склады» (ставки аренды) — только админ.
export function canManageOwnWarehouses(user: User | null | undefined): boolean {
  return user?.role === 'admin'
}

// Расходы-«фиксы» (аренда склада, ЗП) и сводный реестр всех типов — только админ.
// Менеджер видит и заводит только хозрасходы и логистику.
export function canManageAdminFinance(user: User | null | undefined): boolean {
  return user?.role === 'admin'
}

export function canEditShipmentFiles(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canEditShipmentPriority(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canEditShipmentPlanning(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canEditShipments(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager' || user?.role === 'warehouse_head'
}

// Отметка «Отгрузка подготовлена» (preparing → awaiting_trip) — задача кладовщика,
// плюс менеджерский состав может закрыть её сам.
export function canPrepareDispatch(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager' || user?.role === 'warehouse_head'
}

// Карточку-задачу «Соберите по ячейкам» в статусе подготовки видит кладовщик —
// плюс менеджерский состав, чтобы при необходимости подготовить отгрузку (выбрать
// ячейки и отметить «Отгрузка подготовлена») за кладовщика прямо из карточки.
export function isDispatchPreparer(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
    || user?.role === 'warehouse_manager' || user?.role === 'warehouse_head'
}

// Запас тары: заведение и удаление свободных коробов (панель «Короба» в справочниках).
// Тот же состав, что у backend-гейта manager_staff, — начальник смены короба только
// печатает и развозит, но пачку этикеток не заводит.
export function canManageBoxSupply(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
    || user?.role === 'warehouse_manager' || user?.role === 'warehouse_head'
}

export function canCreateDocuments(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

// Пост-фактум корректировка обсчёта приёмки (правит остатки) — менеджер и начальник склада.
export function canCorrectReceived(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_head'
}

// Историческая коррекция бизнес-даты упаковки из «Производительности упаковки» — менеджер и админ.
export function canMovePackDate(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canPackShipments(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'shift_supervisor' || user?.role === 'warehouse_head'
}

// Табель: план/факт ведёт начальник смены (+ начальник склада) и менеджерский состав.
export function canManageTimesheet(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'shift_supervisor' || user?.role === 'warehouse_head'
}

// Деньги табеля (ставки, заработок, выплаты) — только менеджер и админ.
export function canViewPayroll(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

// Оклад окладников (оклад в месяц) и любые деньги по ним — только админ.
// Менеджер ведёт деньги почасовиков, но окладов не видит и не заводит.
export function canViewSalary(user: User | null | undefined): boolean {
  return user?.role === 'admin'
}
