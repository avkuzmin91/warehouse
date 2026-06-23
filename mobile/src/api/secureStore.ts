import { registerPlugin } from '@capacitor/core'

import { IS_NATIVE } from './constants'

// Нативное защищённое хранилище refresh-токена: Android Keystore.
// Плагин ставится перед нативной сборкой:
//   npm i capacitor-secure-storage-plugin && npx cap sync
// На вебе плагин не зарегистрирован — все вызовы перехватываются и игнорируются
// (там сессию держит refresh-cookie, см. docs/mobile-plan.md §6.1).
interface SecureStoragePlugin {
  get(options: { key: string }): Promise<{ value: string }>
  set(options: { key: string; value: string }): Promise<{ value: boolean }>
  remove(options: { key: string }): Promise<{ value: boolean }>
}

const SecureStorage = registerPlugin<SecureStoragePlugin>('SecureStoragePlugin')

const REFRESH_KEY = 'wms_refresh'

export async function loadStoredRefresh(): Promise<string | null> {
  if (!IS_NATIVE) return null
  try {
    const res = await SecureStorage.get({ key: REFRESH_KEY })
    return res.value ? res.value : null
  } catch {
    // get кидает, если ключа нет — это нормальное «нет сессии».
    return null
  }
}

export async function saveStoredRefresh(value: string): Promise<void> {
  if (!IS_NATIVE) return
  try {
    await SecureStorage.set({ key: REFRESH_KEY, value })
  } catch {
    // Без персиста сессия не переживёт рестарт, но в рамках сессии refresh
    // держится в памяти — это не повод валить логин.
  }
}

export async function clearStoredRefresh(): Promise<void> {
  if (!IS_NATIVE) return
  try {
    await SecureStorage.remove({ key: REFRESH_KEY })
  } catch {
    // нечего удалять
  }
}
