from __future__ import annotations

from fastapi import APIRouter, Depends

from dbconn import get_connection
from modules.auth.service import get_current_user
from modules.push.schemas import PushTokenRegister, PushTokenUnregister
from modules.push.service import remove_push_token, save_push_token

router = APIRouter(tags=["push"])


@router.post("/push/register")
def register_push_token(payload: PushTokenRegister, user=Depends(get_current_user)):
    with get_connection() as conn:
        save_push_token(conn, user_id=str(user["id"]), token=payload.token, platform=payload.platform)
        conn.commit()
    return {"message": "ok"}


@router.post("/push/unregister")
def unregister_push_token(payload: PushTokenUnregister, user=Depends(get_current_user)):
    with get_connection() as conn:
        remove_push_token(conn, token=payload.token)
        conn.commit()
    return {"message": "ok"}
