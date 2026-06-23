from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from config import (
    DISPATCH_CANCELLABLE_STATUSES,
    DISPATCH_CARGO_DEFECT,
    DISPATCH_CARGO_GOOD,
    DISPATCH_EDITABLE_STATUSES,
    DISPATCH_OP_ADVANCE,
    DISPATCH_OP_CANCEL,
    DISPATCH_OP_DOC_CREATE,
    DISPATCH_OP_DOC_UPDATE,
    DISPATCH_OP_LINE_ADD,
    DISPATCH_OP_LINE_DELETE,
    DISPATCH_OP_LINE_UPDATE,
    DISPATCH_OP_PRIORITY_UPDATE,
    DISPATCH_PRIORITY_LABELS,
    DISPATCH_STATUS_AWAITING_TRIP,
    DISPATCH_STATUS_CANCELLED,
    DISPATCH_STATUS_DRAFT,
    DISPATCH_STATUS_LABELS,
    DISPATCH_STATUS_PREPARING,
    DISPATCH_STATUSES_ALL,
    DISPATCH_TERMINAL_STATUSES,
)
from dbconn import get_connection, like_substring_param
from modules.auth.service import get_current_manager
from modules.dispatch.schemas import (
    DispatchDetailResponse,
    DispatchDocCreate,
    DispatchDocUpdate,
    DispatchFinishPreparationPayload,
    DispatchLineIn,
    DispatchLinesListItem,
    DispatchLinesResponse,
    DispatchLineUpdate,
    DispatchListItem,
    DispatchListResponse,
    DispatchPriorityUpdate,
)
from modules.dispatch.service import (
    check_lines_have_ready,
    check_lines_have_sku,
    dispatch_alloc_remaining,
    get_dispatch_detail,
    list_dispatches_aggregated,
    next_doc_number,
    normalize_cargo_type,
    prepare_to_ready,
    return_prepared_stock,
)

router = APIRouter(tags=["dispatch"])

_get_manager = get_current_manager


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _priority_label(rank: int | None) -> str:
    return DISPATCH_PRIORITY_LABELS.get(rank, f"#{rank}")


@router.post("/dispatches")
def create_dispatch(body: DispatchDocCreate, user=Depends(_get_manager)):
    uid = str(user["id"])
    now = _now()
    doc_id = str(uuid4())
    cargo_type = normalize_cargo_type(body.cargo_type)

    with get_connection() as conn:
        doc_num = next_doc_number(conn)
        conn.execute(
            """INSERT INTO dispatch_docs
               (id,doc_number,cargo_type,client_id,client_name,destination,carrier,logistics_cost,ship_date,comment,status,created_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (doc_id, doc_num, cargo_type, body.client_id, body.client_name,
             body.destination, body.carrier, body.logistics_cost, body.ship_date,
             (body.comment or "").strip() or None, DISPATCH_STATUS_DRAFT, now, uid),
        )
        for line in body.lines:
            conn.execute(
                """INSERT INTO dispatch_lines
                   (id,doc_id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
                    qty,shipped_qty,site_url,store_id,store_name,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (str(uuid4()), doc_id, line.product_id, line.product_name, line.product_sku,
                 line.color_id, line.color_name, line.size_id, line.size_name, line.qty,
                 0, line.site_url, line.store_id, line.store_name, now),
            )
        conn.execute(
            "INSERT INTO dispatch_ops (id,doc_id,op_type,created_at,created_by) VALUES (?,?,?,?,?)",
            (str(uuid4()), doc_id, DISPATCH_OP_DOC_CREATE, now, uid),
        )
        conn.commit()
    return {"message": doc_id}


@router.get("/dispatches", response_model=DispatchListResponse)
def list_dispatches(
    page:      int = Query(1, ge=1),
    limit:     int = Query(20, ge=1, le=200),
    status:    str | None = Query(None),
    client_id: str | None = Query(None),
    search:    str | None = Query(None),
    sku:       str | None = Query(None),
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    cargo_type: str | None = Query(None),
    available_for_trip_id: str | None = Query(None),
    user=Depends(_get_manager),
):
    with get_connection() as conn:
        items, total = list_dispatches_aggregated(
            conn,
            page=page, limit=limit,
            client_id=client_id, status=status, search=search, sku=sku,
            date_from=date_from, date_to=date_to, cargo_type=cargo_type,
            available_for_trip_id=available_for_trip_id,
        )
    return DispatchListResponse(
        items=[DispatchListItem(**it) for it in items],
        total=total, page=page, limit=limit,
    )


@router.get("/dispatches/summary")
def dispatches_summary(
    client_id: str | None = Query(None),
    search:    str | None = Query(None),
    sku:       str | None = Query(None),
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    cargo_type: str | None = Query(None),
    user=Depends(_get_manager),
):
    with get_connection() as conn:
        conds = ["d.is_deleted = 0"]
        params: list = []
        if cargo_type in (DISPATCH_CARGO_GOOD, DISPATCH_CARGO_DEFECT):
            conds.append("COALESCE(d.cargo_type, 'good') = ?"); params.append(cargo_type)
        if client_id:
            conds.append("d.client_id = ?"); params.append(client_id.strip())
        if search:
            s = like_substring_param(search)
            conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ? OR d.destination LIKE ?)")
            params += [s, s, s]
        if sku:
            conds.append(
                "EXISTS (SELECT 1 FROM dispatch_lines dl"
                " LEFT JOIN products p ON p.id = dl.product_id"
                " WHERE dl.doc_id = d.id AND COALESCE(dl.is_deleted,0)=0"
                " AND COALESCE(NULLIF(p.sku, ''), dl.product_sku) LIKE ?)"
            )
            params.append(like_substring_param(sku))
        if date_from:
            conds.append("d.ship_date >= ?"); params.append(date_from)
        if date_to:
            conds.append("d.ship_date <= ?"); params.append(date_to)
        where = " AND ".join(conds)
        rows = conn.execute(
            f"SELECT d.status FROM dispatch_docs d WHERE {where}", params
        ).fetchall()
    return {
        "all":       len(rows),
        "draft":     sum(1 for r in rows if r["status"] == DISPATCH_STATUS_DRAFT),
        "preparing": sum(1 for r in rows if r["status"] == DISPATCH_STATUS_PREPARING),
        "awaiting":  sum(1 for r in rows if r["status"] == DISPATCH_STATUS_AWAITING_TRIP),
        "shipped":   sum(1 for r in rows if r["status"] in DISPATCH_TERMINAL_STATUSES),
    }


@router.get("/dispatches/lines", response_model=DispatchLinesResponse)
def list_dispatch_lines(
    page:      int = Query(1, ge=1),
    limit:     int = Query(25, ge=1, le=200),
    status:    str | None = Query(None),
    client_id: str | None = Query(None),
    search:    str | None = Query(None),
    sku:       str | None = Query(None),
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    cargo_type: str | None = Query(None),
    user=Depends(_get_manager),
):
    with get_connection() as conn:
        conds = ["d.is_deleted = 0", "COALESCE(l.is_deleted, 0) = 0"]
        params: list = []
        if cargo_type in (DISPATCH_CARGO_GOOD, DISPATCH_CARGO_DEFECT):
            conds.append("COALESCE(d.cargo_type, 'good') = ?"); params.append(cargo_type)
        if status:
            requested = [s.strip() for s in status.split(",") if s.strip()]
            allowed = [s for s in requested if s in DISPATCH_STATUSES_ALL]
            if len(allowed) == 1:
                conds.append("d.status = ?"); params.append(allowed[0])
            elif len(allowed) > 1:
                placeholders = ",".join("?" for _ in allowed)
                conds.append(f"d.status IN ({placeholders})"); params.extend(allowed)
        if client_id:
            conds.append("d.client_id = ?"); params.append(client_id.strip())
        if search:
            s = like_substring_param(search)
            conds.append("(d.doc_number LIKE ? OR d.client_name LIKE ? OR d.destination LIKE ?)")
            params += [s, s, s]
        if sku:
            s = like_substring_param(sku)
            conds.append("(COALESCE(NULLIF(p.sku, ''), l.product_sku) LIKE ? OR l.product_name LIKE ?)")
            params += [s, s]
        if date_from:
            conds.append("d.ship_date >= ?"); params.append(date_from)
        if date_to:
            conds.append("d.ship_date <= ?"); params.append(date_to)
        where = " AND ".join(conds)
        total = int(conn.execute(
            f"""SELECT COUNT(*) AS cnt
                FROM dispatch_lines l
                JOIN dispatch_docs d ON d.id = l.doc_id
                LEFT JOIN products p ON p.id = l.product_id
                WHERE {where}""",
            params,
        ).fetchone()["cnt"])
        offset = (page - 1) * limit
        rows = conn.execute(
            f"""SELECT l.id AS line_id, l.doc_id AS doc_id,
                    l.product_id, l.product_name,
                    COALESCE(NULLIF(p.sku, ''), NULLIF(l.product_sku, ''), '') AS product_sku,
                    l.color_name, l.size_name, l.qty,
                    COALESCE(l.shipped_qty, 0) AS shipped_qty, l.store_name,
                    d.doc_number, d.cargo_type, d.client_id, d.client_name, d.destination,
                    d.ship_date, d.status
                FROM dispatch_lines l
                JOIN dispatch_docs d ON d.id = l.doc_id
                LEFT JOIN products p ON p.id = l.product_id
                WHERE {where}
                ORDER BY d.ship_date DESC NULLS LAST, d.created_at DESC, l.created_at
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

    items = [
        DispatchLinesListItem(
            line_id=str(r["line_id"]),
            doc_id=str(r["doc_id"]),
            doc_number=str(r["doc_number"]),
            cargo_type=normalize_cargo_type(r.get("cargo_type")),
            client_id=r["client_id"],
            client_name=r["client_name"],
            destination=r["destination"],
            ship_date=r["ship_date"],
            status=str(r["status"]),
            status_label=DISPATCH_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            product_id=str(r["product_id"]),
            product_name=str(r["product_name"]),
            product_sku=str(r["product_sku"]),
            color_name=r["color_name"],
            size_name=r["size_name"],
            qty=int(r["qty"] or 0),
            shipped_qty=int(r["shipped_qty"] or 0),
            store_name=r["store_name"],
        )
        for r in rows
    ]
    return DispatchLinesResponse(items=items, total=total, page=page, limit=limit)


@router.get("/dispatches/{doc_id}/trip-alloc-remaining")
def dispatch_trip_alloc_remaining(doc_id: str, user=Depends(_get_manager)):
    """Остаток к распределению по строкам отгрузки для привязки к рейсу."""
    with get_connection() as conn:
        doc = conn.execute(
            "SELECT id FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
        remaining = dispatch_alloc_remaining(conn, doc_id)
        lines = conn.execute(
            "SELECT l.id, "
            "COALESCE(NULLIF(p.sku, ''), NULLIF(l.product_sku, ''), '') AS product_sku, "
            "l.product_name, l.color_name, l.size_name, l.qty, l.shipped_qty "
            "FROM dispatch_lines l LEFT JOIN products p ON p.id = l.product_id "
            "WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0 ORDER BY product_sku, l.id",
            (doc_id,),
        ).fetchall()
    items = [
        {
            "line_id": str(ln["id"]),
            "product_sku": ln["product_sku"],
            "product_name": ln["product_name"],
            "color": ln["color_name"],
            "variant": " · ".join(x for x in [ln["color_name"], ln["size_name"]] if x) or None,
            "qty": int(ln["qty"] or 0),
            "shipped_qty": int(ln["shipped_qty"] or 0),
            "remaining": int(remaining.get(str(ln["id"]), 0)),
        }
        for ln in lines
    ]
    return {"lines": items}


@router.get("/dispatches/{doc_id}", response_model=DispatchDetailResponse)
def get_dispatch(doc_id: str, user=Depends(_get_manager)):
    with get_connection() as conn:
        detail = get_dispatch_detail(conn, doc_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Документ не найден")
    return DispatchDetailResponse(**detail)


@router.patch("/dispatches/{doc_id}")
def update_dispatch(doc_id: str, body: DispatchDocUpdate, user=Depends(_get_manager)):
    now = _now()
    uid = str(user["id"])
    fields = body.model_dump(exclude_unset=True)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, client_id, priority_rank FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (doc_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) not in DISPATCH_EDITABLE_STATUSES:
            raise HTTPException(status_code=400, detail="Изменять можно только черновик")
        if "comment" in fields:
            fields["comment"] = (fields["comment"] or "").strip() or None
        if "cargo_type" in fields:
            fields["cargo_type"] = normalize_cargo_type(fields["cargo_type"])
        if "actual_ship_date" in fields:
            fields["actual_ship_date"] = (fields["actual_ship_date"] or "").strip() or None
        if not fields:
            return {"message": "ok"}
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE dispatch_docs SET {sets}, updated_at = ? WHERE id = ?",
            list(fields.values()) + [now, doc_id],
        )
        if "client_id" in fields and (row["client_id"] or "") != (fields["client_id"] or ""):
            conn.execute(
                "UPDATE dispatch_lines SET store_id = NULL, store_name = NULL WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
                (doc_id,),
            )
        conn.execute(
            "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, DISPATCH_OP_DOC_UPDATE, "Документ изменён", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.patch("/dispatches/{doc_id}/priority")
def update_dispatch_priority(doc_id: str, body: DispatchPriorityUpdate, user=Depends(_get_manager)):
    now = _now()
    uid = str(user["id"])
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, priority_rank FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) in DISPATCH_TERMINAL_STATUSES:
            raise HTTPException(status_code=400, detail="Нельзя менять приоритет завершённой или аннулированной отгрузки")
        old_rank = int(row["priority_rank"]) if row.get("priority_rank") is not None else None
        new_rank = body.priority_rank
        if old_rank == new_rank:
            return {"message": "ok"}
        conn.execute(
            "UPDATE dispatch_docs SET priority_rank = ?, updated_at = ? WHERE id = ?",
            (new_rank, now, doc_id),
        )
        conn.execute(
            "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, DISPATCH_OP_PRIORITY_UPDATE,
             f"Приоритет отгрузки: {_priority_label(old_rank)} → {_priority_label(new_rank)}", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/dispatches/{doc_id}/lines")
def add_dispatch_line(doc_id: str, body: DispatchLineIn, user=Depends(_get_manager)):
    now = _now()
    uid = str(user["id"])
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) not in DISPATCH_EDITABLE_STATUSES:
            raise HTTPException(status_code=400, detail="Состав отгрузки можно менять только в черновике")
        line_id = str(uuid4())
        conn.execute(
            """INSERT INTO dispatch_lines
               (id,doc_id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
                qty,shipped_qty,site_url,store_id,store_name,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (line_id, doc_id, body.product_id, body.product_name, body.product_sku,
             body.color_id, body.color_name, body.size_id, body.size_name, body.qty,
             0, body.site_url, body.store_id, body.store_name, now),
        )
        conn.execute(
            "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, DISPATCH_OP_LINE_ADD, f"Добавлен товар «{body.product_name}»", now, uid),
        )
        conn.commit()
    return {"message": line_id}


@router.patch("/dispatches/{doc_id}/lines/{line_id}")
def update_dispatch_line(doc_id: str, line_id: str, body: DispatchLineUpdate, user=Depends(_get_manager)):
    now = _now()
    uid = str(user["id"])
    fields = body.model_dump(exclude_unset=True)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) not in DISPATCH_EDITABLE_STATUSES:
            raise HTTPException(status_code=400, detail="Состав отгрузки можно менять только в черновике")
        line = conn.execute(
            "SELECT id, product_name FROM dispatch_lines WHERE id = ? AND doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (line_id, doc_id),
        ).fetchone()
        if not line:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        if not fields:
            return {"message": "ok"}
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE dispatch_lines SET {sets} WHERE id = ? AND doc_id = ?",
            list(fields.values()) + [line_id, doc_id],
        )
        conn.execute(
            "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, DISPATCH_OP_LINE_UPDATE, f"Изменён товар «{line['product_name']}»", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.delete("/dispatches/{doc_id}/lines/{line_id}")
def delete_dispatch_line(doc_id: str, line_id: str, user=Depends(_get_manager)):
    now = _now()
    uid = str(user["id"])
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) not in DISPATCH_EDITABLE_STATUSES:
            raise HTTPException(status_code=400, detail="Состав отгрузки можно менять только в черновике")
        line = conn.execute(
            "SELECT id, product_name FROM dispatch_lines WHERE id = ? AND doc_id = ? AND COALESCE(is_deleted, 0) = 0",
            (line_id, doc_id),
        ).fetchone()
        if not line:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        conn.execute(
            "UPDATE dispatch_lines SET is_deleted = 1 WHERE id = ? AND doc_id = ?",
            (line_id, doc_id),
        )
        conn.execute(
            "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, DISPATCH_OP_LINE_DELETE, f"Удалён товар «{line['product_name']}»", now, uid),
        )
        conn.commit()
    return {"message": "ok"}


@router.post("/dispatches/{doc_id}/advance")
def advance_dispatch(doc_id: str, user=Depends(_get_manager)):
    """Менеджер передаёт отгрузку кладовщику на подготовку (draft → preparing)."""
    now = _now()
    uid = str(user["id"])
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) != DISPATCH_STATUS_DRAFT:
            raise HTTPException(status_code=400, detail="Передать в подготовку можно только из черновика")
        has_lines = conn.execute(
            "SELECT 1 FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 LIMIT 1", (doc_id,)
        ).fetchone()
        if not has_lines:
            raise HTTPException(status_code=400, detail="Добавьте товар")
        check_lines_have_sku(conn, doc_id)
        check_lines_have_ready(conn, doc_id)
        conn.execute(
            "UPDATE dispatch_docs SET status = ?, updated_at = ? WHERE id = ?",
            (DISPATCH_STATUS_PREPARING, now, doc_id),
        )
        conn.execute(
            "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, DISPATCH_OP_ADVANCE, "Создание → Подготовка отгрузки", now, uid),
        )
        conn.commit()
    return {"message": DISPATCH_STATUS_PREPARING}


@router.post("/dispatches/{doc_id}/finish-preparation")
def finish_dispatch_preparation(doc_id: str, body: DispatchFinishPreparationPayload, user=Depends(_get_manager)):
    """Кладовщик закончил подготовку отгрузки (preparing → awaiting_trip).

    Кладовщик указывает ячейки-источники по каждой строке — выбранное переезжает в
    «Готов к отгрузке» (зона отгрузки). Доступ — менеджерский состав + кладовщик/
    начальник склада (get_current_manager). Идемпотентно невозможно: гейт по статусу.
    Если рейс уже увёз отгрузку (статус проскочил в shipped/partially_shipped), кнопка
    недоступна — задача снята сама.
    """
    uid = str(user["id"])
    with get_connection() as conn:
        next_status = prepare_to_ready(conn, doc_id, body.lines, uid)
        conn.commit()
    return {"message": next_status}


@router.post("/dispatches/{doc_id}/cancel")
def cancel_dispatch(doc_id: str, user=Depends(_get_manager)):
    now = _now()
    uid = str(user["id"])
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, priority_rank FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if str(row["status"]) not in DISPATCH_CANCELLABLE_STATUSES:
            raise HTTPException(status_code=400, detail="Документ нельзя аннулировать в текущем статусе")
        if str(row["status"]) == DISPATCH_STATUS_AWAITING_TRIP:
            return_prepared_stock(conn, doc_id, uid)
        conn.execute(
            "UPDATE dispatch_docs SET status = ?, priority_rank = NULL, updated_at = ? WHERE id = ?",
            (DISPATCH_STATUS_CANCELLED, now, doc_id),
        )
        if row.get("priority_rank") is not None:
            conn.execute(
                "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                (str(uuid4()), doc_id, DISPATCH_OP_PRIORITY_UPDATE,
                 "Приоритет снят: документ аннулирован", now, uid),
            )
        conn.execute(
            "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, DISPATCH_OP_CANCEL, "Отгрузка аннулирована", now, uid),
        )
        conn.commit()
    return {"message": DISPATCH_STATUS_CANCELLED}
