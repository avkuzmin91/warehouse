from __future__ import annotations

from modules.balances.schemas import BalanceItem, BalanceListResponse


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

    # ops_agg: один проход по receipt_ops вместо 6 коррелированных подзапросов на строку.
    # recv_corr/def_corr — последнее значение correction (MAX по qty при одной записи на линию).
    # on_review: строка ещё на QC, если qc_done_at IS NULL или reopen случился позже.
    agg_query = f"""
        WITH ops_agg AS (
            SELECT
                o.line_id,
                MAX(CASE WHEN o.op_type = 'receiving_correction' THEN o.qty      END) AS recv_corr,
                SUM(CASE WHEN o.op_type = 'receiving'            THEN o.qty ELSE 0 END) AS recv_sum,
                MAX(CASE WHEN o.op_type = 'defect_correction'    THEN o.qty      END) AS def_corr,
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
                        COALESCE(l.planned_qty, 0)
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
