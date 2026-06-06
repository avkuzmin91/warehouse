export type User = {
  id: string
  email: string
  role: 'user' | 'manager' | 'admin' | 'client' | 'warehouse_manager' | 'shift_supervisor'
  /** Справочник клиента (роль client); задаётся администратором. */
  client_id?: string | null
}
