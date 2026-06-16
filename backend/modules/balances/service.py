from __future__ import annotations

from config import (
    INV_OP_INTAKE,
    INV_OP_PACKING,
    INV_OP_READY,
    INV_OP_SINKS,
    INV_OP_STORAGE,
    INV_OP_WRITTEN_OFF,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    INV_QUALITY_LABELS,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    WRITEOFF_REASON_OTHER,
)
from dbconn import like_substring_param
from modules.balances.schemas import (
    BalanceItem,
    BalanceListResponse,
    BalanceSummaryResponse,
    BalanceZoneItem,
    BalanceZonesResponse,
)

# Модель остатков на двух осях — чистый replay журнала zone_relocations:
#   операционный статус: storage «На хранении» | packing «На упаковке» |
#                        ready «Готов к отгрузке» | shipped «Отгружен» (терминальный)
#   качество:            good «Годный» | defect «Брак»
#
# Баланс позиции в корзине (op, quality) = Σ движений в корзину − Σ движений из корзины.
# Приход приёмки — движение (intake → storage) при завершении поступления (миграция 0046),
# списание при отправке рейса — движение (… → shipped), ручное списание остатков —
# движение (storage → written_off) с обязательной причиной. intake не корзина
# (только источник), shipped и written_off — терминальные стоки (INV_OP_SINKS).
# Инвариант: остаток меняется ⇔ есть запись в журнале.
#
# Остатки — чисто журнальные: товар появляется в выдаче только после проведённого
# прихода (intake → storage). Незавершённая приёмка (документ в on_intake) в остатки
# не попадает — пока кладовщик считает, журнальной записи ещё нет.

_BUCKETS: list[tuple[str, str]] = [
    (INV_OP_STORAGE, INV_Q_GOOD),
    (INV_OP_STORAGE, INV_Q_DEFECT),
    (INV_OP_PACKING, INV_Q_GOOD),
    (INV_OP_PACKING, INV_Q_DEFECT),
    (INV_OP_READY, INV_Q_GOOD),
    (INV_OP_READY, INV_Q_DEFECT),
]

# Якорь позиций: какие поступления вообще порождают позицию в выдаче остатков.
# Остаток чисто журнальный, поэтому якорят документы с проведённым приходом:
# done (полностью принято) и partially_received (часть уже лежит в storage).
_ANCHOR_STATUSES = (RECEIPT_STATUS_PARTIALLY_RECEIVED, RECEIPT_STATUS_DONE)
_ANCHOR_STATUS_SQL = ", ".join(f"'{s}'" for s in _ANCHOR_STATUSES)
_SINKS_SQL = ", ".join(f"'{s}'" for s in INV_OP_SINKS)

# Защита от бесконечной выдачи в разрезе мест; усечение отдаётся флагом truncated.
ZONE_ROWS_LIMIT = 2000


def _bucket_col(op: str, quality: str) -> str:
    return f"{op}_{quality}"


def _total_expr() -> str:
    return " + ".join(_bucket_col(op, q) for op, q in _BUCKETS)


def _defect_expr() -> str:
    return " + ".join(_bucket_col(op, q) for op, q in _BUCKETS if q == INV_Q_DEFECT)


def _position_agg_query(client_id: str | None, search: str | None) -> tuple[str, list]:
    """SQL позиционного агрегата остатков: одна строка на позицию
    (product, client, color, size) с корзинами op×quality.

    Якорь позиций журнально-инклюзивный: позиция появляется и из строк поступлений
    (как раньше), и напрямую из журнала (приход без документа — историческое
    заведение остатков). Количества — чистый replay журнала.
    """
    pos_conds: list[str] = []
    line_params: list = []
    if client_id:
        pos_conds.append("u.client_id = ?")
        line_params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        pos_conds.append("(u.product_name LIKE ? OR u.product_sku LIKE ?)")
        line_params += [s, s]
    pos_where = ("WHERE " + " AND ".join(pos_conds)) if pos_conds else ""

    net_cols = ",\n                   ".join(
        f"SUM(CASE WHEN to_op='{op}' AND to_quality='{q}' THEN qty ELSE 0 END)"
        f" - SUM(CASE WHEN from_op='{op}' AND from_quality='{q}' THEN qty ELSE 0 END)"
        f" AS net_{_bucket_col(op, q)}"
        for op, q in _BUCKETS
    )
    bucket_selects = ",\n            ".join(
        f"GREATEST(0, COALESCE(c.net_{_bucket_col(op, q)}, 0)) AS {_bucket_col(op, q)}"
        for op, q in _BUCKETS
    )

    agg_query = f"""
        WITH receipt_pos AS (
            SELECT l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id,
                   l.product_name, cl.name AS client_name, l.color_name, l.size_name,
                   CASE WHEN d.status = '{RECEIPT_STATUS_DONE}' THEN l.doc_id END AS done_doc
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE l.is_deleted = 0 AND d.is_deleted = 0 AND d.status IN ({_ANCHOR_STATUS_SQL})
        ),
        journal_pos AS (
            SELECT product_id, product_sku, client_id, color_id, size_id,
                   product_name, client_name, color_name, size_name, NULL::text AS done_doc
            FROM zone_relocations
            WHERE to_op NOT IN ({_SINKS_SQL})
        ),
        accepted AS (
            SELECT product_id, product_sku, client_id, color_id, size_id,
                   MAX(product_name) AS product_name, MAX(client_name) AS client_name,
                   MAX(color_name)   AS color_name, MAX(size_name) AS size_name,
                   COUNT(DISTINCT done_doc) AS docs_count
            FROM (SELECT * FROM receipt_pos UNION ALL SELECT * FROM journal_pos) u
            {pos_where}
            GROUP BY product_id, product_sku, client_id, color_id, size_id
        ),
        conv AS (
            SELECT product_id, client_id, color_id, size_id,
                   {net_cols}
            FROM zone_relocations
            GROUP BY product_id, client_id, color_id, size_id
        )
        SELECT
            a.product_id, a.product_sku, a.client_id, a.color_id, a.size_id,
            a.product_name, a.client_name, a.color_name, a.size_name,
            {bucket_selects},
            a.docs_count
        FROM accepted a
        LEFT JOIN conv c
            ON c.product_id = a.product_id
           AND c.client_id  IS NOT DISTINCT FROM a.client_id
           AND c.color_id   IS NOT DISTINCT FROM a.color_id
           AND c.size_id    IS NOT DISTINCT FROM a.size_id
    """
    return agg_query, line_params


def get_balances(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    search: str | None,
    only_positive: bool,
    has_defect: bool,
) -> BalanceListResponse:
    agg_query, line_params = _position_agg_query(client_id, search)
    total_expr = _total_expr()

    where_parts = []
    if only_positive:
        where_parts.append(f"({total_expr}) > 0")
    if has_defect:
        where_parts.append(f"({_defect_expr()}) > 0")
    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT *, COUNT(*) OVER() AS _total_count
        FROM ({agg_query}) a
        {where_clause}
        ORDER BY ({total_expr}) DESC, product_name, color_name, size_name
        LIMIT ? OFFSET ?
        """,
        line_params + [limit, offset],
    ).fetchall()

    total = int(rows[0]["_total_count"]) if rows else 0

    items = []
    for row in rows:
        buckets = {_bucket_col(op, q): int(row[_bucket_col(op, q)] or 0) for op, q in _BUCKETS}
        items.append(
            BalanceItem(
                product_id=str(row["product_id"]),
                product_name=str(row["product_name"]),
                product_sku=str(row["product_sku"]),
                client_id=row["client_id"],
                client_name=row["client_name"],
                color_id=row["color_id"],
                color_name=row["color_name"],
                size_id=row["size_id"],
                size_name=row["size_name"],
                **buckets,
                total=sum(buckets.values()),
                docs_count=int(row["docs_count"] or 0),
            )
        )

    return BalanceListResponse(items=items, total=total, page=page, limit=limit)


def get_balances_summary(
    connection,
    *,
    client_id: str | None,
    search: str | None,
    has_defect: bool,
) -> BalanceSummaryResponse:
    """Итоги корзин по всем позициям под теми же фильтрами, что и список.

    Считаются на сервере целиком, поэтому не зависят от пагинации списка
    и от усечения выдачи по местам."""
    agg_query, line_params = _position_agg_query(client_id, search)
    where_clause = f"WHERE ({_defect_expr()}) > 0" if has_defect else ""

    cols = [_bucket_col(op, q) for op, q in _BUCKETS]
    sum_cols = ", ".join(f"COALESCE(SUM({c}), 0) AS {c}" for c in cols)
    row = connection.execute(
        f"SELECT {sum_cols} FROM ({agg_query}) a {where_clause}",
        line_params,
    ).fetchone()

    totals = {c: int(row[c] or 0) for c in cols} if row else dict.fromkeys(cols, 0)
    return BalanceSummaryResponse(**totals, total=sum(totals.values()))


def get_balances_by_zone(
    connection,
    *,
    client_id: str | None,
    search: str | None,
    only_positive: bool,
) -> BalanceZonesResponse:
    """Остатки в разрезе местоположения, длинный формат: одна строка на
    (местоположение, позиция, операционный статус, качество).

    Баланс корзины в месте = приход в корзину@место − уход из корзины@место
    (чисто журнальный: незавершённая приёмка в остатки не попадает).
    """
    pos_conds: list[str] = []
    line_params: list = []
    if client_id:
        pos_conds.append("u.client_id = ?")
        line_params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        pos_conds.append("(u.product_name LIKE ? OR u.product_sku LIKE ?)")
        line_params += [s, s]
    pos_where = ("WHERE " + " AND ".join(pos_conds)) if pos_conds else ""

    pos_join = (
        "pm.product_id = x.product_id "
        "AND pm.client_id IS NOT DISTINCT FROM x.client_id "
        "AND pm.color_id  IS NOT DISTINCT FROM x.color_id "
        "AND pm.size_id   IS NOT DISTINCT FROM x.size_id"
    )

    def _term_join(alias: str) -> str:
        return (
            f"{alias}.product_id = x.product_id "
            f"AND {alias}.client_id IS NOT DISTINCT FROM x.client_id "
            f"AND {alias}.color_id  IS NOT DISTINCT FROM x.color_id "
            f"AND {alias}.size_id   IS NOT DISTINCT FROM x.size_id "
            f"AND {alias}.loc_id    IS NOT DISTINCT FROM x.loc_id"
        )

    agg_query = f"""
        WITH position_meta AS (
            SELECT product_id, client_id, color_id, size_id,
                   MAX(product_sku)  AS product_sku,
                   MAX(product_name) AS product_name, MAX(client_name) AS client_name,
                   MAX(color_name)   AS color_name, MAX(size_name) AS size_name
            FROM (
                SELECT l.product_id, d.client_id, l.color_id, l.size_id,
                       l.product_sku, l.product_name, cl.name AS client_name, l.color_name, l.size_name
                FROM receipt_lines l
                JOIN receipt_docs d  ON d.id = l.doc_id
                LEFT JOIN clients cl ON cl.id = d.client_id
                WHERE l.is_deleted = 0 AND d.is_deleted = 0 AND d.status IN ({_ANCHOR_STATUS_SQL})
                UNION ALL
                SELECT product_id, client_id, color_id, size_id,
                       product_sku, product_name, client_name, color_name, size_name
                FROM zone_relocations
                WHERE to_op NOT IN ({_SINKS_SQL})
            ) u
            {pos_where}
            GROUP BY product_id, client_id, color_id, size_id
        ),
        gain AS (
            SELECT product_id, client_id, color_id, size_id,
                   to_zone_id AS loc_id, to_op AS op, to_quality AS quality, SUM(qty) AS qty
            FROM zone_relocations
            WHERE to_op NOT IN ({_SINKS_SQL})
            GROUP BY product_id, client_id, color_id, size_id, to_zone_id, to_op, to_quality
        ),
        lose AS (
            SELECT product_id, client_id, color_id, size_id,
                   from_zone_id AS loc_id, from_op AS op, from_quality AS quality, SUM(qty) AS qty
            FROM zone_relocations
            GROUP BY product_id, client_id, color_id, size_id, from_zone_id, from_op, from_quality
        ),
        locs AS (
            SELECT product_id, client_id, color_id, size_id, loc_id, op, quality FROM gain
            UNION
            SELECT product_id, client_id, color_id, size_id, loc_id, op, quality FROM lose
        )
        SELECT x.loc_id AS location_id, x.op AS op_status, x.quality,
               pm.product_id, pm.product_sku, pm.client_id, pm.color_id, pm.size_id,
               pm.product_name, pm.client_name, pm.color_name, pm.size_name,
               GREATEST(0, COALESCE(gi.qty, 0) - COALESCE(lo.qty, 0)) AS qty
        FROM locs x
        JOIN position_meta pm ON {pos_join}
        LEFT JOIN gain gi ON {_term_join('gi')} AND gi.op = x.op AND gi.quality = x.quality
        LEFT JOIN lose lo ON {_term_join('lo')} AND lo.op = x.op AND lo.quality = x.quality
    """

    rows = connection.execute(
        f"""
        SELECT *
        FROM (
            SELECT
                a.*,
                COALESCE(uz.name, NULL) AS actual_location_name
            FROM ({agg_query}) a
            LEFT JOIN unloading_zones uz ON uz.id = a.location_id
        ) b
        WHERE b.qty > 0
        ORDER BY
            b.actual_location_name IS NULL,
            b.actual_location_name,
            b.qty DESC,
            b.op_status,
            b.quality,
            b.product_name,
            b.color_name,
            b.size_name
        LIMIT {ZONE_ROWS_LIMIT + 1}
        """,
        line_params,
    ).fetchall()

    truncated = len(rows) > ZONE_ROWS_LIMIT
    rows = rows[:ZONE_ROWS_LIMIT]

    items = [
        BalanceZoneItem(
            location_id=row["location_id"],
            location_name=row["actual_location_name"],
            op_status=str(row["op_status"]),
            quality=str(row["quality"]),
            product_id=str(row["product_id"]),
            product_name=str(row["product_name"]),
            product_sku=str(row["product_sku"]),
            client_id=row["client_id"],
            client_name=row["client_name"],
            color_id=row["color_id"],
            color_name=row["color_name"],
            size_id=row["size_id"],
            size_name=row["size_name"],
            qty=int(row["qty"] or 0),
        )
        for row in rows
    ]
    return BalanceZonesResponse(items=items, truncated=truncated)


def _eq_or_null(col: str, val) -> tuple[str, list]:
    return (f"{col} = ?", [val]) if val is not None else (f"{col} IS NULL", [])


def get_packing_zone(connection) -> tuple[str, str]:
    """(id, name) выделенной «Зоны упаковки». 400, если не настроена."""
    row = connection.execute(
        "SELECT id, name FROM unloading_zones "
        "WHERE is_packing_zone = 1 AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at LIMIT 1"
    ).fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Не настроена «Зона упаковки» (отметьте зону в справочнике)")
    return str(row["id"]), str(row["name"])


def get_shipping_zone(connection) -> tuple[str, str]:
    """(id, name) выделенной «Зоны отгрузки». 400, если не настроена."""
    row = connection.execute(
        "SELECT id, name FROM unloading_zones "
        "WHERE is_shipping_zone = 1 AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at LIMIT 1"
    ).fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Не настроена «Зона отгрузки» (отметьте зону в справочнике)")
    return str(row["id"]), str(row["name"])


def insert_inventory_move(
    connection,
    *,
    product_id: str, product_name: str | None, product_sku: str | None,
    color_id: str | None, color_name: str | None,
    size_id: str | None, size_name: str | None,
    client_id: str | None, client_name: str | None,
    from_op: str, to_op: str,
    from_quality: str, to_quality: str,
    from_zone_id: str | None, from_zone_name: str | None,
    to_zone_id: str | None, to_zone_name: str | None,
    qty: int, user_id: str | None,
    shipment_line_id: str | None = None, comment: str | None = None,
    packed_date: str | None = None, pack_entry_id: str | None = None,
    reverses_id: str | None = None, receipt_line_id: str | None = None,
    reason: str | None = None, trip_id: str | None = None,
) -> None:
    """Append-only запись в единый журнал движений. Без commit — коммитит вызывающий.

    Покрывает приход приёмки (intake→storage), перемещение (оси не меняются),
    передачу на упаковку (storage→packing), QC-упаковку (packing→ready /
    packing,good→packing,defect), раскладку к рейсу, смену качества, списание
    при отправке рейса (…→shipped) и ручное списание (…→written_off).
    packed_date/pack_entry_id/reverses_id заполняются только для QC-упаковки;
    receipt_line_id — только для прихода приёмки; reason — только для списания.
    """
    from datetime import UTC, datetime
    from uuid import uuid4

    connection.execute(
        """INSERT INTO zone_relocations
           (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
            client_id,client_name,from_op,to_op,from_quality,to_quality,
            from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by,shipment_line_id,
            packed_date,pack_entry_id,reverses_id,receipt_line_id,reason,trip_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
         client_id, client_name, from_op, to_op, from_quality, to_quality,
         from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment,
         datetime.now(UTC).isoformat(), user_id, shipment_line_id,
         packed_date, pack_entry_id, reverses_id, receipt_line_id, reason, trip_id),
    )


def net_storage_good_in_zone(
    connection, *, product_id: str, client_id: str | None,
    color_id: str | None, size_id: str | None, zone_id: str | None,
) -> int:
    """Текущий остаток «На хранении / Годный» позиции в конкретной зоне (чистый net журнала).

    Нужен гейтом для корректировки приёмки в меньшую сторону: уменьшать принятое
    можно не ниже того, что физически ещё лежит в зоне — остальное уже отгружено
    или перемещено (и его нельзя «вернуть» в intake без реверса downstream).
    """
    row = connection.execute(
        """SELECT COALESCE(
                 SUM(CASE WHEN to_op = ? AND to_quality = ? AND to_zone_id IS NOT DISTINCT FROM ? THEN qty ELSE 0 END)
               - SUM(CASE WHEN from_op = ? AND from_quality = ? AND from_zone_id IS NOT DISTINCT FROM ? THEN qty ELSE 0 END),
               0) AS net
           FROM zone_relocations
           WHERE product_id = ?
             AND client_id IS NOT DISTINCT FROM ?
             AND color_id  IS NOT DISTINCT FROM ?
             AND size_id   IS NOT DISTINCT FROM ?""",
        (INV_OP_STORAGE, INV_Q_GOOD, zone_id, INV_OP_STORAGE, INV_Q_GOOD, zone_id,
         product_id, client_id, color_id, size_id),
    ).fetchone()
    return int(row["net"]) if row and row["net"] is not None else 0


def get_available_in_zone(
    connection,
    *,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
    zone_id: str | None,
    op: str,
    quality: str,
) -> int:
    """Доступное количество корзины (op, quality) в конкретном месте.

    Баланс = движения в корзину@место − движения из корзины@место
    (чистый журнал: приход приёмки — это intake-движение в storage@место).
    """
    def _move_sum(side: str) -> int:
        op_col, q_col, zone_col = (
            ("to_op", "to_quality", "to_zone_id") if side == "to" else ("from_op", "from_quality", "from_zone_id")
        )
        conds: list[str] = [f"{op_col} = ?", f"{q_col} = ?"]
        params: list = [op, quality]
        for col, val in (
            ("product_id", product_id),
            ("color_id", color_id),
            ("size_id", size_id),
            ("client_id", client_id),
            (zone_col, zone_id),
        ):
            cond, p = _eq_or_null(col, val)
            conds.append(cond)
            params += p
        row = connection.execute(
            f"SELECT COALESCE(SUM(qty), 0) AS s FROM zone_relocations WHERE {' AND '.join(conds)}",
            params,
        ).fetchone()
        return int(row["s"]) if row else 0

    return max(0, _move_sum("to") - _move_sum("from"))


def get_available_total(
    connection,
    *,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
    op: str,
    quality: str,
) -> int:
    """Суммарный остаток корзины (op, quality) по всем местам по журналу.

    После миграции 0046 журнал покрывает и приход приёмки (intake → storage),
    поэтому расчёт корректен для всех корзин, включая storage/good.
    """
    def _move_sum(side: str) -> int:
        op_col, q_col = ("to_op", "to_quality") if side == "to" else ("from_op", "from_quality")
        conds: list[str] = [f"{op_col} = ?", f"{q_col} = ?"]
        params: list = [op, quality]
        for col, val in (
            ("product_id", product_id),
            ("color_id", color_id),
            ("size_id", size_id),
            ("client_id", client_id),
        ):
            cond, p = _eq_or_null(col, val)
            conds.append(cond)
            params += p
        row = connection.execute(
            f"SELECT COALESCE(SUM(qty), 0) AS s FROM zone_relocations WHERE {' AND '.join(conds)}",
            params,
        ).fetchone()
        return int(row["s"]) if row else 0

    return max(0, _move_sum("to") - _move_sum("from"))


def create_zone_relocation(connection, payload, user_id: str) -> None:
    """Перемещение товара между местами (оси статуса не меняются).

    Перемещать можно только товар «На хранении» — упаковка и «Готов к отгрузке»
    двигаются своими процессами в отгрузке.
    """
    from fastapi import HTTPException

    if payload.quality not in (INV_Q_GOOD, INV_Q_DEFECT):
        raise HTTPException(status_code=400, detail="Перемещать можно только годный товар или брак")

    from_id = (payload.from_zone_id or "").strip() or None
    to_id = (payload.to_zone_id or "").strip() or None
    if not from_id:
        raise HTTPException(status_code=400, detail="Укажите место, откуда перемещаете товар")
    if from_id == to_id:
        raise HTTPException(status_code=400, detail="Выберите другое место назначения")

    available = get_available_in_zone(
        connection,
        product_id=payload.product_id,
        color_id=payload.color_id,
        size_id=payload.size_id,
        client_id=payload.client_id,
        zone_id=from_id,
        op=INV_OP_STORAGE,
        quality=payload.quality,
    )
    if available < payload.qty:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара в месте для перемещения (доступно {available}, нужно {payload.qty})",
        )

    insert_inventory_move(
        connection,
        product_id=payload.product_id, product_name=payload.product_name, product_sku=payload.product_sku,
        color_id=payload.color_id, color_name=payload.color_name,
        size_id=payload.size_id, size_name=payload.size_name,
        client_id=payload.client_id, client_name=payload.client_name,
        from_op=INV_OP_STORAGE, to_op=INV_OP_STORAGE,
        from_quality=payload.quality, to_quality=payload.quality,
        from_zone_id=from_id, from_zone_name=_zone_name(connection, from_id),
        to_zone_id=to_id, to_zone_name=_zone_name(connection, to_id),
        qty=payload.qty, user_id=user_id,
        comment=(payload.comment or "").strip() or None,
    )
    connection.commit()


def create_quality_change(connection, payload, user_id: str) -> None:
    """Смена качества товара на хранении (Брак ↔ Годный) в пределах одного места.

    Используется для исправления брака после доработки/перепроверки. Журналируется
    как движение (storage, from_quality) → (storage, to_quality) с тем же местом.
    """
    from fastapi import HTTPException

    if payload.from_quality == payload.to_quality:
        raise HTTPException(status_code=400, detail="Выберите другое качество")

    zone_id = (payload.zone_id or "").strip() or None
    if not zone_id:
        raise HTTPException(status_code=400, detail="Укажите место, где меняется качество товара")

    available = get_available_in_zone(
        connection,
        product_id=payload.product_id,
        color_id=payload.color_id,
        size_id=payload.size_id,
        client_id=payload.client_id,
        zone_id=zone_id,
        op=INV_OP_STORAGE,
        quality=payload.from_quality,
    )
    if available < payload.qty:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара в месте для смены качества (доступно {available}, нужно {payload.qty})",
        )

    zone_name = _zone_name(connection, zone_id)
    label = f"{INV_QUALITY_LABELS[payload.from_quality]} → {INV_QUALITY_LABELS[payload.to_quality]}"
    comment = (payload.comment or "").strip()
    insert_inventory_move(
        connection,
        product_id=payload.product_id, product_name=payload.product_name, product_sku=payload.product_sku,
        color_id=payload.color_id, color_name=payload.color_name,
        size_id=payload.size_id, size_name=payload.size_name,
        client_id=payload.client_id, client_name=payload.client_name,
        from_op=INV_OP_STORAGE, to_op=INV_OP_STORAGE,
        from_quality=payload.from_quality, to_quality=payload.to_quality,
        from_zone_id=zone_id, from_zone_name=zone_name,
        to_zone_id=zone_id, to_zone_name=zone_name,
        qty=payload.qty, user_id=user_id,
        comment=f"Смена качества: {label}" + (f". {comment}" if comment else ""),
    )
    connection.commit()


def create_write_off(connection, payload, user_id: str) -> None:
    """Ручное списание остатков: (storage, quality)@место → (written_off, quality).

    Терминальный сток — товар уходит с остатков насовсем. Списывать можно только
    товар «На хранении»: упаковка и «Готов к отгрузке» управляются процессом
    отгрузки. Причина обязательна, для «Прочее» обязателен комментарий.
    """
    from fastapi import HTTPException

    zone_id = (payload.zone_id or "").strip() or None
    if not zone_id:
        raise HTTPException(status_code=400, detail="Укажите место, из которого списывается товар")

    comment = (payload.comment or "").strip()
    if payload.reason == WRITEOFF_REASON_OTHER and not comment:
        raise HTTPException(status_code=400, detail="Для причины «Прочее» укажите комментарий")

    available = get_available_in_zone(
        connection,
        product_id=payload.product_id,
        color_id=payload.color_id,
        size_id=payload.size_id,
        client_id=payload.client_id,
        zone_id=zone_id,
        op=INV_OP_STORAGE,
        quality=payload.quality,
    )
    if available < payload.qty:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара в месте для списания (доступно {available}, нужно {payload.qty})",
        )

    insert_inventory_move(
        connection,
        product_id=payload.product_id, product_name=payload.product_name, product_sku=payload.product_sku,
        color_id=payload.color_id, color_name=payload.color_name,
        size_id=payload.size_id, size_name=payload.size_name,
        client_id=payload.client_id, client_name=payload.client_name,
        from_op=INV_OP_STORAGE, to_op=INV_OP_WRITTEN_OFF,
        from_quality=payload.quality, to_quality=payload.quality,
        from_zone_id=zone_id, from_zone_name=_zone_name(connection, zone_id),
        to_zone_id=None, to_zone_name=None,
        qty=payload.qty, user_id=user_id,
        reason=payload.reason,
        comment=comment or None,
    )
    connection.commit()


def create_stock_entry(connection, payload, user_id: str) -> int:
    """Историческое заведение остатков — то, что лежало на складе до системы.

    Без документа поступления и без маршрута: на каждую строку пишем движение
    intake→storage@место (зеркало приходу приёмки). Позиция появляется в остатках
    за счёт журнально-инклюзивного якоря (см. _position_agg_query / get_balances_by_zone).
    Привязка к клиенту обязательна — остатки считаются по клиенту.
    """
    from fastapi import HTTPException

    client_id = (payload.client_id or "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="Укажите клиента")
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Добавьте хотя бы одну строку")

    client_row = connection.execute(
        "SELECT name FROM clients WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (client_id,)
    ).fetchone()
    if not client_row:
        raise HTTPException(status_code=400, detail="Клиент не найден")
    client_name = str(client_row["name"])
    suffix = (payload.comment or "").strip()

    for ln in payload.lines:
        zone_id = (ln.zone_id or "").strip() or None
        if not zone_id:
            raise HTTPException(status_code=400, detail="Укажите место хранения по каждой строке")
        if ln.quality not in (INV_Q_GOOD, INV_Q_DEFECT):
            raise HTTPException(status_code=400, detail="Недопустимое качество товара")
        zone_name = _zone_name(connection, zone_id)
        insert_inventory_move(
            connection,
            product_id=ln.product_id, product_name=ln.product_name, product_sku=ln.product_sku,
            color_id=ln.color_id, color_name=ln.color_name,
            size_id=ln.size_id, size_name=ln.size_name,
            client_id=client_id, client_name=client_name,
            from_op=INV_OP_INTAKE, to_op=INV_OP_STORAGE,
            from_quality=ln.quality, to_quality=ln.quality,
            from_zone_id=zone_id, from_zone_name=zone_name,
            to_zone_id=zone_id, to_zone_name=zone_name,
            qty=ln.qty, user_id=user_id,
            comment=f"Заведение остатка: {ln.qty} шт." + (f". {suffix}" if suffix else ""),
        )
    connection.commit()
    return len(payload.lines)


def _zone_name(connection, zone_id: str | None) -> str | None:
    if not zone_id:
        return None
    row = connection.execute("SELECT name FROM unloading_zones WHERE id = ?", (zone_id,)).fetchone()
    return str(row["name"]) if row else None


def list_zone_relocations(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    search: str | None,
) -> "ZoneRelocationListResponse":
    from modules.balances.schemas import ZoneRelocationItem, ZoneRelocationListResponse

    conds: list[str] = []
    params: list = []
    if client_id:
        conds.append("r.client_id = ?")
        params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        conds.append("(r.product_name LIKE ? OR r.product_sku LIKE ?)")
        params += [s, s]
    where = ("WHERE " + " AND ".join(conds)) if conds else ""

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT r.*, u.email AS created_by_email, COUNT(*) OVER() AS _total
        FROM zone_relocations r
        LEFT JOIN users u ON u.id = r.created_by
        {where}
        ORDER BY r.created_at DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    total = int(rows[0]["_total"]) if rows else 0
    items = [
        ZoneRelocationItem(
            id=str(row["id"]),
            created_at=str(row["created_at"]),
            created_by_email=row["created_by_email"],
            from_op=str(row["from_op"] or INV_OP_STORAGE),
            to_op=str(row["to_op"] or INV_OP_STORAGE),
            from_quality=str(row["from_quality"] or INV_Q_GOOD),
            to_quality=str(row["to_quality"] or INV_Q_GOOD),
            product_name=row["product_name"],
            product_sku=row["product_sku"],
            color_name=row["color_name"],
            size_name=row["size_name"],
            client_name=row["client_name"],
            from_zone_name=row["from_zone_name"],
            to_zone_name=row["to_zone_name"],
            qty=int(row["qty"] or 0),
            reason=row["reason"],
            comment=row["comment"],
        )
        for row in rows
    ]
    return ZoneRelocationListResponse(items=items, total=total, page=page, limit=limit)
