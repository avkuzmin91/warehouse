// Право создавать документы (поступления/задачи упаковки/отгрузки) — только
// менеджерский состав (ср. web canCreateDocuments). Складские роли, включая
// начальника склада, работают с документами в режиме просмотра + операций.
export function canCreateDocuments(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager'
}

// Принять/отклонить задачу упаковки на шаге «Ожидает принятия» — начальник склада
// и менеджерский состав (ср. web canAcceptPackingTask, backend SHIPMENT_ACCEPT_ROLES).
export function canAcceptPackingTask(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'warehouse_head'
}

// Пост-фактум корректировка обсчёта приёмки (принятое количество + сток) — менеджерский
// состав и начальник склада (ср. web canCorrectReceived, backend can_correct_received).
export function canCorrectReceived(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'warehouse_head'
}

// Внесение результата упаковки (годный/брак) — менеджерский состав, начальник смены
// и начальник склада (ср. backend ensure_packing_access).
export function canRecordPacking(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'shift_supervisor' || role === 'warehouse_head'
}
