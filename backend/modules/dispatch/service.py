from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException

from config import (
    DISPATCH_ALLOW_SHIP_FROM_PACKED,
    DISPATCH_CARGO_DEFECT,
    DISPATCH_CARGO_GOOD,
    DISPATCH_CARGO_GOOD_UNPACKED,
    DISPATCH_CARGO_TYPES,
    DISPATCH_OP_ADVANCE,
    DISPATCH_OP_CLOSE_SHORT,
    DISPATCH_OP_PREPARE,
    DISPATCH_OP_PRIORITY_UPDATE,
    DISPATCH_OP_RETURN,
    DISPATCH_RETURNABLE_STATUSES,
    DISPATCH_STATUS_AWAITING_PACKING,
    DISPATCH_STATUS_AWAITING_TRIP,
    DISPATCH_STATUS_CANCELLED,
    DISPATCH_STATUS_DRAFT,
    DISPATCH_STATUS_LABELS,
    DISPATCH_STATUS_PARTIALLY_SHIPPED,
    DISPATCH_STATUS_PREPARING,
    DISPATCH_STATUS_SHIPPED,
    DISPATCH_STATUSES_ALL,
    DISPATCH_TERMINAL_STATUSES,
    DISPATCH_TRIP_SELECTABLE_STATUSES,
    INVOICE_STATUS_CANCELLED,
    INVOICE_STATUS_DRAFT,
    INV_OP_PACKED,
    INV_OP_READY,
    INV_OP_SHIPPED,
    INV_OP_STORAGE,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    TRIP_STATUS_AWAITING_ARRIVAL,
    TRIP_STATUS_CANCELLED,
    TRIP_STATUS_DRAFT,
    TRIP_STATUS_UNLOADING,
)
from dbconn import ci_like_substring_param
from utils import next_doc_number as _next_doc_number, now_iso as _now



def next_doc_number(connection) -> str:
    """Следующий номер документа отгрузки клиенту (DSP-NNNN)."""
    return _next_doc_number(connection, table="dispatch_docs", prefix="DSP-", width=4)


def normalize_cargo_type(raw: str | None) -> str:
    s = str(raw or DISPATCH_CARGO_GOOD).strip().lower()
    return s if s in DISPATCH_CARGO_TYPES else DISPATCH_CARGO_GOOD


def _dup_key(product_id, color_id, size_id) -> tuple[str, str, str]:
    """Ключ строки для сравнения состава. NULL цвет/размер → ''."""
    return (str(product_id or ""), str(color_id or ""), str(size_id or ""))


def _moscow_day(iso: str | None) -> str:
    """Московская календарная дата из UTC-ISO (fallback, TZ контейнера = Europe/Moscow)."""
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone().date().isoformat()


def find_duplicate_dispatches(connection, *, client_id, cargo_type, ship_date, lines) -> list[dict]:
    """Отгрузки того же клиента и типа груза за тот же день с ТОЧНО таким же составом.

    День — по плановой дате отгрузки (ship_date); если не задана — по дате создания
    за сегодня (МСК). Совпадение = равенство {(товар,цвет,размер): кол-во}. Аннулированные исключены.
    """
    want: dict[tuple[str, str, str], int] = {}
    for ln in lines:
        want[_dup_key(ln.product_id, ln.color_id, ln.size_id)] = int(ln.qty)
    if not client_id or not want:
        return []

    ship = (ship_date or "").strip()
    if ship:
        docs = connection.execute(
            "SELECT id, doc_number, status, created_at, created_by FROM dispatch_docs "
            "WHERE client_id = ? AND cargo_type = ? AND ship_date = ? AND status != ? AND COALESCE(is_deleted,0)=0 "
            "ORDER BY created_at DESC",
            (client_id, cargo_type, ship, DISPATCH_STATUS_CANCELLED),
        ).fetchall()
    else:
        today = _moscow_day(_now())
        rows = connection.execute(
            "SELECT id, doc_number, status, created_at, created_by FROM dispatch_docs "
            "WHERE client_id = ? AND cargo_type = ? AND status != ? AND COALESCE(is_deleted,0)=0 "
            "ORDER BY created_at DESC",
            (client_id, cargo_type, DISPATCH_STATUS_CANCELLED),
        ).fetchall()
        docs = [r for r in rows if _moscow_day(r["created_at"]) == today]

    matches: list[dict] = []
    for doc in docs:
        line_rows = connection.execute(
            "SELECT product_id, color_id, size_id, qty, product_sku, product_name, color_name, size_name "
            "FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted,0)=0",
            (doc["id"],),
        ).fetchall()
        have = {_dup_key(r["product_id"], r["color_id"], r["size_id"]): int(r["qty"] or 0) for r in line_rows}
        if have != want:
            continue
        email = None
        if doc["created_by"]:
            u = connection.execute("SELECT COALESCE(NULLIF(display_name, ''), email) AS email FROM users WHERE id = ?", (doc["created_by"],)).fetchone()
            email = u["email"] if u else None
        matches.append({
            "id": doc["id"],
            "doc_number": doc["doc_number"],
            "status": doc["status"],
            "status_label": DISPATCH_STATUS_LABELS.get(doc["status"], doc["status"]),
            "created_at": doc["created_at"],
            "created_by_name": email,
            "lines": [
                {
                    "product_sku": r["product_sku"],
                    "product_name": r["product_name"],
                    "color_name": r["color_name"],
                    "size_name": r["size_name"],
                    "qty": int(r["qty"] or 0),
                }
                for r in line_rows
            ],
        })
    return matches


def _doc_cargo(connection, doc_id: str) -> str:
    row = connection.execute(
        "SELECT cargo_type FROM dispatch_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    return normalize_cargo_type(row["cargo_type"] if row else None)


def _cargo_quality(cargo: str) -> str:
    """Качество остатка отгрузки: рейс брака → брак, иначе годный (в т.ч. без упаковки)."""
    return INV_Q_DEFECT if cargo == DISPATCH_CARGO_DEFECT else INV_Q_GOOD


def _doc_quality(connection, doc_id: str) -> str:
    return _cargo_quality(_doc_cargo(connection, doc_id))


def _source_ops(cargo: str) -> list[str]:
    """Корзины-источники для ГЕЙТА доступности (можно ли вообще подготовить отгрузку).

    Проверяется на шаге «Передать в подготовку»: хватит ли товара там, где он сейчас
    лежит. Годный отгружается из «Готов к отгрузке» (`ready`, разложен по ячейкам) ИЛИ
    прямо из «Упаковано» (`packed`, со стола упаковки — отгрузка из ещё не завершённой
    задачи упаковки). Брак и годный без упаковки — «На хранении» (`storage`): оба минуют
    задачу упаковки. Совпадает с корзинами, из которых кладовщик заберёт товар при
    подготовке (см. `_prep_source_ops`).
    """
    if cargo in (DISPATCH_CARGO_DEFECT, DISPATCH_CARGO_GOOD_UNPACKED):
        return [INV_OP_STORAGE]
    return [INV_OP_READY, INV_OP_PACKED]


def _prep_source_ops(cargo: str) -> list[str]:
    """Корзины, ИЗ которых кладовщик забирает товар при подготовке к отгрузке.

    Годный берётся из ячеек «Готов к отгрузке» (`ready`) либо прямо из «Упаковано»
    (`packed`, зона упаковки). Брак и годный без упаковки — «На хранении» (`storage`).
    Подготовка переносит выбранное в `ready` в «Зону отгрузки». Порядок задаёт приоритет
    при выборе корзины источника в конкретной ячейке (сначала ready, затем packed).
    """
    return _source_ops(cargo)


def _reserve_specs(cargo: str) -> list[tuple[str, list[str]]]:
    """Какие отгрузки держат резерв на корзинах-источниках данного типа груза.

    [(cargo_type, statuses)]: спрос (qty − shipped_qty) отгрузок этих типов/статусов
    вычитается из остатка-источника. Брак и годный без упаковки (источник `storage`):
    подготовка физически увозит товар в зону отгрузки, резерв держат только ещё не
    подготовленные (preparing). Годный (источник `ready`+`packed`): остаток лежит там
    до выезда рейса — резерв держат все фиксации; ПЛЮС отгрузки без упаковки после
    подготовки (awaiting_trip/partially_shipped): их товар уже лежит как `ready` (good)
    в зоне отгрузки и не должен предлагаться обычным годным отгрузкам.
    """
    if cargo == DISPATCH_CARGO_DEFECT:
        return [(DISPATCH_CARGO_DEFECT, [DISPATCH_STATUS_PREPARING])]
    if cargo == DISPATCH_CARGO_GOOD_UNPACKED:
        return [(DISPATCH_CARGO_GOOD_UNPACKED, [DISPATCH_STATUS_PREPARING])]
    return [
        (DISPATCH_CARGO_GOOD, [
            DISPATCH_STATUS_PREPARING, DISPATCH_STATUS_AWAITING_TRIP, DISPATCH_STATUS_PARTIALLY_SHIPPED,
        ]),
        (DISPATCH_CARGO_GOOD_UNPACKED, [
            DISPATCH_STATUS_AWAITING_TRIP, DISPATCH_STATUS_PARTIALLY_SHIPPED,
        ]),
    ]


def _packed_lines_for_variant(
    connection, *, product_id: str, color_id, size_id, client_id,
) -> list[tuple[str, int]]:
    """[(shipment_line_id, net_packed_good)] варианта×клиента в корзине `packed`, FIFO.

    Нужен, чтобы при отгрузке прямо из «Упаковано» атрибутировать списание к строкам
    задачи упаковки (shipment_line_id). Иначе `line_packed_pending` (по shipment_line_id)
    не уменьшится, и финальное «Готово к рейсу» переразложит уже отгруженное → отрицательный
    остаток. `packed` физически лежит только в зоне упаковки, поэтому зону не фильтруем.
    """
    # Плюс и минус — отдельными суммами: ручное перемещение упакованного по ячейкам
    # (packed→packed) обязано дать нетто 0, а не задвоить остаток строки.
    net_sql = (
        "COALESCE(SUM(CASE WHEN to_op = ? AND to_quality = ? THEN qty ELSE 0 END), 0)"
        " - COALESCE(SUM(CASE WHEN from_op = ? AND from_quality = ? THEN qty ELSE 0 END), 0)"
    )
    rows = connection.execute(
        f"""SELECT shipment_line_id AS sl,
              {net_sql} AS net,
              MIN(created_at) AS first_at
           FROM zone_relocations
           WHERE product_id = ?
             AND color_id  IS NOT DISTINCT FROM ?
             AND size_id   IS NOT DISTINCT FROM ?
             AND client_id IS NOT DISTINCT FROM ?
             AND shipment_line_id IS NOT NULL
           GROUP BY shipment_line_id
           HAVING {net_sql} > 0
           ORDER BY MIN(created_at)""",
        (INV_OP_PACKED, INV_Q_GOOD, INV_OP_PACKED, INV_Q_GOOD,
         product_id, color_id, size_id, client_id,
         INV_OP_PACKED, INV_Q_GOOD, INV_OP_PACKED, INV_Q_GOOD),
    ).fetchall()
    return [(str(r["sl"]), int(r["net"])) for r in rows]


def reserved_by_variant(connection, *, client_id: str | None, cargo_type: str | None) -> list[dict]:
    """Зарезервированный остаток-источник по вариантам у незакрытых отгрузок клиента.

    Зеркалит вычет резерва в `ready_available_for_dispatch`: спрос (qty − shipped_qty)
    отгрузок, которые ещё держат остаток-источник корзин ЭТОГО типа груза (какие типы/
    статусы держат какой источник — см. `_reserve_specs`). Витрина выбора вычитает это
    из валового остатка, чтобы не предлагать к отгрузке уже обещанное другим документам.
    """
    cargo = normalize_cargo_type(cargo_type)
    specs = _reserve_specs(cargo)
    spec_conds: list[str] = []
    spec_params: list = []
    for spec_cargo, statuses in specs:
        status_ph = ",".join("?" for _ in statuses)
        spec_conds.append(f"(COALESCE(dd.cargo_type, 'good') = ? AND dd.status IN ({status_ph}))")
        spec_params += [spec_cargo, *statuses]
    rows = connection.execute(
        f"""SELECT dl.product_id, dl.color_id, dl.size_id,
                   COALESCE(SUM(GREATEST(dl.qty - COALESCE(dl.shipped_qty, 0), 0)), 0) AS reserved
            FROM dispatch_lines dl
            JOIN dispatch_docs dd ON dd.id = dl.doc_id
            WHERE ({' OR '.join(spec_conds)})
              AND dd.client_id IS NOT DISTINCT FROM ?
              AND COALESCE(dl.is_deleted, 0) = 0
              AND COALESCE(dd.is_deleted, 0) = 0
            GROUP BY dl.product_id, dl.color_id, dl.size_id
            HAVING COALESCE(SUM(GREATEST(dl.qty - COALESCE(dl.shipped_qty, 0), 0)), 0) > 0""",
        [*spec_params, client_id],
    ).fetchall()
    return [
        {
            "product_id": str(r["product_id"]),
            "color_id": r["color_id"],
            "size_id": r["size_id"],
            "reserved": int(r["reserved"] or 0),
        }
        for r in rows
    ]


def check_lines_have_sku(connection, doc_id: str) -> None:
    """Гейт перевода в «Ожидает рейс»: у каждого товара должен быть присвоен SKU.

    Товар «ожидает SKU» (sku_pending) отгружать нельзя — артикул нужен для
    маркировки и счетов. Источник истины — `products.sku_pending`.
    """
    rows = connection.execute(
        """SELECT DISTINCT l.product_name
           FROM dispatch_lines l
           JOIN products p ON p.id = l.product_id
           WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0
             AND COALESCE(p.sku_pending, 0) = 1
           ORDER BY l.product_name""",
        (doc_id,),
    ).fetchall()
    if rows:
        names = ", ".join(f"«{r['product_name']}»" for r in rows)
        raise HTTPException(
            status_code=400,
            detail=f"Укажите SKU для товаров без артикула перед отгрузкой: {names}",
        )


def check_lines_have_pallets(connection, doc_id: str) -> None:
    """Гейт перевода в подготовку: у каждой строки задано количество палет.

    Менеджер обязан осознанно указать число палет при создании отгрузки — это основа
    тарификации палет клиенту. Рекомендация считается из числа коробов и
    `products.boxes_per_pallet`, но финальное число вводит менеджер. Допустим и 0
    (например, догруз без отдельного палета);
    блокирует только пустое значение (NULL — поле не заполнено).
    """
    rows = connection.execute(
        "SELECT DISTINCT product_name FROM dispatch_lines "
        "WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 "
        "AND pallets_qty IS NULL ORDER BY product_name",
        (doc_id,),
    ).fetchall()
    if rows:
        names = ", ".join(f"«{r['product_name']}»" for r in rows)
        raise HTTPException(
            status_code=400,
            detail=f"Укажите количество палет для позиций: {names}",
        )


def check_lines_have_boxes(connection, doc_id: str) -> None:
    """Гейт перевода в подготовку: у каждой строки задано количество коробов.

    Менеджер обязан осознанно указать число коробов при создании отгрузки — это основа
    тарификации коробов клиенту (наравне с палетами). Рекомендация считается из
    `products.items_per_box`, но финальное число вводит менеджер. Допустим и 0 (догруз
    без отдельного короба); блокирует только пустое значение (NULL — поле не заполнено).
    """
    rows = connection.execute(
        "SELECT DISTINCT product_name FROM dispatch_lines "
        "WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 "
        "AND boxes_qty IS NULL ORDER BY product_name",
        (doc_id,),
    ).fetchall()
    if rows:
        names = ", ".join(f"«{r['product_name']}»" for r in rows)
        raise HTTPException(
            status_code=400,
            detail=f"Укажите количество коробов для позиций: {names}",
        )


def dispatch_is_invoiced(connection, doc_id: str) -> bool:
    """True, если по отгрузке уже выставлен счёт (привязка к не-черновому счёту).

    Палеты входят в тариф клиенту (см. `pallets_amount_kop` в счёте), поэтому после
    выставления счёта их менять нельзя — сумма уже зафиксирована и отправлена клиенту.
    Черновик счёта НЕ блокирует: при выставлении сумма пересчитывается из текущих палет.
    Аннулированный счёт снимает привязку (`invoice_shipments.is_deleted=1`), но статус
    фильтруем явно — на случай гонок.
    """
    row = connection.execute(
        "SELECT 1 FROM invoice_shipments s "
        "JOIN invoice_docs i ON i.id = s.invoice_id AND COALESCE(i.is_deleted, 0) = 0 "
        "WHERE s.shipment_doc_id = ? AND COALESCE(s.is_deleted, 0) = 0 "
        "AND i.status NOT IN (?, ?) LIMIT 1",
        (doc_id, INVOICE_STATUS_DRAFT, INVOICE_STATUS_CANCELLED),
    ).fetchone()
    return row is not None


def check_lines_have_ready(connection, doc_id: str) -> None:
    """Гейт перевода в «Ожидает рейс»: каждая позиция покрыта свободным остатком-источником.

    Спрос агрегируется по варианту (product/color/size), т.к. позиция может быть в
    нескольких строках (разные магазины), а остаток у неё общий. Источник зависит от
    груза: годный — `ready` (готов к отгрузке), брак и годный без упаковки — `storage`
    (на хранении).
    """
    from modules.balances.service import ready_available_for_dispatch

    doc = connection.execute(
        "SELECT client_id FROM dispatch_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    client_id = doc["client_id"] if doc else None
    cargo = _doc_cargo(connection, doc_id)
    quality = _cargo_quality(cargo)
    source_ops = _source_ops(cargo)
    reserved_specs = _reserve_specs(cargo)

    rows = connection.execute(
        """SELECT product_id, color_id, size_id,
                  MIN(product_name) AS product_name, MIN(product_sku) AS product_sku,
                  MIN(color_name) AS color_name, MIN(size_name) AS size_name,
                  SUM(qty) AS demand
           FROM dispatch_lines
           WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0
           GROUP BY product_id, color_id, size_id""",
        (doc_id,),
    ).fetchall()

    short: list[str] = []
    for r in rows:
        avail = ready_available_for_dispatch(
            connection,
            product_id=str(r["product_id"]),
            color_id=r["color_id"],
            size_id=r["size_id"],
            client_id=client_id,
            quality=quality,
            ops=source_ops,
            reserved_specs=reserved_specs,
            exclude_doc_id=doc_id,
        )
        demand = int(r["demand"] or 0)
        if demand > avail:
            label = " · ".join(x for x in [r["product_sku"], r["color_name"], r["size_name"]] if x) or r["product_name"]
            avail_word = "на хранении" if INV_OP_STORAGE in source_ops else "доступно"
            short.append(f"«{label}»: нужно {demand}, {avail_word} {avail}")
    if short:
        if cargo == DISPATCH_CARGO_DEFECT:
            head = "Недостаточно брака на хранении для отгрузки. "
        elif cargo == DISPATCH_CARGO_GOOD_UNPACKED:
            head = "Недостаточно свободного товара на хранении для отгрузки без упаковки. "
        else:
            head = "Недостаточно готового к отгрузке товара (свободного, не в резерве). "
        raise HTTPException(status_code=400, detail=head + "; ".join(short))


def promote_to_preparing(connection, doc_id: str, *, actor_id: str | None, comment: str) -> None:
    """Двигает отгрузку в «Подготовку отгрузки» + журнальная запись. Без commit — коммитит
    вызывающий. Общий шаг для ручного, принудительного и авто-перехода из очереди упаковки."""
    now = _now()
    connection.execute(
        "UPDATE dispatch_docs SET status = ?, updated_at = ? WHERE id = ?",
        (DISPATCH_STATUS_PREPARING, now, doc_id),
    )
    connection.execute(
        "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, DISPATCH_OP_ADVANCE, comment, now, actor_id),
    )


def preparation_gate_blocked(connection, doc_id: str) -> bool:
    """True, если отгрузку ещё нельзя двигать в подготовку: не заполнены обязательные поля
    (состав/ТЗ/SKU/палеты/короба) ИЛИ не хватает готового остатка. Гейты те же, что на ручном
    переходе, только без выброса — для авто-цикла, который молча пропускает не-готовые."""
    has_lines = connection.execute(
        "SELECT 1 FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 LIMIT 1",
        (doc_id,),
    ).fetchone()
    if not has_lines:
        return True
    row = connection.execute("SELECT comment FROM dispatch_docs WHERE id = ?", (doc_id,)).fetchone()
    if not str((row["comment"] if row else "") or "").strip():
        return True
    try:
        check_lines_have_sku(connection, doc_id)
        check_lines_have_pallets(connection, doc_id)
        check_lines_have_boxes(connection, doc_id)
        check_lines_have_ready(connection, doc_id)
    except HTTPException:
        return True
    return False


def _queue_actor(connection, doc_id: str) -> str | None:
    """Кто отправил отгрузку в очередь на упаковку — на него атрибутируем авто-переход,
    чтобы в журнале остался живой инициатор, а не пустой автор."""
    row = connection.execute(
        "SELECT created_by FROM dispatch_ops WHERE doc_id = ? AND op_type = ? "
        "ORDER BY created_at DESC LIMIT 1",
        (doc_id, DISPATCH_OP_ADVANCE),
    ).fetchone()
    return str(row["created_by"]) if row and row["created_by"] else None


def autopromote_ready_dispatches(connection) -> int:
    """Переводит отгрузки «Ожидание упаковки» → «Подготовка», как только весь товар покрыт
    готовым остатком (упаковка выдала годное). Обрабатывает по приоритету/дате: каждый перевод
    сразу начинает держать резерв на `ready` (см. reserved-статусы в reserved_by_variant),
    поэтому следующая в очереди на тот же вариант видит уже уменьшенный остаток — без овербукинга
    общего пула. Идемпотентно: переведённая отгрузка выпадает из выборки. Коммитит сам."""
    rows = connection.execute(
        "SELECT id FROM dispatch_docs WHERE status = ? AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY priority_rank ASC NULLS LAST, created_at ASC",
        (DISPATCH_STATUS_AWAITING_PACKING,),
    ).fetchall()
    promoted = 0
    for r in rows:
        doc_id = str(r["id"])
        if preparation_gate_blocked(connection, doc_id):
            continue
        promote_to_preparing(
            connection, doc_id,
            actor_id=_queue_actor(connection, doc_id),
            comment="Ожидание упаковки → Подготовка отгрузки (авто: товар упакован)",
        )
        promoted += 1
    if promoted:
        connection.commit()
    return promoted


def dispatch_alloc_remaining(connection, doc_id: str) -> dict[str, int]:
    """Остаток к распределению по строкам отгрузки (для привязки к рейсу).

    Спрос строки = qty − shipped_qty − уже распределённое в активные ещё-не-уехавшие
    рейсы. Ограничивается жадно общим остатком-источником варианта (несколько строк
    одного варианта делят один пул). Для годного источник — `ready` плюс `packed`
    (если разрешён выезд из упаковки, см. DISPATCH_ALLOW_SHIP_FROM_PACKED): упакованный
    годный считается доступным к рейсу, не дожидаясь раскладки кладовщиком. Брак и
    годный без упаковки — только `ready` (их свозит туда подготовка с хранения).
    """
    from modules.balances.service import ready_zones_for_variant

    cargo = _doc_cargo(connection, doc_id)
    pool_ops = [INV_OP_READY]
    if DISPATCH_ALLOW_SHIP_FROM_PACKED and cargo == DISPATCH_CARGO_GOOD:
        pool_ops.append(INV_OP_PACKED)

    doc = connection.execute(
        "SELECT client_id FROM dispatch_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    client_id = doc["client_id"] if doc else None
    quality = _cargo_quality(cargo)

    lines = connection.execute(
        "SELECT id, product_id, color_id, size_id, qty, COALESCE(shipped_qty, 0) AS shipped_qty "
        "FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 "
        "ORDER BY created_at, id",
        (doc_id,),
    ).fetchall()

    # Распределённое в активные ещё-не-уехавшие рейсы — одним агрегатом по всем строкам.
    pending_rows = connection.execute(
        """SELECT ta.dispatch_line_id AS lid, COALESCE(SUM(ta.qty), 0) AS q
           FROM trip_alloc ta
           JOIN trip_lines tl ON tl.id = ta.trip_line_id
           JOIN trip_docs td ON td.id = tl.trip_id
           JOIN dispatch_lines dl ON dl.id = ta.dispatch_line_id
           WHERE dl.doc_id = ?
             AND COALESCE(ta.is_deleted, 0) = 0
             AND COALESCE(tl.is_deleted, 0) = 0
             AND td.status IN (?, ?, ?)
           GROUP BY ta.dispatch_line_id""",
        (doc_id, TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_UNLOADING),
    ).fetchall()
    pending_by_line = {str(r["lid"]): int(r["q"] or 0) for r in pending_rows}

    variant_ready_left: dict[tuple, int] = {}
    for ln in lines:
        key = (str(ln["product_id"]), ln["color_id"], ln["size_id"])
        if key in variant_ready_left:
            continue
        variant_ready_left[key] = sum(
            int(z["net"])
            for op in pool_ops
            for z in ready_zones_for_variant(
                connection,
                product_id=str(ln["product_id"]),
                color_id=ln["color_id"],
                size_id=ln["size_id"],
                client_id=client_id,
                quality=quality,
                op=op,
            )
        )

    result: dict[str, int] = {}
    for ln in lines:
        line_id = str(ln["id"])
        base = max(0, int(ln["qty"] or 0) - int(ln["shipped_qty"] or 0) - pending_by_line.get(line_id, 0))
        key = (str(ln["product_id"]), ln["color_id"], ln["size_id"])
        give = min(base, variant_ready_left.get(key, 0))
        variant_ready_left[key] = variant_ready_left.get(key, 0) - give
        result[line_id] = give
    return result


def dispatch_trip_allocations(connection, doc_id: str) -> dict[str, list[dict]]:
    """Разбивка распределения по строкам отгрузки: в какие активные рейсы и сколько.

    Для шторки привязки — показать, куда уже ушло количество (рейс, статус, куда,
    кто и когда распределил). Исключает отменённые рейсы. Ключ — line_id, значение —
    список аллокаций.
    """
    rows = connection.execute(
        """SELECT ta.dispatch_line_id AS line_id, ta.qty AS qty, ta.created_at AS allocated_at,
                  td.trip_number AS trip_number, td.status AS trip_status,
                  td.direction AS direction, td.origin_name AS destination,
                  COALESCE(NULLIF(u.display_name, ''), u.email) AS allocated_by
           FROM trip_alloc ta
           JOIN trip_lines tl ON tl.id = ta.trip_line_id
           JOIN trip_docs td ON td.id = tl.trip_id
           LEFT JOIN users u ON u.id = ta.created_by
           WHERE ta.dispatch_line_id IN (
                   SELECT id FROM dispatch_lines
                   WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0
                 )
             AND COALESCE(ta.is_deleted, 0) = 0
             AND COALESCE(tl.is_deleted, 0) = 0
             AND td.status != ?
           ORDER BY td.created_at, td.trip_number""",
        (doc_id, TRIP_STATUS_CANCELLED),
    ).fetchall()
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(str(r["line_id"]), []).append({
            "trip_number": r["trip_number"],
            "trip_status": r["trip_status"],
            "direction": r["direction"],
            "destination": r["destination"],
            "qty": int(r["qty"] or 0),
            "allocated_by": r["allocated_by"],
            "allocated_at": r["allocated_at"],
        })
    return out


def _insert_shipped_move(
    connection, *,
    line, client_id: str | None, client_name: str | None, quality: str,
    from_op: str, from_zone_id: str | None, from_zone_name: str | None,
    qty: int, user_id: str | None, dispatch_line_id: str, trip_id: str | None,
    comment: str | None, shipment_line_id: str | None = None,
) -> None:
    """Журнальная запись списания при отгрузке (`from_op` → shipped) с атрибуцией к строке.

    Прямой INSERT в zone_relocations (а не insert_inventory_move): движение нужно
    привязать к dispatch_line_id, которого нет в сигнатуре balances.insert_inventory_move.
    Список столбцов скопирован из balances.insert_inventory_move плюс dispatch_line_id.
    `from_op` — корзина-источник: `ready` для годного, `storage` для брака. При выезде
    прямо из «Упаковано» (`packed`) передаётся `shipment_line_id` — тогда списание
    уменьшает `line_packed_pending` строки упаковки (ветка from_op='packed' → −qty), и
    финальное «Готово к рейсу» не переразложит уже отгруженное.
    """
    connection.execute(
        """INSERT INTO zone_relocations
           (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
            client_id,client_name,from_op,to_op,from_quality,to_quality,
            from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by,shipment_line_id,
            packed_date,pack_entry_id,reverses_id,receipt_line_id,reason,trip_id,dispatch_line_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), str(line["product_id"]), line["product_name"], line["product_sku"],
         line["color_id"], line["color_name"], line["size_id"], line["size_name"],
         client_id, client_name, from_op, INV_OP_SHIPPED, quality, quality,
         from_zone_id, from_zone_name, None, None, qty, comment,
         _now(), user_id, shipment_line_id,
         None, None, None, None, None, trip_id, dispatch_line_id),
    )


def _insert_prep_move(
    connection, *,
    line, client_id: str | None, client_name: str | None, quality: str,
    from_op: str, to_op: str,
    from_zone_id: str | None, from_zone_name: str | None,
    to_zone_id: str | None, to_zone_name: str | None,
    qty: int, user_id: str | None, dispatch_line_id: str,
    comment: str | None, reverses_id: str | None = None,
    shipment_line_id: str | None = None,
) -> None:
    """Журнальное движение подготовки к отгрузке (`from_op` → `to_op`) с атрибуцией к строке.

    Прямой INSERT в zone_relocations (а не insert_inventory_move): движение нужно
    привязать к dispatch_line_id, которого нет в сигнатуре balances.insert_inventory_move.
    `line` — строка отгрузки или (при сторно) запись журнала: достаточно полей
    product/color/size. Используется и для прямой подготовки (… → ready@зона отгрузки),
    и для её сторно при аннулировании (ready@зона отгрузки → …).
    """
    connection.execute(
        """INSERT INTO zone_relocations
           (id,product_id,product_name,product_sku,color_id,color_name,size_id,size_name,
            client_id,client_name,from_op,to_op,from_quality,to_quality,
            from_zone_id,from_zone_name,to_zone_id,to_zone_name,qty,comment,created_at,created_by,shipment_line_id,
            packed_date,pack_entry_id,reverses_id,receipt_line_id,reason,trip_id,dispatch_line_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), str(line["product_id"]), line["product_name"], line["product_sku"],
         line["color_id"], line["color_name"], line["size_id"], line["size_name"],
         client_id, client_name, from_op, to_op, quality, quality,
         from_zone_id, from_zone_name, to_zone_id, to_zone_name, qty, comment,
         _now(), user_id, shipment_line_id,
         None, None, reverses_id, None, None, None, dispatch_line_id),
    )


def prepare_to_ready(connection, doc_id: str, line_inputs, user_id: str) -> str:
    """«Отгрузка подготовлена»: кладовщик указывает ячейки-источники, товар → «Готов к отгрузке».

    По каждой строке — источники (ячейка + кол-во, можно несколько); суммы должны
    точно покрыть план строки. Выбранное переезжает в «Готов к отгрузке» (`ready`) в
    «Зону отгрузки»: годный из ячеек готового (`ready`@ячейка), брак — «На хранении»
    (`storage`@ячейка). Списания нет — отгрузку увозит рейс из зоны отгрузки. Переводит
    preparing → awaiting_trip.
    """
    from modules.balances.service import get_available_in_zone, get_shipping_zone

    doc = connection.execute(
        "SELECT status, cargo_type, client_id, client_name FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(doc["status"]) != DISPATCH_STATUS_PREPARING:
        raise HTTPException(status_code=400, detail="Отметить подготовку можно только в статусе «Подготовка отгрузки»")

    cargo = normalize_cargo_type(doc["cargo_type"])
    quality = _cargo_quality(cargo)
    source_ops = _prep_source_ops(cargo)
    is_defect = quality == INV_Q_DEFECT
    client_id = doc["client_id"]

    lines = connection.execute(
        "SELECT * FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchall()
    if not lines:
        raise HTTPException(status_code=400, detail="Добавьте товар")
    inputs_by_id = {str(li.line_id): li for li in (line_inputs or [])}

    shipping_id, shipping_name = get_shipping_zone(connection)

    total_moved = 0
    for line in lines:
        line_id = str(line["id"])
        qty = int(line["qty"] or 0)
        li = inputs_by_id.get(line_id)
        sources = list(li.sources) if li else []
        if sum(int(s.qty or 0) for s in sources) != qty:
            raise HTTPException(
                status_code=400,
                detail=f"Укажите, из каких ячеек берётся весь товар для «{line['product_name']}» (нужно {qty} шт.)",
            )
        label = line["product_sku"] or line["product_name"]
        for src in sources:
            zone_id = (src.zone_id or "").strip()
            src_qty = int(src.qty or 0)
            if not zone_id:
                raise HTTPException(status_code=400, detail="Выберите ячейку-источник для каждой строки")
            # Зона отгрузки допустима как источник: товар могли разложить/оставить прямо в
            # ней (например, при раскладке «Готово к рейсу» после упаковки). Тогда это
            # `ready@зона отгрузки` — самоперенос с нулевым нетто, дальше рейс спишет из `ready`.
            if src_qty <= 0:
                raise HTTPException(status_code=400, detail="Укажите количество больше нуля")
            # Корзина-источник в этой ячейке: годный лежит либо «Готов к отгрузке»
            # (ready@ячейка), либо «Упаковано» (packed@зона упаковки) — берём ту, что
            # покрывает количество (одна ячейка держит один бакет варианта).
            avail_by_op = {
                op: get_available_in_zone(
                    connection,
                    product_id=str(line["product_id"]),
                    color_id=line["color_id"],
                    size_id=line["size_id"],
                    client_id=client_id,
                    zone_id=zone_id,
                    op=op,
                    quality=quality,
                )
                for op in source_ops
            }
            chosen_op = next((op for op in source_ops if avail_by_op[op] >= src_qty), None)
            if chosen_op is None:
                zone_label = src.zone_name or "Без места"
                avail_word = "брака" if is_defect else "товара"
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Недостаточно {avail_word} в ячейке «{zone_label}» для «{line['product_name']}» "
                        f"(нужно {src_qty}, доступно {sum(avail_by_op.values())})"
                    ),
                )
            if chosen_op == INV_OP_PACKED:
                # Отгрузка прямо из «Упаковано»: атрибутируем списание к строкам задачи
                # упаковки (shipment_line_id) FIFO, иначе финальное «Готово к рейсу»
                # переразложит уже отгруженное (см. _packed_lines_for_variant).
                remaining = src_qty
                for sl_id, net in _packed_lines_for_variant(
                    connection, product_id=str(line["product_id"]),
                    color_id=line["color_id"], size_id=line["size_id"], client_id=client_id,
                ):
                    if remaining <= 0:
                        break
                    take = min(remaining, net)
                    _insert_prep_move(
                        connection,
                        line=line, client_id=client_id, client_name=doc["client_name"], quality=quality,
                        from_op=INV_OP_PACKED, to_op=INV_OP_READY,
                        from_zone_id=zone_id, from_zone_name=src.zone_name,
                        to_zone_id=shipping_id, to_zone_name=shipping_name,
                        qty=take, user_id=user_id, dispatch_line_id=line_id, shipment_line_id=sl_id,
                        comment=f"Подготовка к отгрузке (из упаковки): {take} шт → {shipping_name} — {label}",
                    )
                    remaining -= take
                if remaining > 0:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Недостаточно упакованного товара для «{line['product_name']}» (не хватает {remaining})",
                    )
            else:
                _insert_prep_move(
                    connection,
                    line=line, client_id=client_id, client_name=doc["client_name"], quality=quality,
                    from_op=chosen_op, to_op=INV_OP_READY,
                    from_zone_id=zone_id, from_zone_name=src.zone_name,
                    to_zone_id=shipping_id, to_zone_name=shipping_name,
                    qty=src_qty, user_id=user_id, dispatch_line_id=line_id,
                    comment=f"Подготовка к отгрузке: {src_qty} шт → {shipping_name} — {label}",
                )
            total_moved += src_qty

    if total_moved <= 0:
        raise HTTPException(status_code=400, detail="Нет товара для подготовки к отгрузке")

    now = _now()
    connection.execute(
        "UPDATE dispatch_docs SET status = ?, updated_at = ? WHERE id = ?",
        (DISPATCH_STATUS_AWAITING_TRIP, now, doc_id),
    )
    connection.execute(
        "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, DISPATCH_OP_PREPARE,
         f"Подготовка отгрузки → Ожидает рейс: {total_moved} шт. в «{shipping_name}»", now, user_id),
    )
    return DISPATCH_STATUS_AWAITING_TRIP


def return_prepared_stock(connection, doc_id: str, user_id: str,
                          *, cause: str = "при аннулировании") -> None:
    """Возврат подготовленного товара из «Зоны отгрузки» обратно по исходным ячейкам.

    Вызывается при аннулировании или возврате на корректировку подготовленной отгрузки
    (awaiting_trip): каждое движение подготовки (… → ready@зона отгрузки) сторнируется
    обратной записью ready@зона отгрузки → исходная корзина/ячейка. Без commit — коммитит
    вызывающий. Списанное рейсом не трогаем (откат возможен только до отправки).
    """
    moves = connection.execute(
        """SELECT * FROM zone_relocations
           WHERE dispatch_line_id IN (SELECT id FROM dispatch_lines WHERE doc_id = ?)
             AND to_op = ? AND reverses_id IS NULL""",
        (doc_id, INV_OP_READY),
    ).fetchall()
    for mv in moves:
        already = connection.execute(
            "SELECT 1 FROM zone_relocations WHERE reverses_id = ?", (str(mv["id"]),)
        ).fetchone()
        if already:
            continue
        _insert_prep_move(
            connection,
            line=mv, client_id=mv["client_id"], client_name=mv["client_name"],
            quality=str(mv["to_quality"]),
            from_op=INV_OP_READY, to_op=str(mv["from_op"]),
            from_zone_id=mv["to_zone_id"], from_zone_name=mv["to_zone_name"],
            to_zone_id=mv["from_zone_id"], to_zone_name=mv["from_zone_name"],
            qty=int(mv["qty"]), user_id=user_id, dispatch_line_id=str(mv["dispatch_line_id"]),
            comment=f"Возврат подготовки {cause}: {int(mv['qty'])} шт.",
            reverses_id=str(mv["id"]),
            # Источник из «Упаковано» был атрибутирован к строке упаковки — восстанавливаем,
            # чтобы packed-остаток строки (line_packed_pending) вернулся.
            shipment_line_id=mv["shipment_line_id"],
        )


def return_dispatch_to_draft(connection, doc_id: str, user_id: str,
                             reason: str | None = None) -> str:
    """«Вернуть на корректировку»: откат отгрузки в черновик до выезда первого рейса.

    Из «Ожидает рейс» сторнирует движения подготовки (товар журнально возвращается
    из зоны отгрузки на исходные места). Гейт — нет распределения в активные рейсы:
    молча менять состав рейса за логиста нельзя, сначала отвязать. Без commit —
    коммитит вызывающий.
    """
    row = connection.execute(
        "SELECT status FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Документ не найден")
    status = str(row["status"])
    if status == DISPATCH_STATUS_DRAFT:
        raise HTTPException(status_code=400, detail="Документ уже в черновике")
    if status not in DISPATCH_RETURNABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Вернуть на корректировку можно только до выезда первого рейса",
        )
    trips = connection.execute(
        """SELECT DISTINCT td.trip_number
           FROM trip_alloc ta
           JOIN trip_lines tl ON tl.id = ta.trip_line_id
           JOIN trip_docs td ON td.id = tl.trip_id
           JOIN dispatch_lines dl ON dl.id = ta.dispatch_line_id
           WHERE dl.doc_id = ?
             AND COALESCE(ta.is_deleted, 0) = 0
             AND COALESCE(tl.is_deleted, 0) = 0
             AND td.status IN (?, ?, ?)
           ORDER BY td.trip_number""",
        (doc_id, TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_UNLOADING),
    ).fetchall()
    if trips:
        numbers = ", ".join(str(t["trip_number"]) for t in trips)
        raise HTTPException(
            status_code=400,
            detail=f"Отгрузка распределена в рейс: {numbers}. Сначала отвяжите её от рейса",
        )
    if dispatch_is_invoiced(connection, doc_id):
        raise HTTPException(status_code=400, detail="По отгрузке выставлен счёт — возврат невозможен")
    if status == DISPATCH_STATUS_AWAITING_TRIP:
        return_prepared_stock(connection, doc_id, user_id, cause="при возврате на корректировку")
    now = _now()
    connection.execute(
        "UPDATE dispatch_docs SET status = ?, updated_at = ? WHERE id = ?",
        (DISPATCH_STATUS_DRAFT, now, doc_id),
    )
    comment = f"Возврат на корректировку из «{DISPATCH_STATUS_LABELS.get(status, status)}»"
    if reason and reason.strip():
        comment += f". Причина: {reason.strip()}"
    connection.execute(
        "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, DISPATCH_OP_RETURN, comment, now, user_id),
    )
    return DISPATCH_STATUS_DRAFT


def consume_stock_for_dispatch(
    connection, doc_id: str, user_id: str,
    *, alloc: dict[str, int] | None = None, trip_id: str | None = None,
) -> None:
    """Списание остатков при выезде рейса: журнальные движения (источник → shipped).

    Без commit — коммитит вызывающий (каскад рейса). Остаток берётся ПО ВАРИАНТУ
    (product/color/size × client × quality), т.к. отгрузка не знает, какая задача
    упаковки его подготовила. Источник зависит от груза: годный — `ready`, брак —
    `storage` (отгружается прямо с хранения). `alloc` — сколько каждой строки увозит
    этот рейс; при alloc=None списывается весь доступный остаток. shipped_qty
    накапливается (инкремент), так отгрузка может уезжать несколькими рейсами.
    trip_id пишется в журнал для точного сторно при отмене рейса.
    """
    doc_row = connection.execute(
        "SELECT client_id, client_name, cargo_type FROM dispatch_docs WHERE id = ?",
        (doc_id,),
    ).fetchone()
    cargo_type = normalize_cargo_type(doc_row["cargo_type"] if doc_row else None)
    client_id = doc_row["client_id"] if doc_row else None
    client_name = doc_row["client_name"] if doc_row else None
    quality = _cargo_quality(cargo_type)
    if cargo_type == DISPATCH_CARGO_DEFECT:
        comment_prefix = "Отгрузка брака"
    elif cargo_type == DISPATCH_CARGO_GOOD_UNPACKED:
        comment_prefix = "Отгрузка без упаковки"
    else:
        comment_prefix = "Отгрузка"
    # Годный может уехать прямо из «Упаковано» (`packed`), не дожидаясь раскладки в зону
    # отгрузки — тогда после `ready` дочерпываем из упаковки с атрибуцией к строкам задачи
    # упаковки. Брак и годный без упаковки этим путём не едут (всегда из `ready` после
    # подготовки с хранения).
    ship_from_packed = DISPATCH_ALLOW_SHIP_FROM_PACKED and cargo_type == DISPATCH_CARGO_GOOD

    from modules.balances.service import get_packing_zone, ready_zones_for_variant

    packing_id, packing_name = get_packing_zone(connection) if ship_from_packed else (None, None)

    lines = connection.execute(
        "SELECT * FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchall()

    drained_shipment_lines: set[str] = set()

    for line in lines:
        line_id = str(line["id"])
        # Списываем из «Готов к отгрузке» (`ready`): подготовка свезла туда выбранные
        # кладовщиком ячейки (годный и брак) в «Зону отгрузки».
        zones = ready_zones_for_variant(
            connection,
            product_id=str(line["product_id"]),
            color_id=line["color_id"],
            size_id=line["size_id"],
            client_id=client_id,
            quality=quality,
            op=INV_OP_READY,
        )
        ready_avail = sum(int(z["net"]) for z in zones)
        # Упакованный годный, ещё не разложенный в зону отгрузки (по строкам упаковки, FIFO).
        packed_lines = _packed_lines_for_variant(
            connection, product_id=str(line["product_id"]),
            color_id=line["color_id"], size_id=line["size_id"], client_id=client_id,
        ) if ship_from_packed else []
        packed_avail = sum(net for _, net in packed_lines)
        available = ready_avail + packed_avail

        target = int(alloc.get(line_id, 0)) if alloc is not None else available
        if target <= 0:
            continue
        if target > available:
            where = "«Готов к отгрузке»/«Упаковано»" if ship_from_packed else "«Готов к отгрузке»"
            raise HTTPException(
                status_code=400,
                detail=f"Недостаточно товара в {where} для отгрузки: нужно {target}, есть {available}",
            )

        shipped_total = 0
        remaining = target
        for src in zones:
            if remaining <= 0:
                break
            take = min(remaining, int(src["net"]))
            _insert_shipped_move(
                connection,
                line=line, client_id=client_id, client_name=client_name, quality=quality,
                from_op=INV_OP_READY,
                from_zone_id=src["zone_id"], from_zone_name=src["zone_name"],
                qty=take, user_id=user_id, dispatch_line_id=line_id, trip_id=trip_id,
                comment=f"{comment_prefix}: {take} шт.",
            )
            shipped_total += take
            remaining -= take
        for sl_id, net in packed_lines:
            if remaining <= 0:
                break
            take = min(remaining, net)
            # Упакованное могли вручную переставить из зоны упаковки — списываем из
            # фактических ячеек корзины `packed` строки упаковки (FIFO).
            from modules.shipments.service import _consume_zone_sources, line_bucket_zone_sources
            packed_sources = line_bucket_zone_sources(
                connection, sl_id, op=INV_OP_PACKED, quality=quality, prefer_zone_id=packing_id,
            )
            for src_zone_id, src_zone_name, part in _consume_zone_sources(
                packed_sources, take, fallback=(packing_id, packing_name)
            ):
                _insert_shipped_move(
                    connection,
                    line=line, client_id=client_id, client_name=client_name, quality=quality,
                    from_op=INV_OP_PACKED,
                    from_zone_id=src_zone_id, from_zone_name=src_zone_name,
                    qty=part, user_id=user_id, dispatch_line_id=line_id, trip_id=trip_id,
                    comment=f"{comment_prefix} (из упаковки): {part} шт.", shipment_line_id=sl_id,
                )
            shipped_total += take
            remaining -= take
            drained_shipment_lines.add(sl_id)

        connection.execute(
            "UPDATE dispatch_lines SET shipped_qty = COALESCE(shipped_qty, 0) + ? WHERE id = ?",
            (shipped_total, line_id),
        )

    if drained_shipment_lines:
        # Упаковочные задачи, чей упакованный уехал, закрываем автоматически — кладовщику
        # больше нечего раскладывать (инвентарь корректен и без этого: списание `packed`
        # уже уменьшило line_packed_pending, это лишь гигиена статуса задачи).
        from modules.shipments.service import close_drained_packing_tasks
        close_drained_packing_tasks(connection, drained_shipment_lines, user_id)


def dispatch_fully_shipped(connection, doc_id: str) -> bool:
    """True, если по всем строкам отгрузки отгружать больше нечего.

    Завершённость считаем по плану/факту строки: (qty − shipped_qty) <= 0 по всем
    строкам. Так не зависает случай нескольких строк одного варианта (они делят
    общий пул `ready`, и проверка по варианту могла бы не сойтись построчно);
    для v1 этого критерия достаточно — план набирается shipped_qty при выезде рейсов.
    """
    rows = connection.execute(
        "SELECT qty, COALESCE(shipped_qty, 0) AS shipped_qty "
        "FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchall()
    for r in rows:
        if int(r["qty"] or 0) - int(r["shipped_qty"] or 0) > 0:
            return False
    return True


def dispatch_shortfall(connection, doc_id: str) -> tuple[int, int]:
    """(отгружено, план) по документу — база сообщения о недовозе."""
    row = connection.execute(
        "SELECT COALESCE(SUM(shipped_qty), 0) AS shipped, COALESCE(SUM(qty), 0) AS plan "
        "FROM dispatch_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchone()
    return (int(row["shipped"] or 0), int(row["plan"] or 0)) if row else (0, 0)


def _has_pending_outbound_trip(connection, doc_id: str) -> str | None:
    """Номер привязанного рейса, который ещё может увезти остаток (черновик / в пути / погрузка)."""
    row = connection.execute(
        "SELECT t.trip_number FROM trip_lines tl "
        "JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
        "WHERE tl.dispatch_doc_id = ? AND COALESCE(tl.is_deleted, 0) = 0 "
        "AND t.status IN (?,?,?) LIMIT 1",
        (doc_id, TRIP_STATUS_DRAFT, TRIP_STATUS_AWAITING_ARRIVAL, TRIP_STATUS_UNLOADING),
    ).fetchone()
    return str(row["trip_number"]) if row else None


def dispatch_shortage_final(connection, doc_id: str) -> bool:
    """True, если отгрузка уехала не полностью и ждёт решения менеджера.

    Условия: статус «Частично отгружено», есть недовоз (план > отгруженного) и нет
    привязанного активного рейса — увозить сейчас нечем. В отличие от приёмки
    (`receipt_shortage_final`) НЕ требуем, чтобы план был разложен по рейсам целиком:
    нераспределённый остаток на исходящей стороне — это и есть недовоз (товар лежит
    на складе, а клиент его не берёт), а не ожидание поставщика.
    """
    row = connection.execute(
        "SELECT status FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchone()
    if not row or str(row["status"]) != DISPATCH_STATUS_PARTIALLY_SHIPPED:
        return False
    shipped, plan = dispatch_shortfall(connection, doc_id)
    if plan - shipped <= 0:
        return False
    return _has_pending_outbound_trip(connection, doc_id) is None


def list_stuck_partial_dispatches(connection, *, idle_days: int = 7) -> list[dict]:
    """Частично отгруженные без активного рейса дольше `idle_days` — кандидаты на close-short.

    Источник задачи менеджеру «Закрыть с недовозом». Порог по времени обязателен:
    сразу после выезда рейса «Частично отгружено» без нового рейса — нормальное
    состояние (остаток поедет следующим рейсом через день-два), и задача была бы
    шумом. Задача появляется, когда документ действительно завис.
    """
    cutoff = (datetime.now(UTC) - timedelta(days=idle_days)).isoformat()
    rows = connection.execute(
        "SELECT id, doc_number, updated_at, created_at FROM dispatch_docs "
        "WHERE COALESCE(is_deleted, 0) = 0 AND status = ? "
        "AND COALESCE(updated_at, created_at) < ? ORDER BY COALESCE(updated_at, created_at)",
        (DISPATCH_STATUS_PARTIALLY_SHIPPED, cutoff),
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        doc_id = str(r["id"])
        if not dispatch_shortage_final(connection, doc_id):
            continue
        out.append({
            "id": doc_id,
            "doc_number": str(r["doc_number"]),
            "since": r["updated_at"] or r["created_at"],
        })
    return out


def close_dispatch_short(connection, doc_id: str, user_id: str) -> str:
    """«Закрыть с недовозом»: Частично отгружено → Отгружено, остаток больше не поедет.

    Сток не трогаем: неувезённое лежит в «Готов к отгрузке»/«Упаковано» — легальных
    корзинах, и после выхода документа из резервирующих статусов остаток снова доступен
    другим отгрузкам (физический вывоз из зоны отгрузки — обычным перемещением). План
    строк не переписываем: заявленное клиентом количество остаётся в документе, недовоз
    считается как qty − shipped_qty, а `closed_short_at` отличает закрытый недовоз от
    полностью уехавшей отгрузки (по нему счёт считается по факту). Без commit.
    """
    row = connection.execute(
        "SELECT status, cargo_type, priority_rank FROM dispatch_docs "
        "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(row["status"]) != DISPATCH_STATUS_PARTIALLY_SHIPPED:
        raise HTTPException(
            status_code=400,
            detail="Закрыть с недовозом можно только частично отгруженный документ",
        )
    trip_number = _has_pending_outbound_trip(connection, doc_id)
    if trip_number:
        raise HTTPException(
            status_code=400,
            detail=f"Остаток распределён в рейс {trip_number} — сначала отвяжите отгрузку от рейса",
        )
    shipped, plan = dispatch_shortfall(connection, doc_id)
    if plan - shipped <= 0:
        raise HTTPException(status_code=400, detail="Нет недовоза: отгружен весь план")

    now = _now()
    connection.execute(
        "UPDATE dispatch_docs SET status = ?, priority_rank = NULL, "
        "closed_short_at = ?, closed_short_by = ?, updated_at = ? WHERE id = ?",
        (DISPATCH_STATUS_SHIPPED, now, user_id, now, doc_id),
    )
    if row.get("priority_rank") is not None:
        connection.execute(
            "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, DISPATCH_OP_PRIORITY_UPDATE,
             "Приоритет снят: отгрузка завершена", now, user_id),
        )
    verb = "Возвращено" if normalize_cargo_type(row["cargo_type"]) == DISPATCH_CARGO_DEFECT else "Отгружено"
    connection.execute(
        "INSERT INTO dispatch_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, DISPATCH_OP_CLOSE_SHORT,
         f"{DISPATCH_STATUS_LABELS[DISPATCH_STATUS_PARTIALLY_SHIPPED]} → "
         f"{DISPATCH_STATUS_LABELS[DISPATCH_STATUS_SHIPPED]} "
         f"(закрыто с недовозом: {verb.lower()} {shipped} из {plan} шт.)", now, user_id),
    )
    return DISPATCH_STATUS_SHIPPED


def _dispatch_priority_order(alias: str = "d") -> str:
    return (
        f"CASE WHEN {alias}.priority_rank IS NULL THEN 1 ELSE 0 END, "
        f"{alias}.priority_rank ASC NULLS LAST, "
        f"{alias}.ship_date ASC NULLS LAST, "
        f"{alias}.created_at DESC"
    )


def list_dispatches_aggregated(
    connection, *,
    page: int, limit: int,
    client_id: str | None = None,
    status: str | None = None,
    search: str | None = None,
    sku: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    cargo_type: str | None = None,
    available_for_trip_id: str | None = None,
    show_costs: bool = True,
) -> tuple[list[dict], int]:
    """Агрегирующий список отгрузок (один SQL, без replay по строкам)."""
    conds = ["d.is_deleted = 0"]
    params: list = []
    use_priority_order = False
    status_filter_applied = False

    if available_for_trip_id and available_for_trip_id.strip():
        # Кандидаты в рейс: тип груза — по СЕМЕЙСТВУ рейса (годный рейс возит и годный,
        # и годный без упаковки; рейс брака — только брак), поэтому точечный фильтр
        # cargo_type здесь игнорируется. Статусы привязки; ещё не привязанные к ЭТОМУ
        # рейсу (к другим — могут, отгрузка едет несколькими рейсами).
        trip_row = connection.execute(
            "SELECT cargo_type FROM trip_docs WHERE id = ?", (available_for_trip_id.strip(),)
        ).fetchone()
        trip_cargo = str(trip_row["cargo_type"]) if trip_row and trip_row["cargo_type"] else DISPATCH_CARGO_GOOD
        family = (
            [DISPATCH_CARGO_DEFECT] if trip_cargo == DISPATCH_CARGO_DEFECT
            else [DISPATCH_CARGO_GOOD, DISPATCH_CARGO_GOOD_UNPACKED]
        )
        family_ph = ",".join("?" for _ in family)
        conds.append(f"COALESCE(d.cargo_type, 'good') IN ({family_ph})"); params.extend(family)
        selectable = list(DISPATCH_TRIP_SELECTABLE_STATUSES)
        placeholders = ",".join("?" for _ in selectable)
        conds.append(f"d.status IN ({placeholders})"); params.extend(selectable)
        conds.append(
            "NOT EXISTS (SELECT 1 FROM trip_lines tl"
            " WHERE tl.dispatch_doc_id = d.id AND COALESCE(tl.is_deleted, 0) = 0 AND tl.trip_id = ?)"
        )
        params.append(available_for_trip_id.strip())
        use_priority_order = True
        status_filter_applied = True
    elif cargo_type in DISPATCH_CARGO_TYPES:
        conds.append("COALESCE(d.cargo_type, 'good') = ?"); params.append(cargo_type)

    if status:
        requested = [s.strip() for s in status.split(",") if s.strip()]
        allowed = [s for s in requested if s in DISPATCH_STATUSES_ALL]
        if len(allowed) == 1:
            conds.append("d.status = ?"); params.append(allowed[0])
            status_filter_applied = True
        elif len(allowed) > 1:
            placeholders = ",".join("?" for _ in allowed)
            conds.append(f"d.status IN ({placeholders})"); params.extend(allowed)
            status_filter_applied = True
        if allowed and all(s not in DISPATCH_TERMINAL_STATUSES for s in allowed):
            use_priority_order = True

    if client_id:
        conds.append("d.client_id = ?"); params.append(client_id.strip())
    if search:
        s = ci_like_substring_param(search)
        conds.append("(fold_ci(d.doc_number) LIKE ? OR fold_ci(d.client_name) LIKE ? OR fold_ci(d.destination) LIKE ?)")
        params += [s, s, s]
    if sku:
        conds.append(
            "EXISTS (SELECT 1 FROM dispatch_lines dl"
            " LEFT JOIN products p ON p.id = dl.product_id"
            " WHERE dl.doc_id = d.id AND COALESCE(dl.is_deleted,0)=0"
            " AND (fold_ci(COALESCE(NULLIF(p.sku, ''), dl.product_sku)) LIKE ? OR fold_ci(dl.product_name) LIKE ?))"
        )
        s = ci_like_substring_param(sku); params += [s, s]
    if date_from:
        conds.append("d.ship_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("d.ship_date <= ?"); params.append(date_to)

    # Аннулированные скрываются из списка по умолчанию; показать — явным выбором статуса.
    if not status_filter_applied:
        conds.append("d.status != ?"); params.append(DISPATCH_STATUS_CANCELLED)

    where = " AND ".join(conds)
    total = int(connection.execute(
        f"SELECT COUNT(*) AS cnt FROM dispatch_docs d WHERE {where}", params
    ).fetchone()["cnt"])

    offset = (page - 1) * limit
    order_by = _dispatch_priority_order() if use_priority_order else "d.ship_date DESC NULLS LAST, d.created_at DESC"
    rows = connection.execute(
        f"""SELECT d.*,
                (SELECT COALESCE(NULLIF(u.display_name, ''), u.email) FROM users u WHERE u.id = d.created_by) AS created_by_name,
                COUNT(DISTINCT l.product_id) FILTER (WHERE l.is_deleted=0) AS sku_count,
                COALESCE(SUM(l.qty) FILTER (WHERE l.is_deleted=0), 0) AS total_qty,
                COALESCE(SUM(COALESCE(l.shipped_qty, 0)) FILTER (WHERE l.is_deleted=0), 0) AS total_shipped_qty
            FROM dispatch_docs d
            LEFT JOIN dispatch_lines l ON l.doc_id = d.id
            WHERE {where}
            GROUP BY d.id
            ORDER BY {order_by}
            LIMIT ? OFFSET ?""",
        params + [limit, offset],
    ).fetchall()

    items = [
        {
            "id": str(r["id"]),
            "doc_number": str(r["doc_number"]),
            "cargo_type": normalize_cargo_type(r.get("cargo_type")),
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "destination": r["destination"],
            "carrier": r["carrier"],
            "logistics_cost": float(r["logistics_cost"]) if show_costs and r.get("logistics_cost") is not None else None,
            "ship_date": r["ship_date"],
            "priority_rank": int(r["priority_rank"]) if r.get("priority_rank") is not None else None,
            "status": str(r["status"]),
            "status_label": DISPATCH_STATUS_LABELS.get(str(r["status"]), str(r["status"])),
            "sku_count": int(r["sku_count"] or 0),
            "total_qty": int(r["total_qty"] or 0),
            "total_shipped_qty": int(r["total_shipped_qty"] or 0),
            "closed_short": r.get("closed_short_at") is not None,
            "created_at": str(r["created_at"]),
            "created_by_name": r.get("created_by_name"),
        }
        for r in rows
    ]
    return items, total


def get_dispatch_detail(connection, doc_id: str, *, show_costs: bool = True) -> dict | None:
    """Документ + строки (sku_pending, remaining) + ops (email) + рейсы. None если нет."""
    row = connection.execute(
        "SELECT * FROM dispatch_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
    ).fetchone()
    if not row:
        return None

    created_by_name = None
    if row["created_by"]:
        _u = connection.execute(
            "SELECT COALESCE(NULLIF(display_name, ''), email) AS name FROM users WHERE id = ?",
            (row["created_by"],),
        ).fetchone()
        created_by_name = _u["name"] if _u else None

    remaining = dispatch_alloc_remaining(connection, doc_id)

    lines_rows = connection.execute(
        "SELECT l.*, COALESCE(p.sku_pending, 0) AS sku_pending, "
        "p.items_per_box AS items_per_box, "
        "p.boxes_per_pallet AS boxes_per_pallet, "
        "COALESCE(NULLIF(p.sku, ''), NULLIF(l.product_sku, ''), '') AS effective_sku "
        "FROM dispatch_lines l "
        "LEFT JOIN products p ON p.id = l.product_id "
        "WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0 ORDER BY l.created_at, l.id",
        (doc_id,),
    ).fetchall()
    files_rows = connection.execute(
        "SELECT id, line_id, filename, url, mime_type, created_at FROM dispatch_line_files "
        "WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY created_at",
        (doc_id,),
    ).fetchall()
    files_by_line: dict[str, list[dict]] = {}
    for f in files_rows:
        files_by_line.setdefault(str(f["line_id"]), []).append({
            "id": str(f["id"]),
            "filename": str(f["filename"]),
            "url": str(f["url"]),
            "mime_type": f["mime_type"],
            "created_at": str(f["created_at"]),
        })
    ops_rows = connection.execute(
        """SELECT o.*, COALESCE(NULLIF(u.display_name, ''), u.email) AS user_email
           FROM dispatch_ops o LEFT JOIN users u ON u.id = o.created_by
           WHERE o.doc_id = ? ORDER BY o.created_at DESC""",
        (doc_id,),
    ).fetchall()
    trip_rows = connection.execute(
        "SELECT DISTINCT t.id AS trip_id, t.trip_number AS trip_number "
        "FROM trip_lines tl "
        "JOIN trip_docs t ON t.id = tl.trip_id AND COALESCE(t.is_deleted, 0) = 0 "
        "WHERE tl.dispatch_doc_id = ? AND COALESCE(tl.is_deleted, 0) = 0 AND t.status != ? "
        "ORDER BY t.trip_number",
        (doc_id, TRIP_STATUS_CANCELLED),
    ).fetchall()

    lines = [
        {
            "id": str(l["id"]),
            "product_id": str(l["product_id"]),
            "product_name": str(l["product_name"]),
            "product_sku": str(l["effective_sku"]),
            "sku_pending": bool(l["sku_pending"]),
            "color_id": l["color_id"],
            "color_name": l["color_name"],
            "size_id": l["size_id"],
            "size_name": l["size_name"],
            "qty": int(l["qty"] or 0),
            "shipped_qty": int(l["shipped_qty"] or 0),
            "pallets_qty": int(l["pallets_qty"]) if l["pallets_qty"] is not None else None,
            "boxes_qty": int(l["boxes_qty"]) if l["boxes_qty"] is not None else None,
            "items_per_box": int(l["items_per_box"]) if l["items_per_box"] is not None else None,
            "boxes_per_pallet": int(l["boxes_per_pallet"]) if l["boxes_per_pallet"] is not None else None,
            "site_url": l["site_url"],
            "store_id": l["store_id"],
            "store_name": l["store_name"],
            "remaining": int(remaining.get(str(l["id"]), 0)),
            "files": files_by_line.get(str(l["id"]), []),
        }
        for l in lines_rows
    ]
    ops = [
        {
            "id": str(o["id"]),
            "op_type": str(o["op_type"]),
            "comment": o["comment"],
            "created_at": str(o["created_at"]),
            "created_by": o["created_by"],
            "created_by_email": o["user_email"],
        }
        for o in ops_rows
    ]
    trips = [{"id": str(tr["trip_id"]), "number": str(tr["trip_number"])} for tr in trip_rows]

    return {
        "id": str(row["id"]),
        "doc_number": str(row["doc_number"]),
        "cargo_type": normalize_cargo_type(row.get("cargo_type")),
        "client_id": row["client_id"],
        "client_name": row["client_name"],
        "destination": row["destination"],
        "carrier": row["carrier"],
        "logistics_cost": float(row["logistics_cost"]) if show_costs and row.get("logistics_cost") is not None else None,
        "ship_date": row["ship_date"],
        "priority_rank": int(row["priority_rank"]) if row.get("priority_rank") is not None else None,
        "actual_ship_date": row.get("actual_ship_date"),
        "comment": row["comment"],
        "status": str(row["status"]),
        "status_label": DISPATCH_STATUS_LABELS.get(str(row["status"]), str(row["status"])),
        "invoiced": dispatch_is_invoiced(connection, doc_id),
        "closed_short_at": row.get("closed_short_at"),
        "can_close_short": dispatch_shortage_final(connection, doc_id),
        "trips": trips,
        "created_at": str(row["created_at"]),
        "created_by": row["created_by"],
        "created_by_name": created_by_name,
        "updated_at": row["updated_at"],
        "lines": lines,
        "ops": ops,
        "sku_count": len(lines),
        "total_qty": sum(l["qty"] for l in lines),
    }
