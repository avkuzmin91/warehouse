\# AUTH MODULE ТЗ

\# 1. Цель системы
Реализовать простую систему авторизации и регистрации пользователей без подтверждения email.
После входа пользователь попадает на защищённую страницу с подтверждением успешного входа.

Технологии:
\- Backend: Python (FastAPI)
\- Frontend: React (JavaScript)
\- Авторизация: JWT
\- Пароли: bcrypt (хеширование)

\---

\# 2. Пользовательский сценарий

\## 2.1 Переход на страницу авторизации
\- Пользователь открывает приложение
\- По умолчанию отображается страница /auth (login page)

\---

\## 2.2 Регистрация
\- На странице логина есть кнопка: **"Зарегистрироваться"**
\- При нажатии открывается форма регистрации (modal или отдельная страница /auth/register)

\### Поля формы регистрации:
\- email (string, обязательное)
\- password (string, обязательное, минимум 6 символов)
\- confirmPassword (string, обязательное)

\### Правила валидации:
\- email должен быть валидным (формат email)
\- password и confirmPassword должны совпадать
\- password минимум 6 символов
\- email должен быть уникальным в системе

\### Поведение:
\- при успешной регистрации пользователь сохраняется в базе
\- пароль хранится только в хешированном виде (bcrypt/argon2)
\- пользователь автоматически НЕ логинится после регистрации
\- после регистрации пользователь перенаправляется на /auth (страницу логина)

\---

\## 2.3 Вход в систему

\### Форма логина:
\- email
\- password

\### Поведение:
\- пользователь вводит email + password
\- система проверяет данные
\- если данные верны:
  \- создаётся сессия или JWT токен
  \- пользователь перенаправляется на /dashboard

\---

\## 2.4 Страница после входа

Маршрут: /dashboard

Контент страницы:
\- текст:
  "Ура, вы вошли под учетной записью [email]!"

где:
\- [email] берётся из авторизованного пользователя (из токена или session)

\---

\# 3. Data Model

\## User
\- id: string (uuid)
\- email: string (unique)
\- password_hash: string
\- created_at: DateTime

\---

\# 4. Авторизация

\## Подход:
\- JWT или session-based (на выбор реализации)
\- токен содержит:
  \- userId
  \- email

\---

\## Защищённые маршруты:
\- /dashboard доступен только авторизованным пользователям
\- /auth и /auth/register доступны без авторизации

\---

\# 5. API (минимально необходимый набор)

\## Auth

\### POST /auth/register
Создание пользователя

Request:
\- email
\- password

Response:
\- success: boolean

\---

\### POST /auth/login
Вход пользователя

Request:
\- email
\- password

Response:
\- token (JWT) или session cookie

\---

\### GET /auth/me
Получение текущего пользователя

Response:
\- id
\- email

\---

\# 6. Бизнес-правила

\- Email должен быть уникальным
\- Пароль хранится только в хеше
\- Нельзя зарегистрировать пользователя с существующим email
\- После регистрации обязательный переход на login
\- После логина доступен только /dashboard
\- Без токена доступ к /dashboard запрещён
\- Пароль не менее 8 символов



\---

\# 7. UI структура

\## /auth (Login page)
\- email input
\- password input
\- button: "Войти"
\- button: "Зарегистрироваться"

\---

\## /auth/register
\- email input
\- password input
\- confirm password input
\- button: "Создать аккаунт"

\---

\## /dashboard
\- текст приветствия:
  "Ура, вы вошли под учетной записью [email]!"

\---

\# 8. Технические требования

\- TypeScript
\- bcrypt или argon2 для паролей
\- JWT или cookie session
\- middleware для защиты маршрутов
\- валидация входных данных обязательна

\---

\# 9. Нефункциональные требования

\- нельзя хранить пароль в открытом виде
\- нельзя отдавать password_hash через API
\- все защищённые маршруты должны проверять авторизацию



\# 9. UI

- Используй стили:

`:root {
  --bg-main: #08021c;
  --bg-deep: #050014;
  --card-bg: rgba(14, 10, 40, 0.54);
  --card-border: rgba(126, 92, 255, 0.2);
  --text-main: #f1edff;
  --text-soft: rgba(232, 226, 255, 0.72);
  --text-muted: rgba(225, 217, 255, 0.55);
  --field-bg: rgba(35, 24, 73, 0.42);
  --field-border: rgba(142, 110, 255, 0.24);
  --primary: #7f38ff;
  --primary-2: #6a1ce6;
  --primary-soft: #aa7cff;
  --fs-lg: clamp(32px, 3.2vw, 48px);
  --fs-md: clamp(20px, 1.8vw, 28px);
  --fs-sm: clamp(16px, 1.2vw, 20px);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  color: var(--text-main);
  background:
    linear-gradient(rgba(8, 2, 28, 0.16), rgba(5, 0, 20, 0.3)),
    url("autorisation2.png") center center / cover no-repeat fixed;
}

.page {
  min-height: 100vh;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: clamp(16px, 4vw, 48px);
  overflow: hidden;
}

.auth-card {
  width: 100%;
  max-width: 756px;
  border-radius: 22px;
  padding: clamp(24px, 3vw, 36px);
  border: 1px solid var(--card-border);
  background: linear-gradient(160deg, rgba(23, 16, 57, 0.56), var(--card-bg));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 20px 40px rgba(4, 0, 20, 0.45);
  backdrop-filter: blur(10px);
}

.auth-card__title {
  margin: 0 0 10px;
  font-size: var(--fs-lg);
  line-height: 1.08;
  font-weight: 800;
}

.auth-card__subtitle {
  margin: 0 0 30px;
  color: var(--text-soft);
  font-size: var(--fs-md);
  font-weight: 500;
}

.auth-form {
  display: flex;
  flex-direction: column;
}

.field-label {
  margin-bottom: 8px;
  color: rgba(232, 224, 255, 0.84);
  font-size: var(--fs-sm);
  font-weight: 500;
}

.field-input {
  width: 100%;
  height: 56px;
  border: 1px solid var(--field-border);
  border-radius: 14px;
  outline: none;
  padding: 0 18px;
  margin-bottom: 20px;
  color: var(--text-main);
  background: var(--field-bg);
  font-size: var(--fs-md);
  font-weight: 400;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.field-input::placeholder {
  color: rgba(214, 202, 255, 0.36);
}

.field-input:focus {
  border-color: rgba(177, 143, 255, 0.8);
  box-shadow: 0 0 0 3px rgba(123, 63, 255, 0.2);
}

.password-wrap {
  position: relative;
}

.password-wrap .field-input {
  padding-right: 52px;
  margin-bottom: 18px;
}

.eye-btn {
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-66%);
  border: none;
  background: transparent;
  color: rgba(196, 175, 255, 0.45);
  width: 28px;
  height: 28px;
  padding: 0;
  cursor: default;
}

.eye-btn svg {
  width: 100%;
  height: 100%;
}

.auth-form__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 2px 0 30px;
  gap: 12px;
}

.remember {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: default;
  user-select: none;
}

.remember input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.remember__box {
  width: 21px;
  height: 21px;
  border-radius: 5px;
  border: 2px solid #8f47ff;
  background: rgba(25, 16, 56, 0.4);
}

.remember__text {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-weight: 500;
}

.forgot-link {
  color: #9a4dff;
  text-decoration: none;
  font-size: var(--fs-sm);
  font-weight: 600;
}

.forgot-link:hover {
  color: #b47aff;
}

.btn {
  width: 100%;
  border-radius: 14px;
  height: 68px;
  border: 1px solid transparent;
  color: #f7f0ff;
  font-size: var(--fs-md);
  font-weight: 600;
  font-family: inherit;
}

.btn--primary {
  background: linear-gradient(90deg, var(--primary-2), var(--primary));
  box-shadow: 0 10px 24px rgba(95, 31, 208, 0.45);
}

.divider {
  margin: 26px 0 22px;
  text-align: center;
  color: rgba(214, 202, 255, 0.45);
  font-size: var(--fs-sm);
  font-weight: 500;
  position: relative;
}

.divider::before,
.divider::after {
  content: "";
  position: absolute;
  top: 50%;
  width: 38%;
  height: 1px;
  background: rgba(147, 110, 255, 0.18);
}

.divider::before {
  left: 0;
}

.divider::after {
  right: 0;
}

.btn--secondary {
  background: rgba(17, 10, 42, 0.4);
  border-color: rgba(145, 106, 255, 0.55);
  color: rgba(239, 231, 255, 0.95);
}

@media (max-width: 1200px) {
  .page {
    justify-content: flex-end;
  }

  .field-input {
    height: 52px;
  }

  .btn {
    height: 58px;
  }
}

@media (max-width: 900px) {
  .page {
    justify-content: center;
    padding: 20px 14px 30px;
  }

  .auth-card {
    max-width: 520px;
  }
}

@media (max-width: 520px) {
  .auth-card {
    border-radius: 18px;
    padding: 20px 16px;
  }

  .auth-card__title {
    margin-bottom: 8px;
  }

  .auth-card__subtitle {
    margin-bottom: 22px;
  }

  .auth-form__row {
    margin-bottom: 20px;
    align-items: flex-start;
    flex-direction: column;
  }

  .btn {
    height: 54px;
  }

  .divider {
    margin: 20px 0 16px;
  }
}`

- Используй верстку страницы index