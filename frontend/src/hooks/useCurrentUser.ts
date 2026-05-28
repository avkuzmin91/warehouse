import { useContext } from 'react'
import { CurrentUserContext, type CurrentUser } from './currentUserContext'

export type { CurrentUser }

export function useCurrentUser(): CurrentUser {
  return useContext(CurrentUserContext)
}
