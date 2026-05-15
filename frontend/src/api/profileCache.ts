import type { User } from './typesUser'

const ME_CACHE_MS = 15_000

let meCache: { user: User; token: string; expires: number } | null = null
let meInFlight: Promise<User> | null = null

export function clearProfileCache(): void {
  meCache = null
  meInFlight = null
}

export function readMeCache(): { user: User; token: string; expires: number } | null {
  return meCache
}

export function readMeInFlight(): Promise<User> | null {
  return meInFlight
}

export function writeMeInFlight(p: Promise<User> | null): void {
  meInFlight = p
}

export function writeMeCache(entry: { user: User; token: string; expires: number } | null): void {
  meCache = entry
}

export function meCacheTtlMs(): number {
  return ME_CACHE_MS
}
