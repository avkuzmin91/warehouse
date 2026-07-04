from __future__ import annotations

from pydantic import BaseModel, Field


class PushTokenRegister(BaseModel):
    token: str = Field(min_length=1)
    platform: str | None = None


class PushTokenUnregister(BaseModel):
    token: str = Field(min_length=1)
