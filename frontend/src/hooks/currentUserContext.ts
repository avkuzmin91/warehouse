import { createContext } from 'react'
import type { User } from '../api/typesUser'

export interface CurrentUser {
  user: User | null
  loading: boolean
}

export const CurrentUserContext = createContext<CurrentUser>({ user: null, loading: true })
