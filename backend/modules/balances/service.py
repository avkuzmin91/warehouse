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
    shipped_qty_expr = "COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty)"

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
                   SUM({shipped_qty_expr}) AS shipped_good
            FROM shipment_lines sl
            JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0
              AND sd.status = 'shipped' AND sd.cargo_type = 'good'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id
        ),
        shipped_defect AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id,
                   SUM({shipped_qty_expr}) AS shipped_defect
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
        ORDER BY (good + defect + on_review) DESC, product_name, color_name, size_name
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
    Отгрузка вычитается из shipment_lines.storage_zone_id по выбранному при отгрузке месту.

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

    # line_where встречается 4 раза (position_meta, good_inflow, defect_inflow, review_agg)
    # → line_params повторяется 4 раза.
    # recv_corr/def_corr — последнее значение correction по created_at (не MAX qty).
    # good/defect: qty = приход − отгрузка + перемещения_в − перемещения_из (вариант B).
    # «Вселенная мест» (good_locs/defect_locs) = места из прихода ∪ отгрузки ∪ перемещений,
    # чтобы место-получатель без поступлений тоже попало в остаток.
    shipped_qty_expr = "COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty)"
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
        position_meta AS (
            SELECT
                l.product_id, d.client_id, l.color_id, l.size_id,
                MAX(l.product_sku)  AS product_sku,
                MAX(l.product_name) AS product_name, MAX(cl.name) AS client_name,
                MAX(l.color_name)   AS color_name, MAX(l.size_name) AS size_name
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE {line_where}
            GROUP BY l.product_id, d.client_id, l.color_id, l.size_id
        ),
        good_inflow AS (
            SELECT l.product_id, d.client_id, l.color_id, l.size_id,
                   COALESCE(l.good_zone_id, l.storage_zone_id) AS loc_id,
                   SUM(COALESCE(oa.recv_corr, oa.recv_sum, 0)) AS qty_in
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN ops_agg oa ON oa.line_id = l.id
            WHERE {line_where}
            GROUP BY l.product_id, d.client_id, l.color_id, l.size_id,
                     COALESCE(l.good_zone_id, l.storage_zone_id)
        ),
        defect_inflow AS (
            SELECT l.product_id, d.client_id, l.color_id, l.size_id,
                   COALESCE(l.defect_zone_id, l.storage_zone_id) AS loc_id,
                   SUM(COALESCE(oa.def_corr, oa.def_sum, 0)) AS qty_in
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN ops_agg oa ON oa.line_id = l.id
            WHERE {line_where}
            GROUP BY l.product_id, d.client_id, l.color_id, l.size_id,
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
        shipped_good AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id,
                   sl.storage_zone_id AS loc_id, SUM({shipped_qty_expr}) AS qty
            FROM shipment_lines sl
            JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0 AND sd.status = 'shipped' AND sd.cargo_type = 'good'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id, sl.storage_zone_id
        ),
        shipped_defect AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id,
                   sl.storage_zone_id AS loc_id, SUM({shipped_qty_expr}) AS qty
            FROM shipment_lines sl
            JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0 AND sd.status = 'shipped' AND sd.cargo_type = 'defect'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id, sl.storage_zone_id
        ),
        reloc_in_good AS (
            SELECT product_id, client_id, color_id, size_id, to_zone_id AS loc_id, SUM(qty) AS qty
            FROM zone_relocations WHERE status = 'good'
            GROUP BY product_id, client_id, color_id, size_id, to_zone_id
        ),
        reloc_out_good AS (
            SELECT product_id, client_id, color_id, size_id, from_zone_id AS loc_id, SUM(qty) AS qty
            FROM zone_relocations WHERE status = 'good'
            GROUP BY product_id, client_id, color_id, size_id, from_zone_id
        ),
        reloc_in_defect AS (
            SELECT product_id, client_id, color_id, size_id, to_zone_id AS loc_id, SUM(qty) AS qty
            FROM zone_relocations WHERE status = 'defect'
            GROUP BY product_id, client_id, color_id, size_id, to_zone_id
        ),
        reloc_out_defect AS (
            SELECT product_id, client_id, color_id, size_id, from_zone_id AS loc_id, SUM(qty) AS qty
            FROM zone_relocations WHERE status = 'defect'
            GROUP BY product_id, client_id, color_id, size_id, from_zone_id
        ),
        good_locs AS (
            SELECT product_id, client_id, color_id, size_id, loc_id FROM good_inflow
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM shipped_good
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM reloc_in_good
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM reloc_out_good
        ),
        defect_locs AS (
            SELECT product_id, client_id, color_id, size_id, loc_id FROM defect_inflow
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM shipped_defect
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM reloc_in_defect
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM reloc_out_defect
        )
        SELECT x.loc_id AS location_id, NULL AS location_name, 'good' AS status,
               pm.product_id, pm.product_sku, pm.client_id, pm.color_id, pm.size_id,
               pm.product_name, pm.client_name, pm.color_name, pm.size_name,
               GREATEST(0, COALESCE(gi.qty_in, 0) - COALESCE(sg.qty, 0)
                           + COALESCE(ri.qty, 0) - COALESCE(ro.qty, 0)) AS qty
        FROM good_locs x
        JOIN position_meta pm ON {pos_join}
        LEFT JOIN good_inflow    gi ON {_term_join('gi')}
        LEFT JOIN shipped_good   sg ON {_term_join('sg')}
        LEFT JOIN reloc_in_good  ri ON {_term_join('ri')}
        LEFT JOIN reloc_out_good ro ON {_term_join('ro')}

        UNION ALL

        SELECT x.loc_id, NULL, 'defect',
               pm.product_id, pm.product_sku, pm.client_id, pm.color_id, pm.size_id,
               pm.product_name, pm.client_name, pm.color_name, pm.size_name,
               GREATEST(0, COALESCE(di.qty_in, 0) - COALESCE(sd.qty, 0)
                           + COALESCE(ri.qty, 0) - COALESCE(ro.qty, 0))
        FROM defect_locs x
        JOIN position_meta pm ON {pos_join}
        LEFT JOIN defect_inflow    di ON {_term_join('di')}
        LEFT JOIN shipped_defect   sd ON {_term_join('sd')}
        LEFT JOIN reloc_in_defect  ri ON {_term_join('ri')}
        LEFT JOIN reloc_out_defect ro ON {_term_join('ro')}

        UNION ALL

        SELECT loc_id, loc_name, 'on_review',
               product_id, product_sku, client_id, color_id, size_id,
               product_name, client_name, color_name, size_name,
               qty_in
        FROM review_agg
    """

    rows = connection.execute(
        f"""
        SELECT *
        FROM (
            SELECT
                a.*,
                COALESCE(uz.name, a.location_name) AS actual_location_name
            FROM ({agg_query}) a
            LEFT JOIN unloading_zones uz ON uz.id = a.location_id
        ) b
        WHERE b.qty > 0
        ORDER BY
            b.actual_location_name IS NULL,
            b.actual_location_name,
            b.qty DESC,
            b.status,
            b.product_name,
            b.color_name,
            b.size_name
        LIMIT 2000
        """,
        line_params * 4,
    ).fetchall()

    items = [
        BalanceZoneItem(
            location_id=row["location_id"],
            location_name=row["actual_location_name"],
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


def _eq_or_null(col: str, val) -> tuple[str, list]:
    return (f"{col} = ?", [val]) if val is not None else (f"{col} IS NULL", [])


def get_available_in_zone(
    connection,
    *,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
    zone_id: str | None,
    status: str,
) -> int:
    """Доступное кол-во принятого товара статуса good|defect в конкретном месте.

    = приход в место − отгрузка из места + перемещения_в − перемещения_из.
    Используется при валидации перемещения и при проверке отгрузки (через
    get_available_good_qty_by_zone).
    """
    good = status == "good"
    inflow_zone_col = (
        "COALESCE(l.good_zone_id, l.storage_zone_id)" if good
        else "COALESCE(l.defect_zone_id, l.storage_zone_id)"
    )
    corr_type = "receiving_correction" if good else "defect_correction"
    sum_type = "receiving" if good else "defect_fix"

    # --- Приход в место ---
    in_conds = ["l.is_deleted = 0", "d.is_deleted = 0", "d.status IN ('done', 'on_review')", "l.product_id = ?"]
    in_params: list = [product_id]
    for col, val in (("l.color_id", color_id), ("l.size_id", size_id), (inflow_zone_col, zone_id), ("d.client_id", client_id)):
        cond, p = _eq_or_null(col, val)
        in_conds.append(cond)
        in_params += p
    in_where = " AND ".join(in_conds)
    in_row = connection.execute(
        f"""
        WITH matched_lines AS (
            SELECT l.id FROM receipt_lines l JOIN receipt_docs d ON d.id = l.doc_id WHERE {in_where}
        ),
        ops_agg AS (
            SELECT o.line_id,
                (SELECT o2.qty FROM receipt_ops o2
                 WHERE o2.line_id = o.line_id AND o2.op_type = '{corr_type}'
                 ORDER BY o2.created_at DESC LIMIT 1) AS corr,
                SUM(CASE WHEN o.op_type = '{sum_type}' THEN o.qty ELSE 0 END) AS sm
            FROM receipt_ops o
            WHERE o.line_id IN (SELECT id FROM matched_lines)
            GROUP BY o.line_id
        )
        SELECT COALESCE(SUM(COALESCE(oa.corr, oa.sm, 0)), 0) AS inflow
        FROM matched_lines ml LEFT JOIN ops_agg oa ON oa.line_id = ml.id
        """,
        in_params,
    ).fetchone()
    inflow = int(in_row["inflow"]) if in_row else 0

    # --- Отгрузка из места ---
    out_conds = ["sl.is_deleted = 0", "sd.is_deleted = 0", "sd.status = 'shipped'", f"sd.cargo_type = '{status}'", "sl.product_id = ?"]
    out_params: list = [product_id]
    for col, val in (("sl.color_id", color_id), ("sl.size_id", size_id), ("sl.storage_zone_id", zone_id), ("sd.client_id", client_id)):
        cond, p = _eq_or_null(col, val)
        out_conds.append(cond)
        out_params += p
    out_row = connection.execute(
        f"""
        SELECT COALESCE(SUM(COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty)), 0) AS shipped
        FROM shipment_lines sl JOIN shipment_docs sd ON sd.id = sl.doc_id
        WHERE {" AND ".join(out_conds)}
        """,
        out_params,
    ).fetchone()
    shipped = int(out_row["shipped"]) if out_row else 0

    # --- Перемещения в/из места ---
    def _reloc(zone_col: str) -> int:
        conds = ["status = ?", "product_id = ?"]
        params: list = [status, product_id]
        for col, val in (("color_id", color_id), ("size_id", size_id), ("client_id", client_id), (zone_col, zone_id)):
            cond, p = _eq_or_null(col, val)
            conds.append(cond)
            params += p
        row = connection.execute(
            f"SELECT COALESCE(SUM(qty), 0) AS s FROM zone_relocations WHERE {' AND '.join(conds)}",
            params,
        ).fetchone()
        return int(row["s"]) if row else 0

    reloc_in = _reloc("to_zone_id")
    reloc_out = _reloc("from_zone_id")

    return max(0, inflow - shipped + reloc_in - reloc_out)


def get_available_good_qty_by_zone(
    connection,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
    storage_zone_id: str | None,
) -> int:
    """Доступное годное по месту (приход − отгрузка + перемещения). Тонкая обёртка.

    Используется при проверке отгрузки (packing → shipped).
    """
    return get_available_in_zone(
        connection,
        product_id=product_id,
        color_id=color_id,
        size_id=size_id,
        client_id=client_id,
        zone_id=storage_zone_id,
        status="good",
    )


def create_zone_relocation(connection, payload, user_id: str) -> None:
    """Записывает перемещение товара между местами (append-only журнал zone_relocations)."""
    from datetime import UTC, datetime
    from uuid import uuid4

    from fastapi import HTTPException

    if payload.status not in ("good", "defect"):
        raise HTTPException(status_code=400, detail="Перемещать можно только годный или брак")

    from_id = (payload.from_zone_id or "").strip() or None
    to_id = (payload.to_zone_id or "").strip() or None
    if from_id == to_id:
        raise HTTPException(status_code=400, detail="Выберите другое место назначения")

    available = get_available_in_zone(
        connection,
        product_id=payload.product_id,
        color_id=payload.color_id,
        size_id=payload.size_id,
        client_id=payload.client_id,
        zone_id=from_id,
        status=payload.status,
    )
    if available < payload.qty:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара в месте для перемещения (доступно {available}, нужно {payload.qty})",
        )

    def _zone_name(zone_id: str | None) -> str | None:
        if not zone_id:
            return None
        row = connection.execute("SELECT name FROM unloading_zones WHERE id = ?", (zone_id,)).fetchone()
        return str(row["name"]) if row else None

    now = datetime.now(UTC).isoformat()
    connection.execute(
        """INSERT INTO zone_relocations
           (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
            client_id,client_name,status,
            from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), payload.product_id, payload.product_name, payload.product_sku,
         payload.color_id, payload.color_name, payload.size_id, payload.size_name,
         payload.client_id, payload.client_name, payload.status,
         from_id, _zone_name(from_id), to_id, _zone_name(to_id), payload.qty,
         (payload.comment or "").strip() or None, now, user_id),
    )
    connection.commit()


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
        s = f"%{search.strip()}%"
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
            status=str(row["status"]),
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
        SELECT COALESCE(SUM(COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty)), 0) AS shipped
        FROM shipment_lines sl
        JOIN shipment_docs sd ON sd.id = sl.doc_id
        WHERE {out_where}
        """,
        out_params,
    ).fetchone()
    shipped = int(out_row["shipped"]) if out_row else 0

    return max(0, good_in - shipped)
