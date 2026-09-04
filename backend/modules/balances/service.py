from __future__ import annotations

from collections.abc import Sequence

from config import (
    DISPATCH_CARGO_DEFECT,
    DISPATCH_CARGO_GOOD,
    DISPATCH_CARGO_GOOD_UNPACKED,
    DISPATCH_STATUS_AWAITING_TRIP,
    DISPATCH_STATUS_PARTIALLY_SHIPPED,
    DISPATCH_STATUS_PREPARING,
    INV_OP_BOXED,
    INV_OP_PICKED,
    INV_OP_INTAKE,
    INV_OP_SHIPPED,
    INV_OP_PACKED,
    INV_OP_PACKING,
    INV_OP_READY,
    INV_OP_SINKS,
    INV_OP_STORAGE,
    INV_OP_WRITTEN_OFF,
    INV_OP_LABELS,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    INV_QUALITY_LABELS,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    RECEIPT_STATUS_PLANNED,
    SHIPMENT_CARGO_DEFECT,
    STOCK_EVENT_DEFECT_IN,
    STOCK_EVENT_DEFECT_OUT,
    STOCK_EVENT_INCOMING,
    STOCK_EVENT_RECEIPT,
    STOCK_EVENT_RECEIPT_ADJUST,
    STOCK_EVENT_SHIPMENT,
    STOCK_EVENT_SHIPMENT_RETURN,
    STOCK_EVENT_STOCK_ENTRY,
    STOCK_EVENT_WRITE_OFF,
    STOCK_EVENT_WRITE_OFF_UNDO,
    WRITEOFF_REASON_OTHER,
)
from dbconn import barcode_variant_exists_sql, ci_like_substring_param, like_substring_param
from modules.balances.schemas import (
    BalanceGroupItem,
    BalanceGroupedResponse,
    BalanceItem,
    BalanceListResponse,
    BalanceSummaryResponse,
    BalanceZoneItem,
    BalanceZonesResponse,
    PlannableItem,
    PlannableListResponse,
)

# Поступления, товар которых ещё «в пути»: заявлен (planned). Принятое уже лежит
# в storage (попадает в storage_good), поэтому «в пути» = planned − accepted;
# partially_received/done/cancelled — не в пути.
_IN_TRANSIT_STATUSES = (RECEIPT_STATUS_PLANNED,)
_IN_TRANSIT_STATUS_SQL = ", ".join(f"'{s}'" for s in _IN_TRANSIT_STATUSES)

# Модель остатков на двух осях — чистый replay журнала zone_relocations:
#   операционный статус: storage «На хранении» | packing «На упаковке» |
#                        packed «Упаковано» | ready «Готов к отгрузке» |
#                        shipped «Отгружен» (терминальный)
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
# прихода (intake → storage). Незавершённая приёмка в остатки не попадает — пока
# кладовщик считает, журнальной записи ещё нет.

_BUCKETS: list[tuple[str, str]] = [
    (INV_OP_STORAGE, INV_Q_GOOD),
    (INV_OP_STORAGE, INV_Q_DEFECT),
    (INV_OP_PACKING, INV_Q_GOOD),
    (INV_OP_PACKING, INV_Q_DEFECT),
    (INV_OP_PACKED, INV_Q_GOOD),
    (INV_OP_PACKED, INV_Q_DEFECT),
    # Брака в коробе не бывает: в короб кладут только годный (брак с упаковки
    # уходит на хранение), поэтому корзина boxed — только good.
    (INV_OP_BOXED, INV_Q_GOOD),
    # Собранное под FBS-поставку — только годный: в лист подбора попадает
    # исключительно storage/good.
    (INV_OP_PICKED, INV_Q_GOOD),
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

    Имена в выдаче — живые из справочников (переименование товара/цвета/размера
    видно сразу); снимок из журнала — только фолбэк для удалённых записей.
    """
    pos_conds: list[str] = []
    line_params: list = []
    if client_id:
        pos_conds.append("u.client_id = ?")
        line_params.append(client_id.strip())
    if search:
        s = ci_like_substring_param(search)
        pos_conds.append(
            "(fold_ci(u.product_name) LIKE ? OR fold_ci(u.product_sku) LIKE ?"
            " OR u.product_id IN (SELECT id FROM products WHERE fold_ci(sku) LIKE ? OR fold_ci(name) LIKE ?)"
            " OR u.color_id IN (SELECT id FROM colors WHERE fold_ci(name) LIKE ?)"
            " OR u.size_id IN (SELECT id FROM sizes WHERE fold_ci(name) LIKE ?)"
            f" OR {barcode_variant_exists_sql('u.product_id', 'u.color_id', 'u.size_id')})"
        )
        line_params += [s, s, s, s, s, s, like_substring_param(search)]
    pos_where = ("WHERE " + " AND ".join(pos_conds)) if pos_conds else ""

    # Пушдаун клиента в полный GROUP BY журнала: client_id — ключ группировки и
    # join'а (IS NOT DISTINCT FROM), поэтому фильтр по нему результат не меняет.
    # Поиск (по денормализованным name/sku) в журнал не проталкиваем — имена не ключ.
    conv_where = ""
    if client_id:
        conv_where = "WHERE client_id = ?"
        line_params.append(client_id.strip())

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
            SELECT product_id, client_id, color_id, size_id,
                   MAX(product_sku)  AS product_sku,
                   MAX(product_name) AS product_name, MAX(client_name) AS client_name,
                   MAX(color_name)   AS color_name, MAX(size_name) AS size_name,
                   COUNT(DISTINCT done_doc) AS docs_count
            FROM (SELECT * FROM receipt_pos UNION ALL SELECT * FROM journal_pos) u
            {pos_where}
            GROUP BY product_id, client_id, color_id, size_id
        ),
        conv AS (
            SELECT product_id, client_id, color_id, size_id,
                   {net_cols}
            FROM zone_relocations
            {conv_where}
            GROUP BY product_id, client_id, color_id, size_id
        )
        SELECT
            a.product_id,
            COALESCE(NULLIF(TRIM(prod.sku), ''), a.product_sku) AS product_sku,
            a.client_id, a.color_id, a.size_id,
            COALESCE(NULLIF(TRIM(prod.name), ''), a.product_name) AS product_name,
            COALESCE(lcl.name, a.client_name) AS client_name,
            COALESCE(lco.name, a.color_name)  AS color_name,
            COALESCE(lsz.name, a.size_name)   AS size_name,
            lsz.sort_order AS size_sort_order,
            {bucket_selects},
            a.docs_count
        FROM accepted a
        LEFT JOIN conv c
            ON c.product_id = a.product_id
           AND c.client_id  IS NOT DISTINCT FROM a.client_id
           AND c.color_id   IS NOT DISTINCT FROM a.color_id
           AND c.size_id    IS NOT DISTINCT FROM a.size_id
        LEFT JOIN products prod ON prod.id = a.product_id
        LEFT JOIN clients  lcl  ON lcl.id = a.client_id
        LEFT JOIN colors   lco  ON lco.id = a.color_id
        LEFT JOIN sizes    lsz  ON lsz.id = a.size_id
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
                size_sort_order=row["size_sort_order"],
                **buckets,
                total=sum(buckets.values()),
                docs_count=int(row["docs_count"] or 0),
            )
        )

    return BalanceListResponse(items=items, total=total, page=page, limit=limit)


def _row_to_balance_item(row) -> BalanceItem:
    buckets = {_bucket_col(op, q): int(row[_bucket_col(op, q)] or 0) for op, q in _BUCKETS}
    return BalanceItem(
        product_id=str(row["product_id"]),
        product_name=str(row["product_name"]),
        product_sku=str(row["product_sku"]),
        client_id=row["client_id"],
        client_name=row["client_name"],
        color_id=row["color_id"],
        color_name=row["color_name"],
        size_id=row["size_id"],
        size_name=row["size_name"],
        size_sort_order=row["size_sort_order"],
        **buckets,
        total=sum(buckets.values()),
        docs_count=int(row["docs_count"] or 0),
    )


def get_balances_grouped(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    search: str | None,
    only_positive: bool,
    has_defect: bool,
) -> BalanceGroupedResponse:
    """Остатки, сгруппированные по «артикул × клиент», с пагинацией по группам.

    Страница режется по группам (не по вариантам), чтобы артикул никогда не
    рвался границей страницы, а суммы группы всегда сходились с её вариантами.
    Порядок групп — как в плоском списке (крупный остаток сверху); варианты
    внутри — цвет, затем размер по sort_order справочника (без порядка — по имени
    после упорядоченных)."""
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
        WITH pos AS (
            SELECT * FROM ({agg_query}) a
            {where_clause}
        ),
        grp AS (
            SELECT product_id, client_id,
                   ROW_NUMBER() OVER (
                       ORDER BY SUM({total_expr}) DESC, MAX(product_name), product_id
                   ) AS _rn,
                   COUNT(*) OVER () AS _groups_total
            FROM pos
            GROUP BY product_id, client_id
        ),
        pg AS (
            SELECT * FROM grp WHERE _rn > ? AND _rn <= ?
        )
        SELECT p.*, pg._rn, pg._groups_total
        FROM pos p
        JOIN pg ON pg.product_id = p.product_id
               AND pg.client_id IS NOT DISTINCT FROM p.client_id
        ORDER BY pg._rn,
                 p.color_name NULLS FIRST,
                 p.size_sort_order IS NULL, p.size_sort_order,
                 p.size_name NULLS FIRST
        """,
        line_params + [offset, offset + limit],
    ).fetchall()

    total_groups = int(rows[0]["_groups_total"]) if rows else 0

    groups: list[BalanceGroupItem] = []
    current_key: tuple[str, str | None] | None = None
    for row in rows:
        key = (str(row["product_id"]), row["client_id"])
        item = _row_to_balance_item(row)
        if key != current_key:
            current_key = key
            groups.append(
                BalanceGroupItem(
                    product_id=item.product_id,
                    product_name=item.product_name,
                    product_sku=item.product_sku,
                    client_id=item.client_id,
                    client_name=item.client_name,
                    **{_bucket_col(op, q): 0 for op, q in _BUCKETS},
                    total=0,
                    variants_count=0,
                    colors_count=0,
                    sizes_count=0,
                    items=[],
                )
            )
        group = groups[-1]
        group.items.append(item)
        for op, q in _BUCKETS:
            col = _bucket_col(op, q)
            setattr(group, col, getattr(group, col) + getattr(item, col))
        group.total += item.total

    for group in groups:
        group.variants_count = len(group.items)
        group.colors_count = len({i.color_id for i in group.items if i.color_id})
        group.sizes_count = len({i.size_id for i in group.items if i.size_id})

    return BalanceGroupedResponse(items=groups, total=total_groups, page=page, limit=limit)


def get_plannable_items(
    connection,
    *,
    client_id: str | None,
    search: str | None,
    cargo_type: str | None,
    limit: int,
) -> PlannableListResponse:
    """Позиции, доступные для планирования отгрузки: остаток на складе + товар в пути.

    Объединяет журнальный остаток `storage` (good/defect) с заявленным, но ещё не
    приехавшим товаром (`planned − accepted` по поступлениям planned).
    Видимость: для годного груза — есть годный остаток в любой корзине (включая `packing`:
    отгрузка такой позиции паркуется в «Ожидание упаковки» и продолжается по готовности)
    ИЛИ что-то в пути; для брака — есть остаток брака на хранении (брак в пути не считаем —
    он рождается на складе).
    """
    is_defect = cargo_type == SHIPMENT_CARGO_DEFECT

    # Пушдаун клиента в полный GROUP BY журнала: client_id — ключ группировки,
    # внешний фильтр p.client_id = ? отбросил бы остальные группы всё равно.
    stock_where = ""
    stock_params: list = []
    if client_id:
        stock_where = "WHERE client_id = ?"
        stock_params.append(client_id.strip())

    query = f"""
        WITH stock AS (
            SELECT product_id, client_id, color_id, size_id,
                   MAX(product_name) AS product_name, MAX(product_sku) AS product_sku,
                   MAX(color_name) AS color_name, MAX(size_name) AS size_name,
                   MAX(client_name) AS client_name,
                   GREATEST(0, SUM(CASE WHEN to_op='{INV_OP_STORAGE}' AND to_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END)
                             - SUM(CASE WHEN from_op='{INV_OP_STORAGE}' AND from_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END)) AS storage_good,
                   GREATEST(0, SUM(CASE WHEN to_op='{INV_OP_STORAGE}' AND to_quality='{INV_Q_DEFECT}' THEN qty ELSE 0 END)
                             - SUM(CASE WHEN from_op='{INV_OP_STORAGE}' AND from_quality='{INV_Q_DEFECT}' THEN qty ELSE 0 END)) AS storage_defect,
                   GREATEST(0, SUM(CASE WHEN to_op='{INV_OP_READY}' AND to_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END)
                             - SUM(CASE WHEN from_op='{INV_OP_READY}' AND from_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END)) AS ready_good,
                   GREATEST(0, SUM(CASE WHEN to_op='{INV_OP_READY}' AND to_quality='{INV_Q_DEFECT}' THEN qty ELSE 0 END)
                             - SUM(CASE WHEN from_op='{INV_OP_READY}' AND from_quality='{INV_Q_DEFECT}' THEN qty ELSE 0 END)) AS ready_defect,
                   GREATEST(0, SUM(CASE WHEN to_op='{INV_OP_PACKED}' AND to_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END)
                             - SUM(CASE WHEN from_op='{INV_OP_PACKED}' AND from_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END)) AS packed_good,
                   GREATEST(0, SUM(CASE WHEN to_op='{INV_OP_PACKING}' AND to_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END)
                             - SUM(CASE WHEN from_op='{INV_OP_PACKING}' AND from_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END)) AS packing_good
            FROM zone_relocations
            {stock_where}
            GROUP BY product_id, client_id, color_id, size_id
        ),
        incoming AS (
            SELECT l.product_id, d.client_id, l.color_id, l.size_id,
                   MAX(l.product_name) AS product_name, MAX(l.product_sku) AS product_sku,
                   MAX(l.color_name) AS color_name, MAX(l.size_name) AS size_name,
                   MAX(cl.name) AS client_name,
                   SUM(GREATEST(COALESCE(l.planned_qty, 0) - COALESCE(l.accepted_qty, 0), 0)) AS in_transit
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE l.is_deleted = 0 AND d.is_deleted = 0 AND d.status IN ({_IN_TRANSIT_STATUS_SQL})
            GROUP BY l.product_id, d.client_id, l.color_id, l.size_id
        ),
        keys AS (
            SELECT product_id, client_id, color_id, size_id FROM stock
            UNION
            SELECT product_id, client_id, color_id, size_id FROM incoming
        )
        SELECT k.product_id, k.client_id AS client_id, k.color_id, k.size_id,
               COALESCE(s.product_name, i.product_name) AS product_name,
               COALESCE(s.product_sku,  i.product_sku)  AS product_sku,
               COALESCE(s.color_name,   i.color_name)   AS color_name,
               COALESCE(s.size_name,    i.size_name)    AS size_name,
               COALESCE(s.client_name,  i.client_name)  AS client_name,
               COALESCE(s.storage_good, 0)   AS storage_good,
               COALESCE(s.storage_defect, 0) AS storage_defect,
               COALESCE(s.ready_good, 0)     AS ready_good,
               COALESCE(s.ready_defect, 0)   AS ready_defect,
               COALESCE(s.packed_good, 0)    AS packed_good,
               COALESCE(s.packing_good, 0)   AS packing_good,
               COALESCE(i.in_transit, 0)     AS in_transit
        FROM keys k
        LEFT JOIN stock s
            ON s.product_id = k.product_id
           AND s.client_id IS NOT DISTINCT FROM k.client_id
           AND s.color_id  IS NOT DISTINCT FROM k.color_id
           AND s.size_id   IS NOT DISTINCT FROM k.size_id
        LEFT JOIN incoming i
            ON i.product_id = k.product_id
           AND i.client_id IS NOT DISTINCT FROM k.client_id
           AND i.color_id  IS NOT DISTINCT FROM k.color_id
           AND i.size_id   IS NOT DISTINCT FROM k.size_id
    """

    conds: list[str] = []
    params: list = []
    if client_id:
        conds.append("p.client_id = ?")
        params.append(client_id.strip())
    if search:
        s = ci_like_substring_param(search)
        conds.append(
            "(fold_ci(p.product_name) LIKE ? OR fold_ci(p.product_sku) LIKE ? OR fold_ci(prod.sku) LIKE ? OR fold_ci(prod.name) LIKE ?"
            f" OR {barcode_variant_exists_sql('p.product_id', 'p.color_id', 'p.size_id')})"
        )
        params += [s, s, s, s, like_substring_param(search)]
    if is_defect:
        conds.append("(p.storage_defect > 0 OR p.ready_defect > 0)")
    elif cargo_type == DISPATCH_CARGO_GOOD_UNPACKED:
        # Отгрузка без упаковки берёт только годный «На хранении» — остальные корзины
        # и товар в пути для неё не источник.
        conds.append("p.storage_good > 0")
    else:
        conds.append(
            "(p.storage_good > 0 OR p.ready_good > 0 OR p.packed_good > 0 "
            "OR p.packing_good > 0 OR p.in_transit > 0)"
        )
    where = "WHERE " + " AND ".join(conds)

    rows = connection.execute(
        f"""
        SELECT p.*, COALESCE(prod.sku_pending, 0) AS sku_pending,
               prod.items_per_box AS items_per_box,
               prod.boxes_per_pallet AS boxes_per_pallet,
               COALESCE(NULLIF(TRIM(prod.sku), ''), p.product_sku) AS live_sku,
               COALESCE(NULLIF(TRIM(prod.name), ''), p.product_name) AS live_name,
               COALESCE(lcl.name, p.client_name) AS live_client_name,
               COALESCE(lco.name, p.color_name)  AS live_color_name,
               COALESCE(lsz.name, p.size_name)   AS live_size_name
        FROM ({query}) p
        LEFT JOIN products prod ON prod.id = p.product_id
        LEFT JOIN clients  lcl  ON lcl.id = p.client_id
        LEFT JOIN colors   lco  ON lco.id = p.color_id
        LEFT JOIN sizes    lsz  ON lsz.id = p.size_id
        {where}
        ORDER BY live_name, live_color_name, live_size_name
        LIMIT ?
        """,
        stock_params + params + [limit],
    ).fetchall()

    def _vkey(pid, color, size) -> tuple:
        return (str(pid), str(color) if color else None, str(size) if size else None)

    barcodes_by_variant: dict[tuple, list[str]] = {}
    pids = sorted({str(r["product_id"]) for r in rows})
    if pids:
        ph = ",".join("?" for _ in pids)
        code_rows = connection.execute(
            f"""
            SELECT pb.product_id, pb.barcode, pv.color_id, pv.size_id
            FROM product_barcodes pb
            JOIN product_variants pv ON pv.id = pb.variant_id
            WHERE COALESCE(pb.is_deleted, 0) = 0
              AND pb.product_id IN ({ph})
            ORDER BY pb.created_at
            """,
            pids,
        ).fetchall()
        for cr in code_rows:
            barcodes_by_variant.setdefault(
                _vkey(cr["product_id"], cr["color_id"], cr["size_id"]), []
            ).append(str(cr["barcode"]))

    items = [
        PlannableItem(
            product_id=str(r["product_id"]),
            product_name=str(r["live_name"] or r["product_name"]),
            product_sku=str(r["live_sku"] or r["product_sku"]),
            sku_pending=bool(r["sku_pending"]),
            client_id=r["client_id"],
            client_name=r["live_client_name"],
            color_id=r["color_id"],
            color_name=r["live_color_name"],
            size_id=r["size_id"],
            size_name=r["live_size_name"],
            ready_good=int(r["ready_good"] or 0),
            ready_defect=int(r["ready_defect"] or 0),
            packed_good=0 if is_defect else int(r["packed_good"] or 0),
            packing_good=0 if is_defect else int(r["packing_good"] or 0),
            storage_good=int(r["storage_good"] or 0),
            storage_defect=int(r["storage_defect"] or 0),
            in_transit=0 if is_defect else int(r["in_transit"] or 0),
            items_per_box=int(r["items_per_box"]) if r["items_per_box"] is not None else None,
            boxes_per_pallet=int(r["boxes_per_pallet"]) if r["boxes_per_pallet"] is not None else None,
            barcodes=barcodes_by_variant.get(_vkey(r["product_id"], r["color_id"], r["size_id"]), []),
        )
        for r in rows
    ]
    return PlannableListResponse(items=items)


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


def _zone_item(row) -> BalanceZoneItem:
    return BalanceZoneItem(
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
        size_sort_order=row["size_sort_order"],
        qty=int(row["qty"] or 0),
    )


def get_balances_by_zone(
    connection,
    *,
    client_id: str | None,
    search: str | None,
    only_positive: bool,
    location: str | None = None,
    op_status: str | None = None,
    quality: str | None = None,
    page: int | None = None,
    limit: int | None = None,
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
        s = ci_like_substring_param(search)
        pos_conds.append(
            "(fold_ci(u.product_name) LIKE ? OR fold_ci(u.product_sku) LIKE ?"
            " OR u.product_id IN (SELECT id FROM products WHERE fold_ci(sku) LIKE ? OR fold_ci(name) LIKE ?)"
            " OR u.color_id IN (SELECT id FROM colors WHERE fold_ci(name) LIKE ?)"
            " OR u.size_id IN (SELECT id FROM sizes WHERE fold_ci(name) LIKE ?)"
            f" OR {barcode_variant_exists_sql('u.product_id', 'u.color_id', 'u.size_id')})"
        )
        line_params += [s, s, s, s, s, s, like_substring_param(search)]
    pos_where = ("WHERE " + " AND ".join(pos_conds)) if pos_conds else ""

    # Пушдаун клиента в полные GROUP BY журнала (gain/lose): client_id — ключ
    # группировки и join'а с position_meta (IS NOT DISTINCT FROM), результат не меняется.
    gain_client = ""
    lose_client = ""
    if client_id:
        gain_client = " AND client_id = ?"
        lose_client = "WHERE client_id = ?"
        line_params += [client_id.strip(), client_id.strip()]

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
            WHERE to_op NOT IN ({_SINKS_SQL}){gain_client}
            GROUP BY product_id, client_id, color_id, size_id, to_zone_id, to_op, to_quality
        ),
        lose AS (
            SELECT product_id, client_id, color_id, size_id,
                   from_zone_id AS loc_id, from_op AS op, from_quality AS quality, SUM(qty) AS qty
            FROM zone_relocations
            {lose_client}
            GROUP BY product_id, client_id, color_id, size_id, from_zone_id, from_op, from_quality
        ),
        locs AS (
            SELECT product_id, client_id, color_id, size_id, loc_id, op, quality FROM gain
            UNION
            SELECT product_id, client_id, color_id, size_id, loc_id, op, quality FROM lose
        )
        SELECT x.loc_id AS location_id, x.op AS op_status, x.quality,
               pm.product_id,
               COALESCE(NULLIF(TRIM(prod.sku), ''), pm.product_sku) AS product_sku,
               pm.client_id, pm.color_id, pm.size_id,
               COALESCE(NULLIF(TRIM(prod.name), ''), pm.product_name) AS product_name,
               COALESCE(lcl.name, pm.client_name) AS client_name,
               COALESCE(lco.name, pm.color_name)  AS color_name,
               COALESCE(lsz.name, pm.size_name)   AS size_name,
               lsz.sort_order AS size_sort_order,
               GREATEST(0, COALESCE(gi.qty, 0) - COALESCE(lo.qty, 0)) AS qty
        FROM locs x
        JOIN position_meta pm ON {pos_join}
        LEFT JOIN products prod ON prod.id = x.product_id
        LEFT JOIN clients  lcl  ON lcl.id = pm.client_id
        LEFT JOIN colors   lco  ON lco.id = pm.color_id
        LEFT JOIN sizes    lsz  ON lsz.id = pm.size_id
        LEFT JOIN gain gi ON {_term_join('gi')} AND gi.op = x.op AND gi.quality = x.quality
        LEFT JOIN lose lo ON {_term_join('lo')} AND lo.op = x.op AND lo.quality = x.quality
    """

    # Доп. фильтры поверх агрегата: местоположение (часть кода адреса, напр. «1-А»),
    # операционный статус и качество. Применяются в обоих режимах (с пагинацией и без).
    extra = ""
    extra_params: list = []
    if location and location.strip():
        extra += " AND fold_ci(b.actual_location_name) LIKE ?"
        extra_params.append(ci_like_substring_param(location))
    if op_status and str(op_status).strip():
        extra += " AND b.op_status = ?"
        extra_params.append(str(op_status).strip())
    if quality and str(quality).strip():
        extra += " AND b.quality = ?"
        extra_params.append(str(quality).strip())

    base_subquery = f"""
        SELECT b.*
        FROM (
            SELECT a.*, uz.name AS actual_location_name
            FROM ({agg_query}) a
            LEFT JOIN unloading_zones uz ON uz.id = a.location_id
        ) b
        WHERE b.qty > 0 {extra}
    """

    # Режим пагинации (web присылает limit): страница = N местоположений со всеми
    # их строками. Мобильный экран без limit идёт по легаси-пути (потолок + truncated).
    if limit is not None and limit > 0:
        page_n = page if (page and page > 0) else 1
        offset = (page_n - 1) * limit
        rows = connection.execute(
            f"""
            WITH joined AS ({base_subquery}),
            locs AS (
                SELECT location_id,
                       ROW_NUMBER() OVER (
                           ORDER BY MAX(actual_location_name) IS NULL, MAX(actual_location_name)
                       ) AS rn,
                       COUNT(*) OVER () AS total_locs
                FROM joined
                GROUP BY location_id
            )
            SELECT j.*, l.total_locs
            FROM joined j
            JOIN locs l ON l.location_id IS NOT DISTINCT FROM j.location_id
            WHERE l.rn > ? AND l.rn <= ?
            ORDER BY l.rn, j.qty DESC, j.op_status, j.quality, j.product_name, j.color_name, j.size_name
            """,
            [*line_params, *extra_params, offset, offset + limit],
        ).fetchall()
        total = int(rows[0]["total_locs"]) if rows else 0
        return BalanceZonesResponse(
            items=[_zone_item(r) for r in rows],
            truncated=False,
            total=total,
            page=page_n,
            limit=limit,
        )

    rows = connection.execute(
        f"""
        SELECT * FROM ({base_subquery}) b2
        ORDER BY
            b2.actual_location_name IS NULL,
            b2.actual_location_name,
            b2.qty DESC,
            b2.op_status,
            b2.quality,
            b2.product_name,
            b2.color_name,
            b2.size_name
        LIMIT {ZONE_ROWS_LIMIT + 1}
        """,
        [*line_params, *extra_params],
    ).fetchall()

    truncated = len(rows) > ZONE_ROWS_LIMIT
    rows = rows[:ZONE_ROWS_LIMIT]
    return BalanceZonesResponse(items=[_zone_item(r) for r in rows], truncated=truncated)


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
    from_container_id: str | None = None, to_container_id: str | None = None,
    shipment_line_id: str | None = None, comment: str | None = None,
    packed_date: str | None = None, pack_entry_id: str | None = None,
    reverses_id: str | None = None, receipt_line_id: str | None = None,
    reason: str | None = None, trip_id: str | None = None,
    dispatch_line_id: str | None = None,
    repack_kind: str | None = None, repack_price_kop: int | None = None,
) -> None:
    """Append-only запись в единый журнал движений. Без commit — коммитит вызывающий.

    Покрывает приход приёмки (intake→storage), перемещение (оси не меняются),
    передачу на упаковку (storage→packing), упаковку (packing→packed годного и
    брака), раскладку «Готово к рейсу» (packed→ready годного / packed→storage
    брака), смену качества, списание при отправке рейса (…→shipped) и ручное
    списание (…→written_off).
    packed_date/pack_entry_id/reverses_id заполняются только для QC-упаковки;
    receipt_line_id — только для прихода приёмки; reason — только для списания;
    repack_kind/repack_price_kop — только для pack-записей переупаковки.
    from_container_id/to_container_id — ось короба (задача «Размещение по ячейкам»):
    содержимое короба = нетто журнала по этой оси, поэтому перенос короба между
    ячейками обязан ставить ОБА поля (нетто внутри короба не меняется), а изъятие —
    только from_container_id.
    """
    from datetime import UTC, datetime
    from uuid import uuid4

    connection.execute(
        """INSERT INTO zone_relocations
           (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
            client_id,client_name,from_op,to_op,from_quality,to_quality,
            from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by,shipment_line_id,
            packed_date,pack_entry_id,reverses_id,receipt_line_id,reason,trip_id,dispatch_line_id,
            repack_kind,repack_price_kop,from_container_id,to_container_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
         client_id, client_name, from_op, to_op, from_quality, to_quality,
         from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment,
         datetime.now(UTC).isoformat(), user_id, shipment_line_id,
         packed_date, pack_entry_id, reverses_id, receipt_line_id, reason, trip_id, dispatch_line_id,
         repack_kind, repack_price_kop, from_container_id, to_container_id),
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


def ready_zones_for_variant(
    connection,
    *,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
    quality: str,
    op: str = INV_OP_READY,
) -> list[dict]:
    """Остаток-источник отгрузки (`op`-нетто) варианта×клиента×качества по местам.

    Seam между «Задачей упаковки» (производит ready) и «Отгрузкой» (потребляет):
    остаток считается ПО ВАРИАНТУ (product/color/size×client×quality), а не по строке —
    отгрузка не знает, какая задача упаковки его подготовила. Возвращает [{zone_id,
    zone_name, net}] с net>0 по убыванию (для FIFO-списания при выезде рейса).
    `op` — корзина-источник: годный отгружается из `ready`, брак и годный без
    упаковки — прямо из `storage`.
    """
    rows = connection.execute(
        """SELECT zone_id, MIN(zone_name) AS zone_name, SUM(net) AS net FROM (
               SELECT to_zone_id AS zone_id, to_zone_name AS zone_name, qty AS net
               FROM zone_relocations
               WHERE product_id = ?
                 AND color_id  IS NOT DISTINCT FROM ?
                 AND size_id   IS NOT DISTINCT FROM ?
                 AND client_id IS NOT DISTINCT FROM ?
                 AND to_op = ? AND to_quality = ?
               UNION ALL
               SELECT from_zone_id, from_zone_name, -qty
               FROM zone_relocations
               WHERE product_id = ?
                 AND color_id  IS NOT DISTINCT FROM ?
                 AND size_id   IS NOT DISTINCT FROM ?
                 AND client_id IS NOT DISTINCT FROM ?
                 AND from_op = ? AND from_quality = ?
           ) t
           GROUP BY zone_id HAVING SUM(net) > 0
           ORDER BY SUM(net) DESC""",
        (product_id, color_id, size_id, client_id, op, quality,
         product_id, color_id, size_id, client_id, op, quality),
    ).fetchall()
    return [{"zone_id": r["zone_id"], "zone_name": r["zone_name"], "net": int(r["net"])} for r in rows]


def ready_available_for_dispatch(
    connection,
    *,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
    quality: str,
    ops: Sequence[str] = (INV_OP_READY,),
    reserved_specs: Sequence[tuple[str, Sequence[str]]] | None = None,
    exclude_doc_id: str | None = None,
) -> int:
    """Свободный остаток-источник варианта под отгрузку: доступно минус уже
    зарезервированное другими незакрытыми отгрузками.

    Σ-по-корзинам нетто (вариант×клиент×качество) − Σ(незавершённый объём
    ЗАФИКСИРОВАННЫХ отгрузок того же варианта: qty − shipped_qty). Черновики резерв
    НЕ держат — это лишь намерение; иначе два черновика взаимно заблокировали бы
    передачу в подготовку. Резерв возникает при фиксации (advance, draft → preparing):
    кто первый передал — тот и занял остаток, второй не пройдёт гейт. `ops` —
    корзины-источники гейта (годный из `ready`, брак и годный без упаковки — из
    `storage`).

    `reserved_specs` — [(cargo_type, statuses)]: отгрузки каких типов груза и в каких
    статусах ещё держат спрос на этой корзине-источнике (какие — знает dispatch, см.
    `_reserve_specs`). Для источников со `storage` подготовка физически увозит товар
    (уже учтено в нетто) — там резерв держит только `preparing`, иначе двойной счёт
    ложно блокирует следующую отгрузку. По умолчанию — обычный годный: тот же тип
    груза в preparing/awaiting_trip/partially_shipped. `exclude_doc_id` исключает
    саму проверяемую отгрузку.
    """
    if reserved_specs is None:
        cargo = DISPATCH_CARGO_DEFECT if quality == INV_Q_DEFECT else DISPATCH_CARGO_GOOD
        reserved_specs = [(cargo, (
            DISPATCH_STATUS_PREPARING, DISPATCH_STATUS_AWAITING_TRIP, DISPATCH_STATUS_PARTIALLY_SHIPPED,
        ))]
    ready = sum(
        get_available_total(
            connection, product_id=product_id, color_id=color_id, size_id=size_id,
            client_id=client_id, op=op, quality=quality,
        )
        for op in ops
    )
    spec_conds: list[str] = []
    spec_params: list = []
    for spec_cargo, statuses in reserved_specs:
        status_ph = ",".join("?" for _ in statuses)
        spec_conds.append(f"(COALESCE(dd.cargo_type, '{DISPATCH_CARGO_GOOD}') = ? AND dd.status IN ({status_ph}))")
        spec_params += [spec_cargo, *statuses]
    conds = [
        "dl.product_id = ?",
        "dl.color_id IS NOT DISTINCT FROM ?",
        "dl.size_id  IS NOT DISTINCT FROM ?",
        "dd.client_id IS NOT DISTINCT FROM ?",
        f"({' OR '.join(spec_conds)})",
        "COALESCE(dl.is_deleted, 0) = 0",
        "COALESCE(dd.is_deleted, 0) = 0",
    ]
    params: list = [product_id, color_id, size_id, client_id, *spec_params]
    if exclude_doc_id:
        conds.append("dd.id <> ?")
        params.append(exclude_doc_id)
    row = connection.execute(
        f"""SELECT COALESCE(SUM(GREATEST(dl.qty - COALESCE(dl.shipped_qty, 0), 0)), 0) AS reserved
            FROM dispatch_lines dl
            JOIN dispatch_docs dd ON dd.id = dl.doc_id
            WHERE {' AND '.join(conds)}""",
        params,
    ).fetchone()
    reserved = int(row["reserved"] or 0)
    return max(0, ready - reserved)


# Бакеты, доступные ручным операциям с остатками: терминальные стоки не трогаем,
# intake — не бакет (товар ещё не принят рейсом, приёмка сама кладёт его на место).
MANUAL_STOCK_OPS: tuple[str, ...] = (INV_OP_STORAGE, INV_OP_PACKING, INV_OP_PACKED, INV_OP_READY)


def _bucket_attribution_nets(
    connection, *,
    product_id: str, color_id: str | None, size_id: str | None, client_id: str | None,
    zone_id: str | None, op: str, quality: str,
) -> list[dict]:
    """Нетто корзины (op, quality) в месте с разбивкой по атрибуции к строкам документов.

    Товар вне «На хранении» привязан журналом к строкам задач упаковки/отгрузок
    (shipment_line_id / dispatch_line_id) — на этом держатся пулы строк
    (line_on_packing_qty, line_packed_pending) и раскладка по ячейкам в карточках.
    Ручная операция обязана унаследовать атрибуцию, иначе пулы и ячейки разойдутся
    с журналом. Возвращает [{shipment_line_id, dispatch_line_id, net}] с net > 0
    по убыванию нетто (для FIFO-потребления).
    """
    variant_conds_to: list[str] = []
    variant_conds_from: list[str] = []
    params_to: list = [op, quality]
    params_from: list = [op, quality]
    for col, val in (
        ("product_id", product_id),
        ("color_id", color_id),
        ("size_id", size_id),
        ("client_id", client_id),
    ):
        cond, p = _eq_or_null(col, val)
        variant_conds_to.append(cond)
        variant_conds_from.append(cond)
        params_to += p
        params_from += p
    zone_cond_to, zone_p_to = _eq_or_null("to_zone_id", zone_id)
    zone_cond_from, zone_p_from = _eq_or_null("from_zone_id", zone_id)
    rows = connection.execute(
        f"""SELECT shipment_line_id, dispatch_line_id, SUM(net) AS net FROM (
               SELECT shipment_line_id, dispatch_line_id, qty AS net
               FROM zone_relocations
               WHERE to_op = ? AND to_quality = ? AND {' AND '.join(variant_conds_to)} AND {zone_cond_to}
               UNION ALL
               SELECT shipment_line_id, dispatch_line_id, -qty
               FROM zone_relocations
               WHERE from_op = ? AND from_quality = ? AND {' AND '.join(variant_conds_from)} AND {zone_cond_from}
           ) t
           GROUP BY shipment_line_id, dispatch_line_id
           HAVING SUM(net) > 0
           ORDER BY SUM(net) DESC""",
        (*params_to, *zone_p_to, *params_from, *zone_p_from),
    ).fetchall()
    return [
        {
            "shipment_line_id": r["shipment_line_id"],
            "dispatch_line_id": r["dispatch_line_id"],
            "net": int(r["net"]),
        }
        for r in rows
    ]


def _ensure_not_boxed(connection, payload, *, op: str, quality: str, zone_id: str | None, action: str) -> None:
    """Гейт ручных операций: то, что лежит в коробе, двигается только коробом.

    Иначе остаток уедет из места, а содержимое короба останется прежним — короб и
    остатки разойдутся. Короб целиком развозит процесс размещения; отдельную позицию
    из размещённого короба сначала изымают (POST /containers/{id}/items/remove).
    Считаем свободный остаток: часть той же позиции могла лежать россыпью, её двигать можно.
    """
    from fastapi import HTTPException
    from modules.containers.service import containers_holding

    boxes = containers_holding(
        connection,
        product_id=payload.product_id, color_id=payload.color_id, size_id=payload.size_id,
        client_id=payload.client_id, zone_id=zone_id, op=op, quality=quality,
    )
    if not boxes:
        return

    in_boxes = sum(qty for _number, qty in boxes)
    available = get_available_in_zone(
        connection,
        product_id=payload.product_id, color_id=payload.color_id, size_id=payload.size_id,
        client_id=payload.client_id, zone_id=zone_id, op=op, quality=quality,
    )
    free = max(available - in_boxes, 0)
    if int(payload.qty or 0) > free:
        names = ", ".join(number for number, _qty in boxes)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Товар лежит в коробе {names} ({in_boxes} шт.) — {action} можно только коробом целиком"
                + (f", свободно {free} шт." if free else "")
            ),
        )


def _manual_op(payload) -> str:
    """Операционный статус ручной операции из payload (по умолчанию — «На хранении»)."""
    from fastapi import HTTPException

    op = str(getattr(payload, "op", None) or INV_OP_STORAGE)
    if op not in MANUAL_STOCK_OPS:
        raise HTTPException(status_code=400, detail="Операция недоступна для этого статуса товара")
    return op


def create_zone_relocation(connection, payload, user_id: str) -> None:
    """Перемещение товара между местами (оси статуса и качества не меняются).

    Разрешено для любого нетерминального бакета: товар можно физически переставить,
    даже когда он на упаковке или подготовлен к отгрузке — процессы считают пулы по
    суммам бакетов и перестановку не замечают. Товар вне «На хранении» привязан к
    строкам документов, поэтому движение дробится по атрибуции FIFO.
    """
    _create_relocation_moves(connection, payload, user_id)
    connection.commit()


def _create_relocation_moves(connection, payload, user_id: str) -> None:
    """Движения одного перемещения (см. create_zone_relocation). Без commit."""
    from fastapi import HTTPException

    if payload.quality not in (INV_Q_GOOD, INV_Q_DEFECT):
        raise HTTPException(status_code=400, detail="Перемещать можно только годный товар или брак")
    op = _manual_op(payload)

    from_id = (payload.from_zone_id or "").strip() or None
    to_id = (payload.to_zone_id or "").strip() or None
    if not from_id:
        raise HTTPException(status_code=400, detail="Укажите место, откуда перемещаете товар")
    if from_id == to_id:
        raise HTTPException(status_code=400, detail="Выберите другое место назначения")

    _ensure_not_boxed(connection, payload, op=op, quality=payload.quality, zone_id=from_id, action="перемещать")

    available = get_available_in_zone(
        connection,
        product_id=payload.product_id,
        color_id=payload.color_id,
        size_id=payload.size_id,
        client_id=payload.client_id,
        zone_id=from_id,
        op=op,
        quality=payload.quality,
    )
    if available < payload.qty:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара в месте для перемещения (доступно {available}, нужно {payload.qty})",
        )

    comment = (payload.comment or "").strip() or None
    if op != INV_OP_STORAGE:
        prefix = f"Ручное перемещение ({INV_OP_LABELS[op]})"
        comment = f"{prefix}. {comment}" if comment else prefix

    from_name = _zone_name(connection, from_id)
    to_name = _zone_name(connection, to_id)
    for shipment_line_id, dispatch_line_id, take in _split_by_attribution(
        connection, payload, op=op, quality=payload.quality, zone_id=from_id,
    ):
        insert_inventory_move(
            connection,
            product_id=payload.product_id, product_name=payload.product_name, product_sku=payload.product_sku,
            color_id=payload.color_id, color_name=payload.color_name,
            size_id=payload.size_id, size_name=payload.size_name,
            client_id=payload.client_id, client_name=payload.client_name,
            from_op=op, to_op=op,
            from_quality=payload.quality, to_quality=payload.quality,
            from_zone_id=from_id, from_zone_name=from_name,
            to_zone_id=to_id, to_zone_name=to_name,
            qty=take, user_id=user_id,
            shipment_line_id=shipment_line_id, dispatch_line_id=dispatch_line_id,
            comment=comment,
        )


def create_zone_relocations_bulk(connection, payload, user_id: str) -> int:
    """Массовая консолидация: разные позиции из разных мест в одно место, одной транзакцией.

    Меняется только место: операционный статус и качество каждой позиции сохраняются,
    товар вне «На хранении» дробится по атрибуции FIFO так же, как при поштучном
    перемещении. Ошибка по любой позиции откатывает весь батч. Без commit.
    Возвращает итог шт.
    """
    from fastapi import HTTPException
    from modules.balances.schemas import ZoneRelocationCreate

    items = payload.items or []
    if not items:
        raise HTTPException(status_code=400, detail="Отметьте хотя бы одну позицию")
    comment = (payload.comment or "").strip() or None
    seen: set[tuple] = set()
    total = 0
    for item in items:
        label = " · ".join(
            x for x in [item.product_sku, item.color_name, item.size_name] if x
        ) or (item.product_name or item.product_id)
        key = (
            item.product_id, item.color_id, item.size_id, item.client_id,
            item.from_zone_id, item.op, item.quality,
        )
        # Дубль одной позиции из одного места прошёл бы две независимые проверки
        # доступности и взял бы остаток дважды.
        if key in seen:
            raise HTTPException(status_code=400, detail=f"«{label}»: позиция указана дважды")
        seen.add(key)
        single = ZoneRelocationCreate(
            **item.model_dump(),
            to_zone_id=payload.to_zone_id,
            comment=comment,
        )
        try:
            _create_relocation_moves(connection, single, user_id)
        except HTTPException as e:
            if e.status_code == 400:
                raise HTTPException(status_code=400, detail=f"«{label}»: {e.detail}") from e
            raise
        total += int(item.qty)
    return total


def _split_by_attribution(connection, payload, *, op: str, quality: str, zone_id: str | None):
    """FIFO-дробление количества ручной операции по атрибуции бакета-источника.

    Для «На хранении» атрибуция не нужна (пулы строк считаются по packing/packed/ready) —
    одна запись без привязки, как и раньше. Доступность проверена вызывающим, поэтому
    положительных нетто всегда хватает на payload.qty.
    """
    if op == INV_OP_STORAGE:
        return [(None, None, int(payload.qty))]
    sources = _bucket_attribution_nets(
        connection,
        product_id=payload.product_id, color_id=payload.color_id,
        size_id=payload.size_id, client_id=payload.client_id,
        zone_id=zone_id, op=op, quality=quality,
    )
    parts: list[tuple[str | None, str | None, int]] = []
    remaining = int(payload.qty)
    for src in sources:
        if remaining <= 0:
            break
        take = min(remaining, src["net"])
        parts.append((src["shipment_line_id"], src["dispatch_line_id"], take))
        remaining -= take
    if remaining > 0:
        # Недостижимо после проверки доступности; страховка от гонки параллельных операций.
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="Остаток в месте изменился — обновите данные и повторите")
    return parts


def create_quality_change(connection, payload, user_id: str) -> None:
    """Смена качества товара (Брак ↔ Годный) в пределах одного места.

    «На хранении» — обе стороны, движение (storage, from_q) → (storage, to_q).
    Вне хранения (упаковка / упаковано / готов к отгрузке) — только перевод годного
    в брак: брак не должен уехать клиенту, поэтому товар выбывает из процесса
    движением (op, good) → (storage, defect) в том же месте (зеркало раскладки брака
    в finish_relocation). Атрибуция к строкам документов наследуется FIFO, чтобы
    пулы строк (line_on_packing_qty / line_packed_pending) уменьшились корректно.
    """
    from fastapi import HTTPException

    if payload.from_quality == payload.to_quality:
        raise HTTPException(status_code=400, detail="Выберите другое качество")
    op = _manual_op(payload)
    if op != INV_OP_STORAGE and not (
        payload.from_quality == INV_Q_GOOD and payload.to_quality == INV_Q_DEFECT
    ):
        raise HTTPException(
            status_code=400,
            detail="Вне «На хранении» доступен только перевод годного в брак",
        )

    zone_id = (payload.zone_id or "").strip() or None
    if not zone_id:
        raise HTTPException(status_code=400, detail="Укажите место, где меняется качество товара")

    _ensure_not_boxed(
        connection, payload, op=op, quality=payload.from_quality, zone_id=zone_id,
        action="переводить в другое качество",
    )

    available = get_available_in_zone(
        connection,
        product_id=payload.product_id,
        color_id=payload.color_id,
        size_id=payload.size_id,
        client_id=payload.client_id,
        zone_id=zone_id,
        op=op,
        quality=payload.from_quality,
    )
    if available < payload.qty:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара в месте для смены качества (доступно {available}, нужно {payload.qty})",
        )

    zone_name = _zone_name(connection, zone_id)
    label = f"{INV_QUALITY_LABELS[payload.from_quality]} → {INV_QUALITY_LABELS[payload.to_quality]}"
    if op != INV_OP_STORAGE:
        label = f"{label} ({INV_OP_LABELS[op]} → {INV_OP_LABELS[INV_OP_STORAGE]})"
    comment = (payload.comment or "").strip()
    for shipment_line_id, dispatch_line_id, take in _split_by_attribution(
        connection, payload, op=op, quality=payload.from_quality, zone_id=zone_id,
    ):
        insert_inventory_move(
            connection,
            product_id=payload.product_id, product_name=payload.product_name, product_sku=payload.product_sku,
            color_id=payload.color_id, color_name=payload.color_name,
            size_id=payload.size_id, size_name=payload.size_name,
            client_id=payload.client_id, client_name=payload.client_name,
            from_op=op, to_op=INV_OP_STORAGE,
            from_quality=payload.from_quality, to_quality=payload.to_quality,
            from_zone_id=zone_id, from_zone_name=zone_name,
            to_zone_id=zone_id, to_zone_name=zone_name,
            qty=take, user_id=user_id,
            shipment_line_id=shipment_line_id, dispatch_line_id=dispatch_line_id,
            comment=f"Смена качества: {label}" + (f". {comment}" if comment else ""),
        )
    connection.commit()


def create_write_off(connection, payload, user_id: str) -> None:
    """Ручное списание остатков: (op, quality)@место → (written_off, quality).

    Терминальный сток — товар уходит с остатков насовсем. Списать можно из любого
    нетерминального бакета (хранение / упаковка / упаковано / готов к отгрузке);
    атрибуция к строкам документов наследуется FIFO, чтобы пулы строк уменьшились.
    Причина обязательна, для «Прочее» обязателен комментарий.
    """
    from fastapi import HTTPException

    op = _manual_op(payload)
    zone_id = (payload.zone_id or "").strip() or None
    if not zone_id:
        raise HTTPException(status_code=400, detail="Укажите место, из которого списывается товар")

    comment = (payload.comment or "").strip()
    if payload.reason == WRITEOFF_REASON_OTHER and not comment:
        raise HTTPException(status_code=400, detail="Для причины «Прочее» укажите комментарий")
    if op != INV_OP_STORAGE:
        prefix = f"Списание ({INV_OP_LABELS[op]})"
        comment = f"{prefix}. {comment}" if comment else prefix

    _ensure_not_boxed(connection, payload, op=op, quality=payload.quality, zone_id=zone_id, action="списывать")

    available = get_available_in_zone(
        connection,
        product_id=payload.product_id,
        color_id=payload.color_id,
        size_id=payload.size_id,
        client_id=payload.client_id,
        zone_id=zone_id,
        op=op,
        quality=payload.quality,
    )
    if available < payload.qty:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара в месте для списания (доступно {available}, нужно {payload.qty})",
        )

    zone_name = _zone_name(connection, zone_id)
    for shipment_line_id, dispatch_line_id, take in _split_by_attribution(
        connection, payload, op=op, quality=payload.quality, zone_id=zone_id,
    ):
        insert_inventory_move(
            connection,
            product_id=payload.product_id, product_name=payload.product_name, product_sku=payload.product_sku,
            color_id=payload.color_id, color_name=payload.color_name,
            size_id=payload.size_id, size_name=payload.size_name,
            client_id=payload.client_id, client_name=payload.client_name,
            from_op=op, to_op=INV_OP_WRITTEN_OFF,
            from_quality=payload.quality, to_quality=payload.quality,
            from_zone_id=zone_id, from_zone_name=zone_name,
            to_zone_id=None, to_zone_name=None,
            qty=take, user_id=user_id,
            shipment_line_id=shipment_line_id, dispatch_line_id=dispatch_line_id,
            reason=payload.reason,
            comment=comment or None,
        )
    connection.commit()


def reverse_write_off(connection, relocation_id: str, user_id: str) -> None:
    """Откат ошибочного списания: зеркальное движение written_off → исходный бакет.

    Append-only, как и все реверсы журнала (см. reverse_packing_entry): пишем обратную
    запись со ссылкой reverses_id на оригинал и запрещаем повторный откат. Атрибуция к
    строкам документов (shipment_line_id / dispatch_line_id) восстанавливается — пул строки
    возвращается ровно тем куском, что списание из него забрало. Списание могло разбиться
    по FIFO на несколько строк журнала — каждая откатывается своей записью отдельно.
    """
    from fastapi import HTTPException

    row = connection.execute(
        "SELECT * FROM zone_relocations WHERE id = ?", (relocation_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Запись движения не найдена")
    if str(row["to_op"]) != INV_OP_WRITTEN_OFF or row["reverses_id"]:
        raise HTTPException(status_code=400, detail="Откатить можно только запись списания")

    already = connection.execute(
        "SELECT 1 FROM zone_relocations WHERE reverses_id = ? LIMIT 1", (relocation_id,)
    ).fetchone()
    if already:
        raise HTTPException(status_code=400, detail="Это списание уже отменено")

    qty = int(row["qty"] or 0)
    insert_inventory_move(
        connection,
        product_id=str(row["product_id"]), product_name=row["product_name"], product_sku=row["product_sku"],
        color_id=row["color_id"], color_name=row["color_name"],
        size_id=row["size_id"], size_name=row["size_name"],
        client_id=row["client_id"], client_name=row["client_name"],
        from_op=INV_OP_WRITTEN_OFF, to_op=str(row["from_op"]),
        from_quality=str(row["from_quality"]), to_quality=str(row["from_quality"]),
        from_zone_id=None, from_zone_name=None,
        to_zone_id=row["from_zone_id"], to_zone_name=row["from_zone_name"],
        qty=qty, user_id=user_id,
        shipment_line_id=row["shipment_line_id"], dispatch_line_id=row["dispatch_line_id"],
        reverses_id=relocation_id,
        comment=f"Откат списания: {qty} шт.",
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
    boxed_only: bool = False,
) -> "ZoneRelocationListResponse":
    from modules.balances.schemas import ZoneRelocationItem, ZoneRelocationListResponse

    conds: list[str] = []
    params: list = []
    if client_id:
        conds.append("r.client_id = ?")
        params.append(client_id.strip())
    if search:
        s = ci_like_substring_param(search)
        conds.append(
            "(fold_ci(r.product_name) LIKE ? OR fold_ci(r.product_sku) LIKE ? "
            "OR r.product_id IN (SELECT id FROM products WHERE fold_ci(sku) LIKE ?) "
            "OR fold_ci(cf.doc_number) LIKE ? OR fold_ci(ct.doc_number) LIKE ?)"
        )
        params += [s, s, s, s, s]
    if boxed_only:
        conds.append("(r.from_container_id IS NOT NULL OR r.to_container_id IS NOT NULL)")
    where = ("WHERE " + " AND ".join(conds)) if conds else ""

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT r.*, COALESCE(NULLIF(TRIM(p.sku), ''), r.product_sku) AS effective_sku,
               COALESCE(NULLIF(u.display_name, ''), u.email) AS created_by_email,
               cf.doc_number AS from_container, ct.doc_number AS to_container,
               EXISTS(SELECT 1 FROM zone_relocations x WHERE x.reverses_id = r.id) AS is_reversed,
               COUNT(*) OVER() AS _total
        FROM zone_relocations r
        LEFT JOIN products p ON p.id = r.product_id
        LEFT JOIN users u ON u.id = r.created_by
        LEFT JOIN containers cf ON cf.id = r.from_container_id
        LEFT JOIN containers ct ON ct.id = r.to_container_id
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
            product_sku=row["effective_sku"],
            color_name=row["color_name"],
            size_name=row["size_name"],
            client_name=row["client_name"],
            from_zone_name=row["from_zone_name"],
            to_zone_name=row["to_zone_name"],
            qty=int(row["qty"] or 0),
            reason=row["reason"],
            comment=row["comment"],
            reverses_id=str(row["reverses_id"]) if row["reverses_id"] else None,
            from_container=row["from_container"],
            to_container=row["to_container"],
            is_reversed=bool(row["is_reversed"]),
        )
        for row in rows
    ]
    return ZoneRelocationListResponse(items=items, total=total, page=page, limit=limit)


# ── Оборот запаса: приход → расход → остаток ────────────────────────────────
#
# Отдельный от «Перемещений» срез журнала: только движения, меняющие ОБЩИЙ остаток
# позиции. Внутренние переходы (storage → packing → packed → ready, смена места,
# смена качества) идут между нетерминальными корзинами и на сумму остатка не влияют —
# в ведомость они не попадают, иначе «как пришли от поступления к остатку» тонет
# в технологических шагах.
#
# Инвариант: остаток позиции = Σ знаковых дельт значимых событий. Он же — сумма
# нетерминальных корзин в get_balances (движение между корзинами взаимно
# сокращается), поэтому «Остаток на конец» без верхней границы периода совпадает
# с текущим остатком в «По товарам».

# Бизнес-день (МСК) движения из UTC-метки журнала: остаток считается по московским
# суткам, как и все склады́ские отчёты (см. business_today в modules/timesheet).
_MSK_DAY_SQL = "((zr.created_at)::timestamptz AT TIME ZONE 'Europe/Moscow')::date::text"

def _check_slice_quality(quality: str | None) -> None:
    """Значения качества инлайнятся в SQL — пропускаем только известные константы."""
    if quality is not None and quality not in (INV_Q_GOOD, INV_Q_DEFECT):
        raise ValueError(f"Неизвестное качество среза: {quality!r}")


def _significant_sql(quality: str | None) -> str:
    """Условие «движение меняет остаток»: всей позиции либо её среза по качеству.

    Для среза значимы ещё и переводы между качествами: общий остаток они не
    меняют, но остаток среза — да (перевод в брак = расход годного и приход брака).
    """
    _check_slice_quality(quality)
    if not quality:
        return (
            f"(zr.from_op = '{INV_OP_INTAKE}' OR zr.to_op = '{INV_OP_INTAKE}'"
            f" OR zr.from_op IN ({_SINKS_SQL}) OR zr.to_op IN ({_SINKS_SQL}))"
        )
    return (
        f"((zr.from_op = '{INV_OP_INTAKE}' AND zr.to_quality = '{quality}')"
        f" OR (zr.to_op = '{INV_OP_INTAKE}' AND zr.from_quality = '{quality}')"
        f" OR (zr.to_op IN ({_SINKS_SQL}) AND zr.from_quality = '{quality}')"
        f" OR (zr.from_op IN ({_SINKS_SQL}) AND zr.to_quality = '{quality}')"
        f" OR (zr.from_op NOT IN ('{INV_OP_INTAKE}', {_SINKS_SQL})"
        f" AND zr.to_op NOT IN ('{INV_OP_INTAKE}', {_SINKS_SQL})"
        f" AND zr.from_quality <> zr.to_quality))"
    )


def _event_kind_sql(quality: str | None) -> str:
    """Классификация значимого движения. Порядок ветвей важен: приход и корректировка
    приёмки различаются только направлением по оси intake; переводы качества
    классифицируются последними — до них доходят только внутренние движения."""
    _check_slice_quality(quality)
    base = f"""CASE
        WHEN zr.from_op = '{INV_OP_INTAKE}' AND zr.receipt_line_id IS NOT NULL THEN '{STOCK_EVENT_RECEIPT}'
        WHEN zr.from_op = '{INV_OP_INTAKE}' THEN '{STOCK_EVENT_STOCK_ENTRY}'
        WHEN zr.to_op   = '{INV_OP_INTAKE}' THEN '{STOCK_EVENT_RECEIPT_ADJUST}'
        WHEN zr.to_op   = '{INV_OP_SHIPPED}' THEN '{STOCK_EVENT_SHIPMENT}'
        WHEN zr.from_op = '{INV_OP_SHIPPED}' THEN '{STOCK_EVENT_SHIPMENT_RETURN}'
        WHEN zr.to_op   = '{INV_OP_WRITTEN_OFF}' THEN '{STOCK_EVENT_WRITE_OFF}'"""
    if not quality:
        return base + f"""
        ELSE '{STOCK_EVENT_WRITE_OFF_UNDO}'
    END"""
    return base + f"""
        WHEN zr.from_op = '{INV_OP_WRITTEN_OFF}' THEN '{STOCK_EVENT_WRITE_OFF_UNDO}'
        WHEN zr.to_quality = '{INV_Q_DEFECT}' THEN '{STOCK_EVENT_DEFECT_IN}'
        ELSE '{STOCK_EVENT_DEFECT_OUT}'
    END"""


def _incoming_kinds(quality: str | None) -> tuple[str, ...]:
    """Виды событий с плюсом к остатку (позиции либо среза по качеству)."""
    if quality == INV_Q_DEFECT:
        return STOCK_EVENT_INCOMING + (STOCK_EVENT_DEFECT_IN,)
    if quality == INV_Q_GOOD:
        return STOCK_EVENT_INCOMING + (STOCK_EVENT_DEFECT_OUT,)
    return STOCK_EVENT_INCOMING


def _delta_sql(quality: str | None) -> str:
    _check_slice_quality(quality)
    incoming = ", ".join(f"'{k}'" for k in _incoming_kinds(quality))
    return f"CASE WHEN kind IN ({incoming}) THEN qty ELSE -qty END"

TURNOVER_HISTORY_LIMIT = 2000


def _period_exprs(date_from: str | None, date_to: str | None) -> tuple[str, str, str, list]:
    """(до периода, внутри периода, по конец периода) + параметры дат в порядке SQL."""
    params: list = []
    before = "FALSE"
    if date_from:
        before = "day < ?"
        params.append(date_from)

    in_parts: list[str] = []
    if date_from:
        in_parts.append("day >= ?")
        params.append(date_from)
    if date_to:
        in_parts.append("day <= ?")
        params.append(date_to)
    in_period = " AND ".join(in_parts) if in_parts else "TRUE"

    upto = "TRUE"
    if date_to:
        upto = "day <= ?"
        params.append(date_to)
    return before, in_period, upto, params


def get_turnover(
    connection,
    *,
    page: int,
    limit: int,
    client_id: str | None,
    search: str | None,
    date_from: str | None,
    date_to: str | None,
    only_moved: bool,
    quality: str | None = None,
) -> "TurnoverListResponse":
    """Оборотная ведомость по позициям: остаток на начало → приход/расход → остаток на конец.

    С фильтром quality считается оборот среза (только годный или только брак):
    переводы между качествами становятся видимыми колонками defect_in/defect_out.
    """
    from modules.balances.schemas import TurnoverItem, TurnoverListResponse, TurnoverTotals

    before, in_period, upto, date_params = _period_exprs(date_from, date_to)

    ev_conds = [_significant_sql(quality)]
    ev_params: list = []
    if client_id:
        ev_conds.append("zr.client_id = ?")
        ev_params.append(client_id.strip())

    def _sum(kind: str) -> str:
        return f"COALESCE(SUM(qty) FILTER (WHERE in_period AND kind = '{kind}'), 0)"

    moved_expr = (
        "(a.receipt + a.stock_entry + ABS(a.shipped) + ABS(a.written_off)"
        " + ABS(a.adjustments) + a.defect_in + a.defect_out)"
    )
    out_conds: list[str] = []
    out_params: list = []
    if search:
        s = ci_like_substring_param(search)
        out_conds.append(
            "(fold_ci(COALESCE(NULLIF(TRIM(prod.name), ''), a.product_name)) LIKE ?"
            " OR fold_ci(COALESCE(NULLIF(TRIM(prod.sku), ''), a.product_sku)) LIKE ?)"
        )
        out_params += [s, s]
    if only_moved:
        out_conds.append(f"{moved_expr} > 0")
    else:
        out_conds.append(f"(a.opening <> 0 OR a.closing <> 0 OR {moved_expr} > 0)")
    out_where = "WHERE " + " AND ".join(out_conds)

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        WITH ev AS (
            SELECT zr.product_id, zr.client_id, zr.color_id, zr.size_id,
                   zr.product_name, zr.product_sku, zr.client_name, zr.color_name, zr.size_name,
                   zr.qty, {_MSK_DAY_SQL} AS day, {_event_kind_sql(quality)} AS kind
            FROM zone_relocations zr
            WHERE {" AND ".join(ev_conds)}
        ),
        marked AS (
            SELECT ev.*, {_delta_sql(quality)} AS delta,
                   ({before}) AS before_period, ({in_period}) AS in_period, ({upto}) AS upto_period
            FROM ev
        ),
        agg AS (
            SELECT product_id, client_id, color_id, size_id,
                   MAX(product_name) AS product_name, MAX(product_sku) AS product_sku,
                   MAX(client_name)  AS client_name,  MAX(color_name)  AS color_name,
                   MAX(size_name)    AS size_name,
                   COALESCE(SUM(delta) FILTER (WHERE before_period), 0) AS opening,
                   {_sum(STOCK_EVENT_RECEIPT)}     AS receipt,
                   {_sum(STOCK_EVENT_STOCK_ENTRY)} AS stock_entry,
                   {_sum(STOCK_EVENT_SHIPMENT)} - {_sum(STOCK_EVENT_SHIPMENT_RETURN)} AS shipped,
                   {_sum(STOCK_EVENT_WRITE_OFF)} - {_sum(STOCK_EVENT_WRITE_OFF_UNDO)} AS written_off,
                   {_sum(STOCK_EVENT_DEFECT_IN)}  AS defect_in,
                   {_sum(STOCK_EVENT_DEFECT_OUT)} AS defect_out,
                   -{_sum(STOCK_EVENT_RECEIPT_ADJUST)} AS adjustments,
                   COALESCE(SUM(delta) FILTER (WHERE upto_period), 0) AS closing
            FROM marked
            GROUP BY product_id, client_id, color_id, size_id
        )
        SELECT a.product_id, a.client_id, a.color_id, a.size_id,
               COALESCE(NULLIF(TRIM(prod.name), ''), a.product_name) AS product_name,
               COALESCE(NULLIF(TRIM(prod.sku), ''),  a.product_sku)  AS product_sku,
               COALESCE(lcl.name, a.client_name) AS client_name,
               COALESCE(lco.name, a.color_name)  AS color_name,
               COALESCE(lsz.name, a.size_name)   AS size_name,
               a.opening, a.receipt, a.stock_entry, a.shipped, a.written_off,
               a.defect_in, a.defect_out, a.adjustments, a.closing,
               COUNT(*) OVER()             AS _total,
               SUM(a.opening)     OVER()   AS _t_opening,
               SUM(a.receipt)     OVER()   AS _t_receipt,
               SUM(a.stock_entry) OVER()   AS _t_stock_entry,
               SUM(a.shipped)     OVER()   AS _t_shipped,
               SUM(a.written_off) OVER()   AS _t_written_off,
               SUM(a.defect_in)   OVER()   AS _t_defect_in,
               SUM(a.defect_out)  OVER()   AS _t_defect_out,
               SUM(a.adjustments) OVER()   AS _t_adjustments,
               SUM(a.closing)     OVER()   AS _t_closing
        FROM agg a
        LEFT JOIN products prod ON prod.id = a.product_id
        LEFT JOIN clients  lcl  ON lcl.id  = a.client_id
        LEFT JOIN colors   lco  ON lco.id  = a.color_id
        LEFT JOIN sizes    lsz  ON lsz.id  = a.size_id
        {out_where}
        ORDER BY (a.receipt + a.stock_entry + ABS(a.shipped) + ABS(a.written_off) + a.defect_in + a.defect_out) DESC,
                 a.closing DESC, product_name, color_name, size_name
        LIMIT ? OFFSET ?
        """,
        ev_params + date_params + out_params + [limit, offset],
    ).fetchall()

    total = int(rows[0]["_total"]) if rows else 0
    totals = TurnoverTotals(
        opening=int(rows[0]["_t_opening"] or 0),
        receipt=int(rows[0]["_t_receipt"] or 0),
        stock_entry=int(rows[0]["_t_stock_entry"] or 0),
        shipped=int(rows[0]["_t_shipped"] or 0),
        written_off=int(rows[0]["_t_written_off"] or 0),
        defect_in=int(rows[0]["_t_defect_in"] or 0),
        defect_out=int(rows[0]["_t_defect_out"] or 0),
        adjustments=int(rows[0]["_t_adjustments"] or 0),
        closing=int(rows[0]["_t_closing"] or 0),
    ) if rows else TurnoverTotals()

    items = [
        TurnoverItem(
            product_id=str(row["product_id"]),
            product_name=row["product_name"],
            product_sku=row["product_sku"],
            client_id=row["client_id"],
            client_name=row["client_name"],
            color_id=row["color_id"],
            color_name=row["color_name"],
            size_id=row["size_id"],
            size_name=row["size_name"],
            opening=int(row["opening"] or 0),
            receipt=int(row["receipt"] or 0),
            stock_entry=int(row["stock_entry"] or 0),
            shipped=int(row["shipped"] or 0),
            written_off=int(row["written_off"] or 0),
            defect_in=int(row["defect_in"] or 0),
            defect_out=int(row["defect_out"] or 0),
            adjustments=int(row["adjustments"] or 0),
            closing=int(row["closing"] or 0),
        )
        for row in rows
    ]
    return TurnoverListResponse(
        items=items, totals=totals, total=total, page=page, limit=limit,
        date_from=date_from, date_to=date_to,
    )


def get_stock_history(
    connection,
    *,
    product_id: str,
    client_id: str | None,
    color_id: str | None,
    size_id: str | None,
    date_from: str | None,
    date_to: str | None,
    quality: str | None = None,
) -> "StockHistoryResponse":
    """Хронология значимых событий позиции с накопительным остатком после каждого.

    Остаток считается «назад от итога»: закрытие позиции известно суммой всех дельт,
    поэтому усечение длинной истории (TURNOVER_HISTORY_LIMIT последних событий)
    не ломает накопительный расчёт — показанное окно всё равно сходится с текущим остатком.
    С фильтром quality история и остатки считаются по срезу качества.
    """
    from modules.balances.schemas import StockHistoryEvent, StockHistoryResponse

    pos_where = (
        "zr.product_id = ? AND zr.client_id IS NOT DISTINCT FROM ?"
        " AND zr.color_id IS NOT DISTINCT FROM ? AND zr.size_id IS NOT DISTINCT FROM ?"
    )
    pos_params: list = [product_id, client_id, color_id, size_id]

    totals = connection.execute(
        f"""
        SELECT COALESCE(SUM({_delta_sql(quality)}), 0) AS closing, COUNT(*) AS cnt
        FROM (
            SELECT zr.qty, {_event_kind_sql(quality)} AS kind
            FROM zone_relocations zr
            WHERE {_significant_sql(quality)} AND {pos_where}
        ) e
        """,
        pos_params,
    ).fetchone()
    closing = int(totals["closing"] or 0) if totals else 0
    total_events = int(totals["cnt"] or 0) if totals else 0

    date_conds = ""
    date_params: list = []
    if date_from:
        date_conds += f" AND {_MSK_DAY_SQL} >= ?"
        date_params.append(date_from)
    if date_to:
        date_conds += f" AND {_MSK_DAY_SQL} <= ?"
        date_params.append(date_to)

    rows = connection.execute(
        f"""
        SELECT zr.id, zr.created_at, zr.qty, zr.reason, zr.comment,
               zr.from_quality, zr.to_quality, zr.from_zone_name, zr.to_zone_name,
               zr.trip_id, {_event_kind_sql(quality)} AS kind,
               COALESCE(NULLIF(u.display_name, ''), u.email) AS created_by_email,
               rd.id AS receipt_id, rd.doc_number AS receipt_number,
               dd.id AS dispatch_id, dd.doc_number AS dispatch_number,
               t.trip_number
        FROM zone_relocations zr
        LEFT JOIN users u           ON u.id  = zr.created_by
        LEFT JOIN receipt_lines rl  ON rl.id = zr.receipt_line_id
        LEFT JOIN receipt_docs rd   ON rd.id = rl.doc_id
        LEFT JOIN dispatch_lines dl ON dl.id = zr.dispatch_line_id
        LEFT JOIN dispatch_docs dd  ON dd.id = dl.doc_id
        LEFT JOIN trip_docs t       ON t.id  = zr.trip_id
        WHERE {_significant_sql(quality)} AND {pos_where}{date_conds}
        ORDER BY zr.created_at DESC, zr.id DESC
        LIMIT ?
        """,
        pos_params + date_params + [TURNOVER_HISTORY_LIMIT],
    ).fetchall()

    pos = connection.execute(
        f"""
        SELECT COALESCE(NULLIF(TRIM(prod.name), ''), MAX(zr.product_name)) AS product_name,
               COALESCE(NULLIF(TRIM(prod.sku), ''),  MAX(zr.product_sku))  AS product_sku,
               COALESCE(MAX(lcl.name), MAX(zr.client_name)) AS client_name,
               COALESCE(MAX(lco.name), MAX(zr.color_name))  AS color_name,
               COALESCE(MAX(lsz.name), MAX(zr.size_name))   AS size_name
        FROM zone_relocations zr
        LEFT JOIN products prod ON prod.id = zr.product_id
        LEFT JOIN clients  lcl  ON lcl.id  = zr.client_id
        LEFT JOIN colors   lco  ON lco.id  = zr.color_id
        LEFT JOIN sizes    lsz  ON lsz.id  = zr.size_id
        WHERE {pos_where}
        GROUP BY prod.name, prod.sku
        """,
        pos_params,
    ).fetchone()

    ordered = list(reversed(rows))
    incoming = _incoming_kinds(quality)
    deltas = [
        int(r["qty"] or 0) if str(r["kind"]) in incoming else -int(r["qty"] or 0)
        for r in ordered
    ]
    # Хвост истории мог быть отрезан фильтром дат — «остаток после» тогда считается
    # от закрытия на конец периода, а не от общего итога позиции.
    tail = 0
    if date_to:
        tail_row = connection.execute(
            f"""
            SELECT COALESCE(SUM({_delta_sql(quality)}), 0) AS d
            FROM (
                SELECT zr.qty, {_event_kind_sql(quality)} AS kind
                FROM zone_relocations zr
                WHERE {_significant_sql(quality)} AND {pos_where} AND {_MSK_DAY_SQL} > ?
            ) e
            """,
            pos_params + [date_to],
        ).fetchone()
        tail = int(tail_row["d"] or 0) if tail_row else 0

    running = closing - tail
    balances: list[int] = []
    for d in reversed(deltas):
        balances.append(running)
        running -= d
    balances.reverse()
    opening = running

    events = [
        StockHistoryEvent(
            id=str(row["id"]),
            created_at=str(row["created_at"]),
            created_by_email=row["created_by_email"],
            kind=str(row["kind"]),
            quality=str(row["to_quality"] or row["from_quality"] or INV_Q_GOOD),
            qty=int(row["qty"] or 0),
            delta=delta,
            balance_after=balance,
            zone_name=row["to_zone_name"] or row["from_zone_name"],
            receipt_id=str(row["receipt_id"]) if row["receipt_id"] else None,
            receipt_number=row["receipt_number"],
            dispatch_id=str(row["dispatch_id"]) if row["dispatch_id"] else None,
            dispatch_number=row["dispatch_number"],
            trip_id=str(row["trip_id"]) if row["trip_id"] else None,
            trip_number=row["trip_number"],
            reason=row["reason"],
            comment=row["comment"],
        )
        for row, delta, balance in zip(ordered, deltas, balances, strict=True)
    ]

    return StockHistoryResponse(
        product_id=product_id,
        product_name=pos["product_name"] if pos else None,
        product_sku=pos["product_sku"] if pos else None,
        client_id=client_id,
        client_name=pos["client_name"] if pos else None,
        color_id=color_id,
        color_name=pos["color_name"] if pos else None,
        size_id=size_id,
        size_name=pos["size_name"] if pos else None,
        opening=opening,
        closing=closing,
        events=events,
        total_events=total_events,
        truncated=total_events > len(events),
    )
