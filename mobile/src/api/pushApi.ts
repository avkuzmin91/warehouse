import { request } from './http'

// --- API functions ---
export function registerPushToken(token: string, platform: string) {
  return request<{ message: string }>('/push/register', {
    method: 'POST',
    body: JSON.stringify({ token, platform }),
  })
}

export function unregisterPushToken(token: string) {
  return request<{ message: string }>('/push/unregister', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}
