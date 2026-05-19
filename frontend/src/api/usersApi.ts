import { request } from './http'
import type { UserListItem } from './domainTypes'

export function getUsers() {
  return request<UserListItem[]>('/users')
}

export function updateUserRole(userId: string, role: 'user' | 'manager' | 'client') {
  return request<{ message: string }>(`/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export function updateUserClient(userId: string, clientId: string | null) {
  return request<{ message: string }>(`/users/${userId}/client`, {
    method: 'PATCH',
    body: JSON.stringify({ client_id: clientId }),
  })
}

export function deleteUser(userId: string) {
  return request<{ message: string }>(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_deleted: true }),
  })
}
