from __future__ import annotations

from fastapi import APIRouter, Depends

from dbconn import get_connection
from modules.auth.service import get_current_manager
from modules.tasks.schemas import TaskItem, TasksResponse
from modules.tasks.service import list_my_tasks

router = APIRouter(tags=["tasks"])


@router.get("/tasks", response_model=TasksResponse)
def get_my_tasks(user=Depends(get_current_manager)):
    with get_connection() as conn:
        tasks = list_my_tasks(conn, user=user)
    items = [TaskItem(**t) for t in tasks]
    return TasksResponse(items=items, total=len(items))
