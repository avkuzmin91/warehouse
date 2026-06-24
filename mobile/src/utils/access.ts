// Право создавать документы (поступления/задачи упаковки/отгрузки) — только
// менеджерский состав (ср. web canCreateDocuments). Складские роли, включая
// начальника склада, работают с документами в режиме просмотра + операций.
export function canCreateDocuments(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager'
}
