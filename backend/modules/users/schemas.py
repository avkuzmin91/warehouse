from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class UserListItem(BaseModel):
    id: str
    email: EmailStr
    role: str
    created_at: str
    client_id: str | None = None
    client_name: str | None = None


class RoleUpdateRequest(BaseModel):
    role: str


class UserClientAssignRequest(BaseModel):
    client_id: str | None = Field(default=None)


class UserDeletePatchRequest(BaseModel):
    is_deleted: bool


class MessageResponse(BaseModel):
    message: str
