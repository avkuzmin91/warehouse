from __future__ import annotations

from config import (
    INV_OP_INTAKE,
    INV_OP_PACKING,
    INV_OP_READY,
    INV_OP_SHIPPED,
    INV_OP_STORAGE,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    INV_QUALITY_LABELS,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_ON_REVIEW,
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
# списание при отправке рейса — движение (… → shipped). intake и shipped не являются
# корзинами: intake — только источник, shipped — только сток.
# Инвариант: остаток меняется ⇔ есть запись в журнале.
#
# Виртуальная корзина intake в выдаче — accepted_qty поступлений в статусах
# on_intake / on_review (товар на складе, но операции недоступны до завершения
# приёмки). Считается из receipt_lines; при завершении документ уходит из этих
# статусов, и тот же объём приходит в storage уже журнальным intake-движением.

_BUCKETS: list[tuple[str, str]] = [
    (INV_OP_STORAGE, INV_Q_GOOD),
    (INV_OP_STORAGE, INV_Q_DEFECT),
    (INV_OP_PACKING, INV_Q_GOOD),
    (INV_OP_PACKING, INV_Q_DEFECT),
    (INV_OP_READY, INV_Q_GOOD),
    (INV_OP_READY, INV_Q_DEFECT),
]

_INTAKE_STATUSES = (RECEIPT_STATUS_ON_INTAKE, RECEIPT_STATUS_ON_REVIEW)
_INTAKE_STATUS_SQL = ", ".join(f"'{s}'" for s in _INTAKE_STATUSES)

# Защита от бесконечной выдачи в разрезе мест; усечение отдаётся флагом truncated.
ZONE_ROWS_LIMIT = 2000


def _bucket_col(op: str, quality: str) -> str:
    return f"{op}_{quality}"


def _total_expr() -> str:
    return "intake + " + " + ".join(_bucket_col(op, q) for op, q in _BUCKETS)


def _defect_expr() -> str:
    return " + ".join(_bucket_col(op, q) for op, q in _BUCKETS if q == INV_Q_DEFECT)


def _position_agg_query(client_id: str | None, search: str | None) -> tuple[str, list]:
    """SQL позиционного агрегата остатков: одна строка на позицию
    (product, client, color, size) с корзинами intake + op×quality."""
    line_conds = [
        "l.is_deleted = 0",
        "d.is_deleted = 0",
        f"d.status IN ({_INTAKE_STATUS_SQL}, '{RECEIPT_STATUS_DONE}')",
    ]
    line_params: list = []
    if client_id:
        line_conds.append("d.client_id = ?")
        line_params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        line_conds.append("(l.product_name LIKE ? OR l.product_sku LIKE ?)")
        line_params += [s, s]
    line_where = " AND ".join(line_conds)

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
        WITH accepted AS (
            SELECT
                l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id,
                MAX(l.product_name) AS product_name, MAX(cl.name) AS client_name,
                MAX(l.color_name)   AS color_name, MAX(l.size_name) AS size_name,
                SUM(CASE WHEN d.status IN ({_INTAKE_STATUS_SQL})
                         THEN COALESCE(l.accepted_qty, 0) ELSE 0 END) AS intake,
                COUNT(DISTINCT l.doc_id) FILTER (WHERE d.status = '{RECEIPT_STATUS_DONE}') AS docs_count
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE {line_where}
            GROUP BY l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id
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
            a.intake,
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
        intake = int(row["intake"] or 0)
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
                intake=intake,
                **buckets,
                total=intake + sum(buckets.values()),
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

    cols = ["intake"] + [_bucket_col(op, q) for op, q in _BUCKETS]
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

    Баланс корзины в месте = приход в корзину@место − уход из корзины@место.
    intake/good — accepted-приход незавершённых поступлений (виртуальная корзина
    из receipt_lines); при завершении приёмки её объём переезжает в storage
    журнальным intake-движением, а минус по intake@место гасит витрину до нуля.
    """
    line_conds = ["l.is_deleted = 0", "d.is_deleted = 0"]
    line_params: list = []
    if client_id:
        line_conds.append("d.client_id = ?")
        line_params.append(client_id.strip())
    if search:
        s = like_substring_param(search)
        line_conds.append("(l.product_name LIKE ? OR l.product_sku LIKE ?)")
        line_params += [s, s]

    def _where(status_sql: str) -> str:
        return " AND ".join([*line_conds, status_sql])

    meta_where = _where(f"d.status IN ({_INTAKE_STATUS_SQL}, '{RECEIPT_STATUS_DONE}')")
    intake_where = _where(f"d.status IN ({_INTAKE_STATUS_SQL})")

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
            SELECT
                l.product_id, d.client_id, l.color_id, l.size_id,
                MAX(l.product_sku)  AS product_sku,
                MAX(l.product_name) AS product_name, MAX(cl.name) AS client_name,
                MAX(l.color_name)   AS color_name, MAX(l.size_name) AS size_name
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE {meta_where}
            GROUP BY l.product_id, d.client_id, l.color_id, l.size_id
        ),
        intake_inflow AS (
            SELECT l.product_id, d.client_id, l.color_id, l.size_id,
                   l.storage_zone_id AS loc_id,
                   SUM(COALESCE(l.accepted_qty, 0)) AS qty_in
            FROM receipt_lines l
            JOIN receipt_docs d ON d.id = l.doc_id
            WHERE {intake_where}
            GROUP BY l.product_id, d.client_id, l.color_id, l.size_id, l.storage_zone_id
        ),
        gain AS (
            SELECT product_id, client_id, color_id, size_id,
                   to_zone_id AS loc_id, to_op AS op, to_quality AS quality, SUM(qty) AS qty
            FROM zone_relocations
            WHERE to_op <> '{INV_OP_SHIPPED}'
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
            UNION
            SELECT product_id, client_id, color_id, size_id, loc_id,
                   '{INV_OP_INTAKE}', '{INV_Q_GOOD}'
            FROM intake_inflow
        )
        SELECT x.loc_id AS location_id, x.op AS op_status, x.quality,
               pm.product_id, pm.product_sku, pm.client_id, pm.color_id, pm.size_id,
               pm.product_name, pm.client_name, pm.color_name, pm.size_name,
               GREATEST(0,
                   CASE WHEN x.op = '{INV_OP_INTAKE}' AND x.quality = '{INV_Q_GOOD}'
                        THEN COALESCE(ii.qty_in, 0) ELSE 0 END
                   + COALESCE(gi.qty, 0) - COALESCE(lo.qty, 0)
               ) AS qty
        FROM locs x
        JOIN position_meta pm ON {pos_join}
        LEFT JOIN gain gi ON {_term_join('gi')} AND gi.op = x.op AND gi.quality = x.quality
        LEFT JOIN lose lo ON {_term_join('lo')} AND lo.op = x.op AND lo.quality = x.quality
        LEFT JOIN intake_inflow ii ON {_term_join('ii')}
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
        line_params * 2,
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
) -> None:
    """Append-only запись в единый журнал движений. Без commit — коммитит вызывающий.

    Покрывает приход приёмки (intake→storage), перемещение (оси не меняются),
    передачу на упаковку (storage→packing), QC-упаковку (packing→ready /
    packing,good→packing,defect), раскладку к рейсу, смену качества и списание
    (…→shipped). packed_date/pack_entry_id/reverses_id заполняются только для
    QC-упаковки; receipt_line_id — только для прихода приёмки.
    """
    from datetime import UTC, datetime
    from uuid import uuid4

    connection.execute(
        """INSERT INTO zone_relocations
           (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
            client_id,client_name,from_op,to_op,from_quality,to_quality,
            from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by,shipment_line_id,
            packed_date,pack_entry_id,reverses_id,receipt_line_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
         client_id, client_name, from_op, to_op, from_quality, to_quality,
         from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment,
         datetime.now(UTC).isoformat(), user_id, shipment_line_id,
         packed_date, pack_entry_id, reverses_id, receipt_line_id),
    )


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
            comment=row["comment"],
        )
        for row in rows
    ]
    return ZoneRelocationListResponse(items=items, total=total, page=page, limit=limit)
