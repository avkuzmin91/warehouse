from __future__ import annotations

import io
import re
from datetime import UTC, datetime
from typing import Any, Mapping
from uuid import uuid4

from fastapi import HTTPException, status
from psycopg import IntegrityError

from config import LOCATION_KIND_CELL, LOCATION_KIND_SPECIAL, LOCATION_QR_PREFIX
from dbconn import get_connection

from .schemas import (
    LocationBulkCreateRequest,
    LocationBulkResult,
    LocationCreateRequest,
    LocationItem,
    LocationLabel,
    LocationLabelsResponse,
    LocationListResponse,
    LocationLookupResponse,
)
from modules.dictionaries.schemas import MessageResponse

# Этикеток за один лист печати не безгранично: тот же потолок, что у остатков
# по местам (ZONE_ROWS_LIMIT). Печать сужают фильтром по помещению/стеллажу.
LABELS_LIMIT = 2000


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _norm_segment(raw: object, label: str) -> str:
    s = str(raw or "").strip().upper()
    if not s:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Поле «{label}» обязательно")
    return s


def _pad_section(n: int) -> str:
    return f"{n:02d}"


def format_cell_code(room: str, rack: str, section: str, floor: str) -> str:
    """Человекочитаемый адрес ячейки: Помещение-Стеллаж-Секция-Этаж → «1-А-10-1»."""
    return f"{room}-{rack}-{section}-{floor}"


def _row_to_item(row: Mapping[str, Any]) -> LocationItem:
    return LocationItem(
        id=str(row["id"]),
        code=row["name"],
        room=row.get("room"),
        rack=row.get("rack"),
        section=row.get("section"),
        floor=row.get("floor"),
        # NULL kind у мест, заведённых старым справочником — это служебные зоны.
        kind=row.get("kind") or LOCATION_KIND_SPECIAL,
        is_packing_zone=bool(row.get("is_packing_zone") or 0),
        is_shipping_zone=bool(row.get("is_shipping_zone") or 0),
        is_active=bool(row["is_active"]),
        is_deleted=bool(row.get("is_deleted") or 0),
        created_at=row["created_at"],
    )


_SELECT_COLS = (
    "id, name, kind, room, rack, section, floor, "
    "COALESCE(is_packing_zone, 0) AS is_packing_zone, "
    "COALESCE(is_shipping_zone, 0) AS is_shipping_zone, "
    "is_active, COALESCE(is_deleted, 0) AS is_deleted, created_at"
)


def create_location(payload: LocationCreateRequest, creator_id: str) -> LocationItem:
    room = _norm_segment(payload.room, "Помещение")
    rack = _norm_segment(payload.rack, "Стеллаж")
    section = _pad_section(payload.section)
    floor = str(payload.floor)
    code = format_cell_code(room, rack, section, floor)
    loc_id = str(uuid4())
    now = _now()
    with get_connection() as conn:
        try:
            conn.execute(
                "INSERT INTO unloading_zones "
                "(id, name, kind, room, rack, section, floor, is_active, created_at, creator_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (loc_id, code, LOCATION_KIND_CELL, room, rack, section, floor,
                 1 if payload.is_active else 0, now, creator_id),
            )
            conn.commit()
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ячейка «{code}» уже существует",
            ) from exc
    return LocationItem(
        id=loc_id, code=code, room=room, rack=rack, section=section, floor=floor,
        kind=LOCATION_KIND_CELL, is_active=payload.is_active, is_deleted=False, created_at=now,
    )


def bulk_create_locations(payload: LocationBulkCreateRequest, creator_id: str) -> LocationBulkResult:
    room = _norm_segment(payload.room, "Помещение")
    racks: list[str] = []
    for r in payload.racks:
        rr = str(r or "").strip().upper()
        if rr and rr not in racks:
            racks.append(rr)
    if not racks:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите хотя бы один стеллаж")

    combos: list[tuple[str, str, str]] = []
    for rack in racks:
        for s in range(1, payload.sections + 1):
            section = _pad_section(s)
            for f in range(1, payload.floors + 1):
                combos.append((rack, section, str(f)))
    codes = [format_cell_code(room, rack, section, floor) for rack, section, floor in combos]

    now = _now()
    created = 0
    skipped = 0
    with get_connection() as conn:
        # Предварительно отсеиваем уже существующие имена: вставка-по-одной с откатом
        # на IntegrityError порвала бы общую транзакцию, savepoints — лишний шум.
        existing: set[str] = set()
        if codes:
            rows = conn.execute(
                "SELECT name FROM unloading_zones WHERE name = ANY(?)", (codes,)
            ).fetchall()
            existing = {r["name"] for r in rows}
        for (rack, section, floor), code in zip(combos, codes):
            if code in existing:
                skipped += 1
                continue
            conn.execute(
                "INSERT INTO unloading_zones "
                "(id, name, kind, room, rack, section, floor, is_active, created_at, creator_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (str(uuid4()), code, LOCATION_KIND_CELL, room, rack, section, floor,
                 1 if payload.is_active else 0, now, creator_id),
            )
            created += 1
        conn.commit()
    return LocationBulkResult(created=created, skipped=skipped)


def list_locations(
    page: int,
    limit: int,
    *,
    room: str | None,
    rack: str | None,
    search: str | None,
    include_deleted: bool = False,
) -> LocationListResponse:
    offset = (page - 1) * limit
    # Единый справочник «Места хранения»: и адресные ячейки (kind='cell'),
    # и служебные зоны / разовые места (kind='special' либо NULL у старых записей).
    conds = ["1=1"]
    params: list[Any] = []
    if not include_deleted:
        conds.append("COALESCE(is_deleted, 0) = 0")
    if room and str(room).strip():
        conds.append("room = ?")
        params.append(str(room).strip().upper())
    if rack and str(rack).strip():
        conds.append("rack = ?")
        params.append(str(rack).strip().upper())
    if search and str(search).strip():
        conds.append("LOWER(name) LIKE LOWER(?)")
        params.append(f"%{str(search).strip()}%")
    where_sql = " AND ".join(conds)
    with get_connection() as conn:
        total = int(
            conn.execute(
                f"SELECT COUNT(*) AS cnt FROM unloading_zones WHERE {where_sql}", params
            ).fetchone()["cnt"]
        )
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM unloading_zones WHERE {where_sql} "
            # Ячейки (room задан) — по адресу; служебные зоны (room NULL) — после, по имени.
            "ORDER BY room IS NULL, room ASC, rack ASC, section ASC, floor ASC, LOWER(name) ASC "
            "LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return LocationListResponse(
        items=[_row_to_item(r) for r in rows], total=total, page=page, limit=limit
    )


def lookup_location(raw: str) -> LocationLookupResponse:
    """Сканер: payload QR («wms:loc:<id>»), голый id или код адреса → место."""
    s = (raw or "").strip()
    if not s:
        return LocationLookupResponse(found=False)
    if s.startswith(LOCATION_QR_PREFIX):
        s = s[len(LOCATION_QR_PREFIX):].strip()
    if not s:
        return LocationLookupResponse(found=False)
    with get_connection() as conn:
        row = conn.execute(
            f"SELECT {_SELECT_COLS} FROM unloading_zones "
            "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
            (s,),
        ).fetchone()
        if not row:
            row = conn.execute(
                f"SELECT {_SELECT_COLS} FROM unloading_zones "
                "WHERE name = ? AND COALESCE(is_deleted, 0) = 0",
                (s,),
            ).fetchone()
    if not row:
        return LocationLookupResponse(found=False)
    return LocationLookupResponse(found=True, location=_row_to_item(row))


def _qr_svg(payload: str) -> str:
    try:
        import segno
    except ImportError as exc:  # сборка backend без segno
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="QR-генератор не установлен (segno). Пересоберите backend.",
        ) from exc
    qr = segno.make(payload, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=4, border=2, xmldecl=False, svgns=True)
    svg = buf.getvalue().decode("utf-8")
    # segno отдаёт фиксированные width/height (px) без viewBox — при CSS-масштабе
    # рисунок не тянется (QR висит в углу, код «далеко»). Добавляем viewBox, чтобы
    # QR масштабировался под размер этикетки.
    if "viewBox" not in svg:
        m = re.search(r'<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"', svg)
        if m:
            svg = svg.replace("<svg", f'<svg viewBox="0 0 {m.group(1)} {m.group(2)}"', 1)
    return svg


def list_location_labels(
    *, room: str | None = None, rack: str | None = None, ids: list[str] | None = None
) -> LocationLabelsResponse:
    conds = ["COALESCE(is_deleted, 0) = 0"]
    params: list[Any] = []
    selected = [str(i).strip() for i in (ids or []) if str(i).strip()]
    if selected:
        # Явный выбор мест — этикетки печатают для любых выбранных (ячейки и зоны).
        conds.append("id = ANY(?)")
        params.append(selected)
    else:
        # Без выбора — печать по фильтру помещение/стеллаж, только адресные ячейки.
        conds.append("kind = ?")
        params.append(LOCATION_KIND_CELL)
        if room and str(room).strip():
            conds.append("room = ?")
            params.append(str(room).strip().upper())
        if rack and str(rack).strip():
            conds.append("rack = ?")
            params.append(str(rack).strip().upper())
    where_sql = " AND ".join(conds)
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT id, name FROM unloading_zones WHERE {where_sql} "
            "ORDER BY room IS NULL, room ASC, rack ASC, section ASC, floor ASC, LOWER(name) ASC LIMIT ?",
            [*params, LABELS_LIMIT],
        ).fetchall()
    items: list[LocationLabel] = []
    for r in rows:
        payload = f"{LOCATION_QR_PREFIX}{r['id']}"
        items.append(
            LocationLabel(id=str(r["id"]), code=r["name"], payload=payload, qr_svg=_qr_svg(payload))
        )
    return LocationLabelsResponse(items=items)


def delete_location(loc_id: str, editor_id: str) -> MessageResponse:
    now = _now()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(is_deleted, 0) AS del FROM unloading_zones WHERE id = ?",
            (loc_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Место не найдено")
        conn.execute(
            "UPDATE unloading_zones SET is_deleted = 1, deleted_at = ?, deleted_by_id = ?, "
            "updated_at = ?, updated_by_id = ? WHERE id = ?",
            (now, editor_id, now, editor_id, loc_id),
        )
        conn.commit()
    return MessageResponse(message="Удалено")
