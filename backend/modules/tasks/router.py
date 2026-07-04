from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from dbconn import get_connection
from modules.auth.service import get_current_dashboard_user
from modules.tasks.schemas import TaskItem, TaskReadPayload, TasksResponse
from modules.tasks.service import (
    annotate_task_reads,
    list_my_tasks,
    mark_all_tasks_read,
    mark_task_read,
)

router = APIRouter(tags=["tasks"])


@router.get("/tasks", response_model=TasksResponse)
def get_my_tasks(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_dashboard_user),
):
    with get_connection() as conn:
        tasks = list_my_tasks(conn, user=user)
        annotate_task_reads(conn, tasks, user_id=str(user["id"]))
    offset = (page - 1) * limit
    items = [TaskItem(**t) for t in tasks[offset : offset + limit]]
    unread = sum(1 for t in tasks if not t["is_read"])
    return TasksResponse(items=items, total=len(tasks), unread=unread)


@router.post("/tasks/read")
def read_task(payload: TaskReadPayload, user=Depends(get_current_dashboard_user)):
    with get_connection() as conn:
        mark_task_read(conn, user_id=str(user["id"]), kind=payload.kind, doc_id=payload.doc_id)
        conn.commit()
    return {"message": "ok"}


@router.post("/tasks/read-all")
def read_all_tasks(user=Depends(get_current_dashboard_user)):
    with get_connection() as conn:
        mark_all_tasks_read(conn, user=user)
        conn.commit()
    return {"message": "ok"}
