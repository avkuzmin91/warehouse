export type User = {
  id: string
  email: string
  /** Отображаемое имя, заданное админом; если пусто — в интерфейсе показывается email. */
  display_name?: string | null
  role: 'user' | 'manager' | 'admin' | 'client' | 'warehouse_manager' | 'shift_supervisor' | 'warehouse_head' | 'picker'
  /** Справочник клиента (роль client); задаётся администратором. */
  client_id?: string | null
}
