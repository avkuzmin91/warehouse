// Текущий FCM-токен устройства: запоминается при регистрации, забирается при
// выходе, чтобы отвязать устройство на сервере (иначе пуши прилетали бы после logout).
let currentToken: string | null = null

export function rememberPushToken(token: string) {
  currentToken = token
}

export function takePushToken(): string | null {
  const token = currentToken
  currentToken = null
  return token
}
