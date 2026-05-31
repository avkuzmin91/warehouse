from __future__ import annotations

from modules.balances.schemas import (
    BalanceItem,
    BalanceListResponse,
    BalanceZoneItem,
    BalanceZonesResponse,
)


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
    doc_conds = ["d.is_deleted = 0", "d.status IN ('done', 'on_review')"]
    doc_params: list = []

    if client_id:
        doc_conds.append("d.client_id = ?")
        doc_params.append(client_id.strip())

    line_conds = ["l.is_deleted = 0"] + doc_conds
    line_params = list(doc_params)

    if search:
        s = f"%{search.strip()}%"
        line_conds.append("(l.product_name LIKE ? OR l.product_sku LIKE ?)")
        line_params += [s, s]

    line_where = " AND ".join(line_conds)

    # ops_agg: recv_corr/def_corr — последнее значение correction по created_at (не MAX qty).
    # Используем коррелированный подзапрос ORDER BY created_at DESC LIMIT 1 — SQLite
    # не поддерживает LAST_VALUE/FILTER с упорядочением в оконной агрегации.
    # on_review: строка ещё на QC, если qc_done_at IS NULL или reopen случился позже.
    agg_query = f"""
        WITH ops_agg AS (
            SELECT
                o.line_id,
                (SELECT o2.qty FROM receipt_ops o2
                 WHERE o2.line_id = o.line_id AND o2.op_type = 'receiving_correction'
                 ORDER BY o2.created_at DESC LIMIT 1) AS recv_corr,
                SUM(CASE WHEN o.op_type = 'receiving'            THEN o.qty ELSE 0 END) AS recv_sum,
                (SELECT o2.qty FROM receipt_ops o2
                 WHERE o2.line_id = o.line_id AND o2.op_type = 'defect_correction'
                 ORDER BY o2.created_at DESC LIMIT 1) AS def_corr,
                SUM(CASE WHEN o.op_type = 'defect_fix'           THEN o.qty ELSE 0 END) AS def_sum,
                MAX(CASE WHEN o.op_type = 'line_qc_complete'     THEN o.created_at END) AS qc_done_at,
                MAX(CASE WHEN o.op_type = 'line_qc_reopen'       THEN o.created_at END) AS qc_reopen_at
            FROM receipt_ops o
            GROUP BY o.line_id
        ),
        receipt_agg AS (
            SELECT
                l.product_id,
                l.product_sku,
                d.client_id,
                l.color_id,
                l.size_id,
                MAX(l.product_name) AS product_name,
                MAX(cl.name)        AS client_name,
                MAX(l.color_name)   AS color_name,
                MAX(l.size_name)    AS size_name,
                SUM(COALESCE(oa.recv_corr, oa.recv_sum, 0)) AS good_in,
                SUM(COALESCE(oa.def_corr,  oa.def_sum,  0)) AS defect_in,
                SUM(CASE
                    WHEN d.status = 'on_review'
                     AND (oa.qc_done_at IS NULL
                          OR (oa.qc_reopen_at IS NOT NULL AND oa.qc_reopen_at > oa.qc_done_at))
                    THEN GREATEST(0,
                        COALESCE(l.accepted_qty, 0)
                        - COALESCE(oa.recv_corr, oa.recv_sum, 0)
                        - COALESCE(oa.def_corr,  oa.def_sum,  0)
                    )
                    ELSE 0
                END) AS on_review,
                COUNT(DISTINCT l.doc_id) AS docs_count
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            LEFT JOIN ops_agg oa ON oa.line_id = l.id
            WHERE {line_where}
            GROUP BY l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id
        ),
        shipped_good AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id,
                   SUM(sl.qty) AS shipped_good
            FROM shipment_lines sl
            JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0
              AND sd.status = 'shipped' AND sd.cargo_type = 'good'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id
        ),
        shipped_defect AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id,
                   SUM(sl.qty) AS shipped_defect
            FROM shipment_lines sl
            JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0
              AND sd.status = 'shipped' AND sd.cargo_type = 'defect'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id
        )
        SELECT
            r.product_id,
            r.product_sku,
            r.client_id,
            r.color_id,
            r.size_id,
            r.product_name,
            r.client_name,
            r.color_name,
            r.size_name,
            GREATEST(0, r.good_in   - COALESCE(sg.shipped_good,   0)) AS good,
            GREATEST(0, r.defect_in - COALESCE(sd.shipped_defect,  0)) AS defect,
            r.on_review,
            r.docs_count
        FROM receipt_agg r
        LEFT JOIN shipped_good sg
            ON sg.product_id = r.product_id
           AND sg.client_id  IS NOT DISTINCT FROM r.client_id
           AND sg.color_id   IS NOT DISTINCT FROM r.color_id
           AND sg.size_id    IS NOT DISTINCT FROM r.size_id
        LEFT JOIN shipped_defect sd
            ON sd.product_id = r.product_id
           AND sd.client_id  IS NOT DISTINCT FROM r.client_id
           AND sd.color_id   IS NOT DISTINCT FROM r.color_id
           AND sd.size_id    IS NOT DISTINCT FROM r.size_id
    """

    where_parts = []
    if only_positive:
        where_parts.append("(good + defect + on_review) > 0")
    if has_defect:
        where_parts.append("defect > 0")
    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    # COUNT(*) OVER() — один проход вместо двух отдельных запросов к БД.
    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT *, COUNT(*) OVER() AS _total_count
        FROM ({agg_query}) a
        {where_clause}
        ORDER BY product_name, color_name, size_name
        LIMIT ? OFFSET ?
        """,
        line_params + [limit, offset],
    ).fetchall()

    total = int(rows[0]["_total_count"]) if rows else 0

    items = [
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
            good=int(row["good"] or 0),
            defect=int(row["defect"] or 0),
            on_review=int(row["on_review"] or 0),
            total=int(row["good"] or 0) + int(row["defect"] or 0) + int(row["on_review"] or 0),
            docs_count=int(row["docs_count"] or 0),
        )
        for row in rows
    ]

    return BalanceListResponse(items=items, total=total, page=page, limit=limit)


def get_balances_by_zone(
    connection,
    *,
    client_id: str | None,
    search: str | None,
    only_positive: bool,
) -> BalanceZonesResponse:
    """Остатки в разрезе места хранения, длинный формат: одна строка на (место, позиция, статус).

    Место товара зависит от статуса:
      - good      → COALESCE(good_zone, storage_zone)
      - defect    → COALESCE(defect_zone, storage_zone)
      - on_review → storage_zone (место «на проверке»)
    Отгрузка вычитается из shipment_line_zones по выбранному при отгрузке месту.

    Точка расширения под перемещения (вариант B): к qty каждого (место, статус, позиция)
    позже добавятся +relocated_in / −relocated_out из таблицы zone_relocations.
    """
    line_conds = ["l.is_deleted = 0", "d.is_deleted = 0", "d.status IN ('done', 'on_review')"]
    line_params: list = []

    if client_id:
        line_conds.append("d.client_id = ?")
        line_params.append(client_id.strip())
    if search:
        s = f"%{search.strip()}%"
        line_conds.append("(l.product_name LIKE ? OR l.product_sku LIKE ?)")
        line_params += [s, s]

    line_where = " AND ".join(line_conds)

    # Три параметрических набора одинаковы → line_params повторяется 3 раза (good/defect/on_review).
    # recv_corr/def_corr — последнее значение correction по created_at (не MAX qty).
    agg_query = f"""
        WITH ops_agg AS (
            SELECT
                o.line_id,
                (SELECT o2.qty FROM receipt_ops o2
                 WHERE o2.line_id = o.line_id AND o2.op_type = 'receiving_correction'
                 ORDER BY o2.created_at DESC LIMIT 1) AS recv_corr,
                SUM(CASE WHEN o.op_type = 'receiving'            THEN o.qty ELSE 0 END) AS recv_sum,
                (SELECT o2.qty FROM receipt_ops o2
                 WHERE o2.line_id = o.line_id AND o2.op_type = 'defect_correction'
                 ORDER BY o2.created_at DESC LIMIT 1) AS def_corr,
                SUM(CASE WHEN o.op_type = 'defect_fix'           THEN o.qty ELSE 0 END) AS def_sum,
                MAX(CASE WHEN o.op_type = 'line_qc_complete'     THEN o.created_at END) AS qc_done_at,
                MAX(CASE WHEN o.op_type = 'line_qc_reopen'       THEN o.created_at END) AS qc_reopen_at
            FROM receipt_ops o
            GROUP BY o.line_id
        ),
        good_agg AS (
            SELECT
                l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id,
                COALESCE(l.good_zone_id, l.storage_zone_id) AS loc_id,
                MAX(COALESCE(l.good_zone_name, l.storage_zone_name)) AS loc_name,
                MAX(l.product_name) AS product_name, MAX(cl.name) AS client_name,
                MAX(l.color_name) AS color_name, MAX(l.size_name) AS size_name,
                SUM(COALESCE(oa.recv_corr, oa.recv_sum, 0)) AS qty_in
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            LEFT JOIN ops_agg oa ON oa.line_id = l.id
            WHERE {line_where}
            GROUP BY l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id,
                     COALESCE(l.good_zone_id, l.storage_zone_id)
        ),
        defect_agg AS (
            SELECT
                l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id,
                COALESCE(l.defect_zone_id, l.storage_zone_id) AS loc_id,
                MAX(COALESCE(l.defect_zone_name, l.storage_zone_name)) AS loc_name,
                MAX(l.product_name) AS product_name, MAX(cl.name) AS client_name,
                MAX(l.color_name) AS color_name, MAX(l.size_name) AS size_name,
                SUM(COALESCE(oa.def_corr, oa.def_sum, 0)) AS qty_in
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            LEFT JOIN ops_agg oa ON oa.line_id = l.id
            WHERE {line_where}
            GROUP BY l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id,
                     COALESCE(l.defect_zone_id, l.storage_zone_id)
        ),
        review_agg AS (
            SELECT
                l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id,
                l.storage_zone_id AS loc_id,
                MAX(l.storage_zone_name) AS loc_name,
                MAX(l.product_name) AS product_name, MAX(cl.name) AS client_name,
                MAX(l.color_name) AS color_name, MAX(l.size_name) AS size_name,
                SUM(CASE
                    WHEN d.status = 'on_review'
                     AND (oa.qc_done_at IS NULL
                          OR (oa.qc_reopen_at IS NOT NULL AND oa.qc_reopen_at > oa.qc_done_at))
                    THEN GREATEST(0,
                        COALESCE(l.accepted_qty, 0)
                        - COALESCE(oa.recv_corr, oa.recv_sum, 0)
                        - COALESCE(oa.def_corr,  oa.def_sum,  0)
                    )
                    ELSE 0
                END) AS qty_in
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            LEFT JOIN ops_agg oa ON oa.line_id = l.id
            WHERE {line_where}
            GROUP BY l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id, l.storage_zone_id
        ),
        shipped AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id, slz.storage_zone_id,
                   sd.cargo_type, SUM(slz.qty) AS shipped_qty
            FROM shipment_line_zones slz
            JOIN shipment_lines sl ON sl.id = slz.line_id
            JOIN shipment_docs sd  ON sd.id = slz.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0 AND sd.status = 'shipped'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id, slz.storage_zone_id, sd.cargo_type
        )
        SELECT g.loc_id AS location_id, g.loc_name AS location_name, 'good' AS status,
               g.product_id, g.product_sku, g.client_id, g.color_id, g.size_id,
               g.product_name, g.client_name, g.color_name, g.size_name,
               GREATEST(0, g.qty_in - COALESCE(s.shipped_qty, 0)) AS qty
        FROM good_agg g
        LEFT JOIN shipped s
            ON s.cargo_type = 'good'
           AND s.product_id = g.product_id
           AND s.client_id  IS NOT DISTINCT FROM g.client_id
           AND s.color_id   IS NOT DISTINCT FROM g.color_id
           AND s.size_id    IS NOT DISTINCT FROM g.size_id
           AND s.storage_zone_id IS NOT DISTINCT FROM g.loc_id

        UNION ALL

        SELECT df.loc_id, df.loc_name, 'defect',
               df.product_id, df.product_sku, df.client_id, df.color_id, df.size_id,
               df.product_name, df.client_name, df.color_name, df.size_name,
               GREATEST(0, df.qty_in - COALESCE(s.shipped_qty, 0))
        FROM defect_agg df
        LEFT JOIN shipped s
            ON s.cargo_type = 'defect'
           AND s.product_id = df.product_id
           AND s.client_id  IS NOT DISTINCT FROM df.client_id
           AND s.color_id   IS NOT DISTINCT FROM df.color_id
           AND s.size_id    IS NOT DISTINCT FROM df.size_id
           AND s.storage_zone_id IS NOT DISTINCT FROM df.loc_id

        UNION ALL

        SELECT loc_id, loc_name, 'on_review',
               product_id, product_sku, client_id, color_id, size_id,
               product_name, client_name, color_name, size_name,
               qty_in
        FROM review_agg
    """

    rows = connection.execute(
        f"""
        SELECT * FROM ({agg_query}) a
        WHERE qty > 0
        ORDER BY location_name IS NULL, location_name, status, product_name, color_name, size_name
        LIMIT 2000
        """,
        line_params * 3,
    ).fetchall()

    items = [
        BalanceZoneItem(
            location_id=row["location_id"],
            location_name=row["location_name"],
            status=str(row["status"]),
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
    return BalanceZonesResponse(items=items)


def get_available_good_qty_by_zone(
    connection,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
    storage_zone_id: str | None,
) -> int:
    """Доступное годное по конкретной зоне: приход в зону минус отгрузка из зоны.

    Используется при проверке отгрузки (ready → shipped) для строк с распределением по зонам.
    """
    in_conds = [
        "l.is_deleted = 0", "d.is_deleted = 0",
        "d.status IN ('done', 'on_review')",
        "l.product_id = ?",
    ]
    in_params: list = [product_id]

    # Годный лежит в COALESCE(good_zone, storage_zone) — место «годного» с откатом на «на проверке».
    for col, val in (
        ("l.color_id", color_id),
        ("l.size_id", size_id),
        ("COALESCE(l.good_zone_id, l.storage_zone_id)", storage_zone_id),
    ):
        if val is not None:
            in_conds.append(f"{col} = ?")
            in_params.append(val)
        else:
            in_conds.append(f"{col} IS NULL")

    if client_id is not None:
        in_conds.append("d.client_id = ?")
        in_params.append(client_id)

    in_where = " AND ".join(in_conds)

    in_row = connection.execute(
        f"""
        WITH matched_lines AS (
            SELECT l.id
            FROM receipt_lines l
            JOIN receipt_docs d ON d.id = l.doc_id
            WHERE {in_where}
        ),
        ops_agg AS (
            SELECT
                o.line_id,
                MAX(CASE WHEN o.op_type = 'receiving_correction' THEN o.qty      END) AS recv_corr,
                SUM(CASE WHEN o.op_type = 'receiving'            THEN o.qty ELSE 0 END) AS recv_sum
            FROM receipt_ops o
            WHERE o.line_id IN (SELECT id FROM matched_lines)
            GROUP BY o.line_id
        )
        SELECT COALESCE(SUM(COALESCE(oa.recv_corr, oa.recv_sum, 0)), 0) AS good_in
        FROM matched_lines ml
        LEFT JOIN ops_agg oa ON oa.line_id = ml.id
        """,
        in_params,
    ).fetchone()
    good_in = int(in_row["good_in"]) if in_row else 0

    out_conds = [
        "sl.is_deleted = 0", "sd.is_deleted = 0",
        "sd.status = 'shipped'", "sd.cargo_type = 'good'",
        "sl.product_id = ?",
    ]
    out_params: list = [product_id]

    for col, val in (("sl.color_id", color_id), ("sl.size_id", size_id), ("slz.storage_zone_id", storage_zone_id)):
        if val is not None:
            out_conds.append(f"{col} = ?")
            out_params.append(val)
        else:
            out_conds.append(f"{col} IS NULL")

    out_where = " AND ".join(out_conds)

    out_row = connection.execute(
        f"""
        SELECT COALESCE(SUM(slz.qty), 0) AS shipped
        FROM shipment_line_zones slz
        JOIN shipment_lines sl ON sl.id = slz.line_id
        JOIN shipment_docs sd  ON sd.id = slz.doc_id
        WHERE {out_where}
        """,
        out_params,
    ).fetchone()
    shipped = int(out_row["shipped"]) if out_row else 0

    return max(0, good_in - shipped)


def get_available_good_qty(
    connection,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
) -> int:
    """Возвращает доступное кол-во годного товара для конкретной позиции.

    Используется shipments/service.py перед переводом в статус 'shipped'.
    """
    in_conds = [
        "l.is_deleted = 0", "d.is_deleted = 0",
        "d.status IN ('done', 'on_review')",
        "l.product_id = ?",
    ]
    in_params: list = [product_id]

    if color_id is not None:
        in_conds.append("l.color_id = ?")
        in_params.append(color_id)
    else:
        in_conds.append("l.color_id IS NULL")

    if size_id is not None:
        in_conds.append("l.size_id = ?")
        in_params.append(size_id)
    else:
        in_conds.append("l.size_id IS NULL")

    if client_id is not None:
        in_conds.append("d.client_id = ?")
        in_params.append(client_id)

    in_where = " AND ".join(in_conds)

    in_row = connection.execute(
        f"""
        WITH matched_lines AS (
            SELECT l.id
            FROM receipt_lines l
            JOIN receipt_docs d ON d.id = l.doc_id
            WHERE {in_where}
        ),
        ops_agg AS (
            SELECT
                o.line_id,
                MAX(CASE WHEN o.op_type = 'receiving_correction' THEN o.qty      END) AS recv_corr,
                SUM(CASE WHEN o.op_type = 'receiving'            THEN o.qty ELSE 0 END) AS recv_sum
            FROM receipt_ops o
            WHERE o.line_id IN (SELECT id FROM matched_lines)
            GROUP BY o.line_id
        )
        SELECT COALESCE(SUM(COALESCE(oa.recv_corr, oa.recv_sum, 0)), 0) AS good_in
        FROM matched_lines ml
        LEFT JOIN ops_agg oa ON oa.line_id = ml.id
        """,
        in_params,
    ).fetchone()
    good_in = int(in_row["good_in"]) if in_row else 0

    out_conds = [
        "sl.is_deleted = 0", "sd.is_deleted = 0",
        "sd.status = 'shipped'", "sd.cargo_type = 'good'",
        "sl.product_id = ?",
    ]
    out_params: list = [product_id]

    if color_id is not None:
        out_conds.append("sl.color_id = ?")
        out_params.append(color_id)
    else:
        out_conds.append("sl.color_id IS NULL")

    if size_id is not None:
        out_conds.append("sl.size_id = ?")
        out_params.append(size_id)
    else:
        out_conds.append("sl.size_id IS NULL")

    out_where = " AND ".join(out_conds)

    out_row = connection.execute(
        f"""
        SELECT COALESCE(SUM(sl.qty), 0) AS shipped
        FROM shipment_lines sl
        JOIN shipment_docs sd ON sd.id = sl.doc_id
        WHERE {out_where}
        """,
        out_params,
    ).fetchone()
    shipped = int(out_row["shipped"]) if out_row else 0

    return max(0, good_in - shipped)
