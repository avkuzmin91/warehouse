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
