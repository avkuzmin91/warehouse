import type { User } from '../api/typesUser'

/** Куда вести пользователя после успешной аутентификации. */
export function postAuthLandingPath(user: User): string {
  if (user.role === 'client' && user.client_id?.trim()) return '/cabinet'
  return '/home'
}
