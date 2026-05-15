let accessTokenMemory: string | null = null

export function getToken(): string | null {
  return accessTokenMemory
}

export function setAccessTokenMemory(token: string | null): void {
  accessTokenMemory = token
}
