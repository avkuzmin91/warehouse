from __future__ import annotations

from modules.balances.schemas import (
    BalanceItem,
    BalanceListResponse,
    BalanceZoneItem,
    BalanceZonesResponse,
)

# Единая модель остатков (после перехода на журнал zone_relocations):
#   on_review = Σ accepted_qty (поступления done) − Σ конвертаций on_review→good/defect
#   good      = Σ конвертаций →good   − отгружено(good)
#   defect    = Σ конвертаций →defect − отгружено(defect)
# Конвертации и перемещения живут в zone_relocations: перемещение — from_status=to_status,
# QC-конвертация упаковкой — from_status='on_review', to_status='good'|'defect'.

_SHIPPED_QTY = "COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty)"


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
    line_conds = ["l.is_deleted = 0", "d.is_deleted = 0", "d.status = 'done'"]
    line_params: list = []
    if client_id:
        line_conds.append("d.client_id = ?")
        line_params.append(client_id.strip())
    if search:
        s = f"%{search.strip()}%"
        line_conds.append("(l.product_name LIKE ? OR l.product_sku LIKE ?)")
        line_params += [s, s]
    line_where = " AND ".join(line_conds)

    agg_query = f"""
        WITH accepted AS (
            SELECT
                l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id,
                MAX(l.product_name) AS product_name, MAX(cl.name) AS client_name,
                MAX(l.color_name)   AS color_name, MAX(l.size_name) AS size_name,
                SUM(COALESCE(l.accepted_qty, 0)) AS accepted,
                COUNT(DISTINCT l.doc_id) AS docs_count
            FROM receipt_lines l
            JOIN receipt_docs d  ON d.id = l.doc_id
            LEFT JOIN clients cl ON cl.id = d.client_id
            WHERE {line_where}
            GROUP BY l.product_id, l.product_sku, d.client_id, l.color_id, l.size_id
        ),
        conv AS (
            -- net по статусу = приход в статус − уход из статуса (перемещения нетятся в 0,
            -- конвертации и коррекции учитываются в обе стороны).
            SELECT product_id, client_id, color_id, size_id,
                   SUM(CASE WHEN to_status='good'   THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_status='good'   THEN qty ELSE 0 END) AS conv_good,
                   SUM(CASE WHEN to_status='defect' THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_status='defect' THEN qty ELSE 0 END) AS conv_defect,
                   SUM(CASE WHEN to_status='on_review' THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_status='on_review' THEN qty ELSE 0 END) AS net_review,
                   SUM(CASE WHEN to_status='on_packing' THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_status='on_packing' THEN qty ELSE 0 END) AS net_packing
            FROM zone_relocations
            GROUP BY product_id, client_id, color_id, size_id
        ),
        shipped_good AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id,
                   SUM({_SHIPPED_QTY}) AS shipped_good
            FROM shipment_lines sl
            JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0
              AND sd.status = 'shipped' AND sd.cargo_type = 'good'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id
        ),
        shipped_defect AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id,
                   SUM({_SHIPPED_QTY}) AS shipped_defect
            FROM shipment_lines sl
            JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0
              AND sd.status = 'shipped' AND sd.cargo_type = 'defect'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id
        )
        SELECT
            a.product_id, a.product_sku, a.client_id, a.color_id, a.size_id,
            a.product_name, a.client_name, a.color_name, a.size_name,
            GREATEST(0, COALESCE(c.conv_good, 0)   - COALESCE(sg.shipped_good, 0))   AS good,
            GREATEST(0, COALESCE(c.conv_defect, 0) - COALESCE(sd.shipped_defect, 0)) AS defect,
            GREATEST(0, a.accepted + COALESCE(c.net_review, 0)) AS on_review,
            GREATEST(0, COALESCE(c.net_packing, 0)) AS on_packing,
            a.docs_count
        FROM accepted a
        LEFT JOIN conv c
            ON c.product_id = a.product_id
           AND c.client_id  IS NOT DISTINCT FROM a.client_id
           AND c.color_id   IS NOT DISTINCT FROM a.color_id
           AND c.size_id    IS NOT DISTINCT FROM a.size_id
        LEFT JOIN shipped_good sg
            ON sg.product_id = a.product_id
           AND sg.client_id  IS NOT DISTINCT FROM a.client_id
           AND sg.color_id   IS NOT DISTINCT FROM a.color_id
           AND sg.size_id    IS NOT DISTINCT FROM a.size_id
        LEFT JOIN shipped_defect sd
            ON sd.product_id = a.product_id
           AND sd.client_id  IS NOT DISTINCT FROM a.client_id
           AND sd.color_id   IS NOT DISTINCT FROM a.color_id
           AND sd.size_id    IS NOT DISTINCT FROM a.size_id
    """

    where_parts = []
    if only_positive:
        where_parts.append("(good + defect + on_review + on_packing) > 0")
    if has_defect:
        where_parts.append("defect > 0")
    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT *, COUNT(*) OVER() AS _total_count
        FROM ({agg_query}) a
        {where_clause}
        ORDER BY (good + defect + on_review + on_packing) DESC, product_name, color_name, size_name
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
            on_packing=int(row["on_packing"] or 0),
            total=int(row["good"] or 0) + int(row["defect"] or 0) + int(row["on_review"] or 0) + int(row["on_packing"] or 0),
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

    Единый журнал zone_relocations:
      - good@место   = Σ конвертаций →good в место − отгрузка из места + перемещения_в − перемещения_из
      - defect@место = аналогично
      - on_review@место = Σ accepted_qty в месте приёмки − конвертации из места + перемещения_in/out
    """
    line_conds = ["l.is_deleted = 0", "d.is_deleted = 0", "d.status = 'done'"]
    line_params: list = []
    if client_id:
        line_conds.append("d.client_id = ?")
        line_params.append(client_id.strip())
    if search:
        s = f"%{search.strip()}%"
        line_conds.append("(l.product_name LIKE ? OR l.product_sku LIKE ?)")
        line_params += [s, s]
    line_where = " AND ".join(line_conds)

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
            WHERE {line_where}
            GROUP BY l.product_id, d.client_id, l.color_id, l.size_id
        ),
        accepted_inflow AS (
            SELECT l.product_id, d.client_id, l.color_id, l.size_id,
                   l.storage_zone_id AS loc_id,
                   SUM(COALESCE(l.accepted_qty, 0)) AS qty_in
            FROM receipt_lines l
            JOIN receipt_docs d ON d.id = l.doc_id
            WHERE {line_where}
            GROUP BY l.product_id, d.client_id, l.color_id, l.size_id, l.storage_zone_id
        ),
        gain AS (
            SELECT product_id, client_id, color_id, size_id, to_zone_id AS loc_id, to_status AS status, SUM(qty) AS qty
            FROM zone_relocations
            GROUP BY product_id, client_id, color_id, size_id, to_zone_id, to_status
        ),
        lose AS (
            SELECT product_id, client_id, color_id, size_id, from_zone_id AS loc_id, from_status AS status, SUM(qty) AS qty
            FROM zone_relocations
            GROUP BY product_id, client_id, color_id, size_id, from_zone_id, from_status
        ),
        shipped_good AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id,
                   sl.storage_zone_id AS loc_id, SUM({_SHIPPED_QTY}) AS qty
            FROM shipment_lines sl
            JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0 AND sd.status = 'shipped' AND sd.cargo_type = 'good'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id, sl.storage_zone_id
        ),
        shipped_defect AS (
            SELECT sl.product_id, sd.client_id, sl.color_id, sl.size_id,
                   sl.storage_zone_id AS loc_id, SUM({_SHIPPED_QTY}) AS qty
            FROM shipment_lines sl
            JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.is_deleted = 0 AND sd.is_deleted = 0 AND sd.status = 'shipped' AND sd.cargo_type = 'defect'
            GROUP BY sl.product_id, sd.client_id, sl.color_id, sl.size_id, sl.storage_zone_id
        ),
        good_locs AS (
            SELECT product_id, client_id, color_id, size_id, loc_id FROM gain WHERE status = 'good'
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM lose WHERE status = 'good'
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM shipped_good
        ),
        defect_locs AS (
            SELECT product_id, client_id, color_id, size_id, loc_id FROM gain WHERE status = 'defect'
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM lose WHERE status = 'defect'
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM shipped_defect
        ),
        review_locs AS (
            SELECT product_id, client_id, color_id, size_id, loc_id FROM accepted_inflow
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM gain WHERE status = 'on_review'
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM lose WHERE status = 'on_review'
        ),
        packing_locs AS (
            SELECT product_id, client_id, color_id, size_id, loc_id FROM gain WHERE status = 'on_packing'
            UNION SELECT product_id, client_id, color_id, size_id, loc_id FROM lose WHERE status = 'on_packing'
        )
        SELECT x.loc_id AS location_id, 'good' AS status,
               pm.product_id, pm.product_sku, pm.client_id, pm.color_id, pm.size_id,
               pm.product_name, pm.client_name, pm.color_name, pm.size_name,
               GREATEST(0, COALESCE(gi.qty, 0) - COALESCE(lo.qty, 0) - COALESCE(sg.qty, 0)) AS qty
        FROM good_locs x
        JOIN position_meta pm ON {pos_join}
        LEFT JOIN gain gi ON {_term_join('gi')} AND gi.status = 'good'
        LEFT JOIN lose lo ON {_term_join('lo')} AND lo.status = 'good'
        LEFT JOIN shipped_good sg ON {_term_join('sg')}

        UNION ALL

        SELECT x.loc_id, 'defect',
               pm.product_id, pm.product_sku, pm.client_id, pm.color_id, pm.size_id,
               pm.product_name, pm.client_name, pm.color_name, pm.size_name,
               GREATEST(0, COALESCE(gi.qty, 0) - COALESCE(lo.qty, 0) - COALESCE(sd.qty, 0))
        FROM defect_locs x
        JOIN position_meta pm ON {pos_join}
        LEFT JOIN gain gi ON {_term_join('gi')} AND gi.status = 'defect'
        LEFT JOIN lose lo ON {_term_join('lo')} AND lo.status = 'defect'
        LEFT JOIN shipped_defect sd ON {_term_join('sd')}

        UNION ALL

        SELECT x.loc_id, 'on_review',
               pm.product_id, pm.product_sku, pm.client_id, pm.color_id, pm.size_id,
               pm.product_name, pm.client_name, pm.color_name, pm.size_name,
               GREATEST(0, COALESCE(ai.qty_in, 0) + COALESCE(gi.qty, 0) - COALESCE(lo.qty, 0))
        FROM review_locs x
        JOIN position_meta pm ON {pos_join}
        LEFT JOIN accepted_inflow ai ON {_term_join('ai')}
        LEFT JOIN gain gi ON {_term_join('gi')} AND gi.status = 'on_review'
        LEFT JOIN lose lo ON {_term_join('lo')} AND lo.status = 'on_review'

        UNION ALL

        SELECT x.loc_id, 'on_packing',
               pm.product_id, pm.product_sku, pm.client_id, pm.color_id, pm.size_id,
               pm.product_name, pm.client_name, pm.color_name, pm.size_name,
               GREATEST(0, COALESCE(gi.qty, 0) - COALESCE(lo.qty, 0))
        FROM packing_locs x
        JOIN position_meta pm ON {pos_join}
        LEFT JOIN gain gi ON {_term_join('gi')} AND gi.status = 'on_packing'
        LEFT JOIN lose lo ON {_term_join('lo')} AND lo.status = 'on_packing'
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
            b.status,
            b.product_name,
            b.color_name,
            b.size_name
        LIMIT 2000
        """,
        line_params * 2,
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


def insert_inventory_move(
    connection,
    *,
    product_id: str, product_name: str | None, product_sku: str | None,
    color_id: str | None, color_name: str | None,
    size_id: str | None, size_name: str | None,
    client_id: str | None, client_name: str | None,
    from_status: str, to_status: str,
    from_zone_id: str | None, from_zone_name: str | None,
    to_zone_id: str | None, to_zone_name: str | None,
    qty: int, user_id: str | None,
    shipment_line_id: str | None = None, comment: str | None = None,
    packed_date: str | None = None, pack_entry_id: str | None = None,
    reverses_id: str | None = None,
) -> None:
    """Append-only запись в единый журнал движений. Без commit — коммитит вызывающий.

    Покрывает перемещение (from_status=to_status), подготовку к упаковке
    (on_review→on_review со сменой зоны) и QC-конвертацию (on_review→good/defect).
    Легаси-колонка status = to_status (для NOT NULL до итерации 2).
    packed_date/pack_entry_id/reverses_id заполняются только для QC-упаковки.
    """
    from datetime import UTC, datetime
    from uuid import uuid4

    connection.execute(
        """INSERT INTO zone_relocations
           (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
            client_id,client_name,from_status,to_status,
            from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by,shipment_line_id,
            packed_date,pack_entry_id,reverses_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), product_id, product_name, product_sku, color_id, color_name, size_id, size_name,
         client_id, client_name, from_status, to_status,
         from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment,
         datetime.now(UTC).isoformat(), user_id, shipment_line_id,
         packed_date, pack_entry_id, reverses_id),
    )


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
    """Доступное кол-во статуса good|defect|on_review в конкретном месте (единый журнал).

    good/defect@место   = конвертации →status в место − отгрузка из места + перемещения_in − перемещения_out
    on_review@место     = accepted_qty в месте приёмки − конвертации из места + перемещения_in − перемещения_out
    """
    def _pos(prefix: str, client_col: str) -> tuple[str, list]:
        conds: list[str] = []
        params: list = []
        for col, val in (
            (f"{prefix}product_id", product_id),
            (f"{prefix}color_id", color_id),
            (f"{prefix}size_id", size_id),
            (client_col, client_id),
        ):
            cond, p = _eq_or_null(col, val)
            conds.append(cond)
            params += p
        return " AND ".join(conds), params

    def _move_sum(status_col: str, status_val: str, zone_col: str) -> int:
        pos_sql, pos_params = _pos("", "client_id")
        zcond, zp = _eq_or_null(zone_col, zone_id)
        row = connection.execute(
            f"SELECT COALESCE(SUM(qty), 0) AS s FROM zone_relocations "
            f"WHERE {status_col} = ? AND {pos_sql} AND {zcond}",
            [status_val] + pos_params + zp,
        ).fetchone()
        return int(row["s"]) if row else 0

    if status in ("good", "defect"):
        gain = _move_sum("to_status", status, "to_zone_id")
        lose = _move_sum("from_status", status, "from_zone_id")
        out_pos, out_params = _pos("sl.", "sd.client_id")
        scond, sp = _eq_or_null("sl.storage_zone_id", zone_id)
        out_row = connection.execute(
            f"""SELECT COALESCE(SUM({_SHIPPED_QTY}), 0) AS shipped
                FROM shipment_lines sl JOIN shipment_docs sd ON sd.id = sl.doc_id
                WHERE sl.is_deleted = 0 AND sd.is_deleted = 0
                  AND sd.status = 'shipped' AND sd.cargo_type = ? AND {out_pos} AND {scond}""",
            [status] + out_params + sp,
        ).fetchone()
        shipped = int(out_row["shipped"]) if out_row else 0
        return max(0, gain - lose - shipped)

    if status == "on_review":
        in_pos, in_params = _pos("l.", "d.client_id")
        zcond, zp = _eq_or_null("l.storage_zone_id", zone_id)
        in_row = connection.execute(
            f"""SELECT COALESCE(SUM(COALESCE(l.accepted_qty, 0)), 0) AS inflow
                FROM receipt_lines l JOIN receipt_docs d ON d.id = l.doc_id
                WHERE l.is_deleted = 0 AND d.is_deleted = 0 AND d.status = 'done'
                  AND {in_pos} AND {zcond}""",
            in_params + zp,
        ).fetchone()
        inflow = int(in_row["inflow"]) if in_row else 0
        gain = _move_sum("to_status", "on_review", "to_zone_id")
        lose = _move_sum("from_status", "on_review", "from_zone_id")
        return max(0, inflow + gain - lose)

    if status == "on_packing":
        # Только через перемещения (нет accepted-прихода, нет отгрузки).
        gain = _move_sum("to_status", "on_packing", "to_zone_id")
        lose = _move_sum("from_status", "on_packing", "from_zone_id")
        return max(0, gain - lose)

    return 0


def get_available_good_qty_by_zone(
    connection,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
    storage_zone_id: str | None,
) -> int:
    """Доступное годное по месту. Тонкая обёртка. Используется при отгрузке (packing → shipped)."""
    return get_available_in_zone(
        connection,
        product_id=product_id,
        color_id=color_id,
        size_id=size_id,
        client_id=client_id,
        zone_id=storage_zone_id,
        status="good",
    )


def get_available_good_qty(
    connection,
    product_id: str,
    color_id: str | None,
    size_id: str | None,
    client_id: str | None,
) -> int:
    """Доступное годное по позиции (без места): конвертации →good − отгружено(good).

    Используется shipments/service.py перед переводом в статус 'shipped'.
    """
    conds = ["product_id = ?"]
    params: list = [product_id]
    for col, val in (("color_id", color_id), ("size_id", size_id), ("client_id", client_id)):
        cond, p = _eq_or_null(col, val)
        conds.append(cond)
        params += p
    conv_row = connection.execute(
        f"""SELECT COALESCE(SUM(CASE WHEN to_status='good'   THEN qty ELSE 0 END), 0)
                 - COALESCE(SUM(CASE WHEN from_status='good' THEN qty ELSE 0 END), 0) AS conv_good
            FROM zone_relocations WHERE {' AND '.join(conds)}""",
        params,
    ).fetchone()
    conv_good = int(conv_row["conv_good"]) if conv_row else 0

    out_conds = ["sl.is_deleted = 0", "sd.is_deleted = 0", "sd.status = 'shipped'", "sd.cargo_type = 'good'", "sl.product_id = ?"]
    out_params: list = [product_id]
    for col, val in (("sl.color_id", color_id), ("sl.size_id", size_id), ("sd.client_id", client_id)):
        cond, p = _eq_or_null(col, val)
        out_conds.append(cond)
        out_params += p
    out_row = connection.execute(
        f"SELECT COALESCE(SUM({_SHIPPED_QTY}), 0) AS shipped "
        f"FROM shipment_lines sl JOIN shipment_docs sd ON sd.id = sl.doc_id WHERE {' AND '.join(out_conds)}",
        out_params,
    ).fetchone()
    shipped = int(out_row["shipped"]) if out_row else 0

    return max(0, conv_good - shipped)


def create_zone_relocation(connection, payload, user_id: str) -> None:
    """Записывает перемещение товара между местами (append-only журнал zone_relocations)."""
    from datetime import UTC, datetime
    from uuid import uuid4

    from fastapi import HTTPException

    if payload.status not in ("good", "defect", "on_review"):
        raise HTTPException(status_code=400, detail="Перемещать можно только годный, брак или товар на проверке")

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
            client_id,client_name,from_status,to_status,
            from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), payload.product_id, payload.product_name, payload.product_sku,
         payload.color_id, payload.color_name, payload.size_id, payload.size_name,
         payload.client_id, payload.client_name, payload.status, payload.status,
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
            status=str(row["to_status"]),
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
