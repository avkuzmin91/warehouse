from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class RegisterResponse(BaseModel):
    success: bool


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    # Заполняется только для мобильного клиента (X-Client: mobile) — браузер
    # получает refresh через HttpOnly cookie и это поле игнорирует.
    refresh_token: str | None = Field(default=None)


class RefreshRequest(BaseModel):
    refresh_token: str | None = Field(default=None)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class MeResponse(BaseModel):
    id: str
    email: EmailStr
    role: str
    client_id: str | None = Field(default=None)
