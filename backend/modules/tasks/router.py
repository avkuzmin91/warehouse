from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from dbconn import get_connection
from modules.auth.service import get_current_dashboard_user
from modules.tasks.schemas import TaskItem, TasksResponse
from modules.tasks.service import list_my_tasks

router = APIRouter(tags=["tasks"])


@router.get("/tasks", response_model=TasksResponse)
def get_my_tasks(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_dashboard_user),
):
    with get_connection() as conn:
        tasks = list_my_tasks(conn, user=user)
    offset = (page - 1) * limit
    items = [TaskItem(**t) for t in tasks[offset : offset + limit]]
    return TasksResponse(items=items, total=len(tasks))
