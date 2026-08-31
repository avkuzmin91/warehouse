"""Коды маркировки «Честный знак»: разбор GS1 DataMatrix и реестр отсканированных КИЗ."""

from __future__ import annotations

import re
from uuid import uuid4

from utils import now_iso as _now

# Разделитель полей GS1 (FNC1); сканер отдаёт его как ASCII GS = 0x1D.
GS = "\x1d"

# Символьный префикс DataMatrix (AIM ISO/IEC 15424) — часть сканеров шлёт его с данными.
SYMBOLOGY_PREFIX = "]d2"

# AI, встречающиеся в кодах ЧЗ. Число — длина данных фиксированного AI,
# None — переменная длина (поле обрывается разделителем GS или концом строки).
AI_DATA_LENGTH: dict[str, int | None] = {
    "01": 14,
    "17": 6,
    "8005": 6,
    "10": None,
    "21": None,
    "91": None,
    "92": None,
    "93": None,
}

# Серийный номер ЧЗ для товарных групп, которые едут через маркетплейсы (лёгкая
# промышленность, обувь), — ровно 13 символов. Нужно, когда сканер вырезал GS.
SERIAL_FALLBACK_LENGTH = 13

# Python считает 0x1D пробельным символом, а JS — нет: голый strip() срезал бы
# завершающий разделитель и разошёлся бы с mobile/src/utils/cis.ts по флагу is_exact.
_TRIM_CHARS = " \t\r\n"

_GTIN_RE = re.compile(r"^\d{14}$")
_CIS_HEAD_RE = re.compile(r"^01\d{14}21")


def _normalize(raw: str) -> str:
    s = (raw or "").strip(_TRIM_CHARS)
    if s.startswith(SYMBOLOGY_PREFIX):
        s = s[len(SYMBOLOGY_PREFIX) :]
    while s.startswith(GS):
        s = s[1:]
    return s


def _read_ai(s: str, pos: int) -> str | None:
    for length in (4, 3, 2):
        ai = s[pos : pos + length]
        if len(ai) == length and ai in AI_DATA_LENGTH:
            return ai
    return None


def parse_cis(raw: str) -> dict | None:
    """GS1 DataMatrix ЧЗ → ``{"gtin", "serial", "is_exact"}``; None, если это не КИЗ.

    Разбор дублирует ``mobile/src/utils/cis.ts`` осознанно: клиент парсит ради мгновенной
    подсказки на экране, но идентичность кода в БД определяет сервер — иначе ключ
    уникальности реестра задавал бы клиент.
    """
    s = _normalize(raw)
    if not _CIS_HEAD_RE.match(s):
        return None
    # Без единого GS любое поле переменной длины разобрано допущением, а не по спецификации.
    is_exact = GS in s
    pos = 0
    gtin = ""
    serial = ""

    while pos < len(s):
        if s[pos] == GS:
            pos += 1
            continue
        ai = _read_ai(s, pos)
        if ai is None:
            # Хвост не опознан. Идентифицирующая часть уже прочитана — этого достаточно.
            if gtin and serial:
                break
            return None
        pos += len(ai)

        fixed = AI_DATA_LENGTH[ai]
        if fixed is not None:
            value = s[pos : pos + fixed]
            if len(value) < fixed:
                return None
            pos += fixed
        else:
            end = s.find(GS, pos)
            if end >= 0:
                value = s[pos:end]
                pos = end + 1
            else:
                value = s[pos:]
                if ai == "21" and len(value) > SERIAL_FALLBACK_LENGTH:
                    value = value[:SERIAL_FALLBACK_LENGTH]
                pos += len(value)

        if ai == "01":
            gtin = value
        elif ai == "21":
            serial = value

    if not _GTIN_RE.match(gtin) or not serial:
        return None
    return {"gtin": gtin, "serial": serial, "is_exact": is_exact}


def gtin_to_ean13(gtin: str) -> str | None:
    """GTIN-14 → EAN-13 варианта. Ненулевая ведущая цифра — GTIN групповой упаковки."""
    return gtin[1:] if re.match(r"^0\d{13}$", gtin or "") else None


def resolve_variant(connection, gtin: str) -> dict | None:
    """Вариант товара по GTIN кода маркировки — через существующие штрих-коды."""
    ean13 = gtin_to_ean13(gtin)
    if not ean13:
        return None
    row = connection.execute(
        """
        SELECT v.id AS variant_id, p.id AS product_id, p.client_id
        FROM product_barcodes pb
        JOIN product_variants v ON v.id = pb.variant_id
        JOIN products p ON p.id = pb.product_id
        WHERE pb.barcode = ?
          AND COALESCE(pb.is_deleted, 0) = 0
          AND COALESCE(v.is_deleted, 0) = 0
          AND COALESCE(p.is_deleted, 0) = 0
        LIMIT 1
        """,
        (ean13,),
    ).fetchone()
    if not row:
        return None
    return {
        "variant_id": str(row["variant_id"]),
        "product_id": str(row["product_id"]),
        "client_id": str(row["client_id"]) if row["client_id"] else None,
    }


_SELECT_CODE = """
    SELECT mc.id, mc.gtin, mc.serial, mc.raw, mc.variant_id, mc.product_id,
           mc.client_id, mc.is_exact, mc.created_at, mc.created_by,
           p.name AS product_name, v.sku, cl.name AS client_name,
           u.email AS created_by_email
    FROM marking_codes mc
    LEFT JOIN products p ON p.id = mc.product_id
    LEFT JOIN product_variants v ON v.id = mc.variant_id
    LEFT JOIN clients cl ON cl.id = mc.client_id
    LEFT JOIN users u ON u.id = mc.created_by
"""


def _row_to_item(row) -> dict:
    return {
        "id": str(row["id"]),
        "gtin": str(row["gtin"]),
        "serial": str(row["serial"]),
        "raw": str(row["raw"]),
        "variant_id": str(row["variant_id"]) if row["variant_id"] else None,
        "product_id": str(row["product_id"]) if row["product_id"] else None,
        "product_name": str(row["product_name"]) if row["product_name"] else None,
        "sku": str(row["sku"]) if row["sku"] else None,
        "client_id": str(row["client_id"]) if row["client_id"] else None,
        "client_name": str(row["client_name"]) if row["client_name"] else None,
        "is_exact": bool(row["is_exact"]),
        "created_at": str(row["created_at"]) if row["created_at"] else None,
        "created_by_email": str(row["created_by_email"]) if row["created_by_email"] else None,
    }


def find_active_by_sgtin(connection, gtin: str, serial: str) -> dict | None:
    row = connection.execute(
        f"{_SELECT_CODE} WHERE mc.gtin = ? AND mc.serial = ? AND COALESCE(mc.is_deleted, 0) = 0 LIMIT 1",
        (gtin, serial),
    ).fetchone()
    return _row_to_item(row) if row else None


def save_scanned_code(connection, raw: str, parsed: dict, uid: str) -> dict:
    """Записать отсканированный КИЗ. Вариант товара резолвится по GTIN, если он известен."""
    variant = resolve_variant(connection, parsed["gtin"])
    code_id = str(uuid4())
    connection.execute(
        "INSERT INTO marking_codes "
        "(id, gtin, serial, raw, variant_id, product_id, client_id, is_exact, created_at, created_by, is_deleted) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,0)",
        (
            code_id,
            parsed["gtin"],
            parsed["serial"],
            raw,
            variant["variant_id"] if variant else None,
            variant["product_id"] if variant else None,
            variant["client_id"] if variant else None,
            1 if parsed["is_exact"] else 0,
            _now(),
            uid,
        ),
    )
    row = connection.execute(f"{_SELECT_CODE} WHERE mc.id = ?", (code_id,)).fetchone()
    return _row_to_item(row)


def list_codes(connection, *, page: int, limit: int, client_id=None, search=None) -> dict:
    where = ["COALESCE(mc.is_deleted, 0) = 0"]
    params: list = []
    if client_id:
        where.append("mc.client_id = ?")
        params.append(client_id)
    if search:
        where.append("(mc.serial ILIKE ? OR mc.gtin ILIKE ? OR p.name ILIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])
    clause = " AND ".join(where)

    total_row = connection.execute(
        "SELECT COUNT(*) AS n FROM marking_codes mc "
        "LEFT JOIN products p ON p.id = mc.product_id "
        f"WHERE {clause}",
        tuple(params),
    ).fetchone()
    rows = connection.execute(
        f"{_SELECT_CODE} WHERE {clause} ORDER BY mc.created_at DESC LIMIT ? OFFSET ?",
        tuple(params) + (limit, (page - 1) * limit),
    ).fetchall()
    return {
        "items": [_row_to_item(r) for r in rows],
        "total": int(total_row["n"]),
        "page": page,
        "limit": limit,
    }
