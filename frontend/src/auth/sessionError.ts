/** Выбрасывается из API-слоя при 401 с Bearer: сессия сброшена, запланирован редирект на `/auth`. */
export class SessionExpiredError extends Error {
  readonly isSessionExpired = true as const

  constructor() {
    super('Сессия истекла')
    this.name = 'SessionExpiredError'
  }
}

export function isSessionExpiredError(e: unknown): boolean {
  return (
    e instanceof SessionExpiredError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { isSessionExpired?: boolean }).isSessionExpired === true)
  )
}
