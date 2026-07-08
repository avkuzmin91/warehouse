from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class UserListItem(BaseModel):
    id: str
    email: EmailStr
    display_name: str | None = None
    role: str
    created_at: str
    client_id: str | None = None
    client_name: str | None = None


class RoleUpdateRequest(BaseModel):
    role: str


class UserDisplayNameUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None)


class UserClientAssignRequest(BaseModel):
    client_id: str | None = Field(default=None)


class UserDeletePatchRequest(BaseModel):
    is_deleted: bool


class MessageResponse(BaseModel):
    message: str
