"""Общие мелкие хелперы backend-модулей (время, номера документов, даты).

Без FastAPI-зависимостей, кроме HTTPException (как в service-слое).
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import HTTPException


def now_iso() -> str:
    """Текущий момент UTC строкой ISO 8601 — канонический формат created_at/updated_at."""
    return datetime.now(UTC).isoformat()


def next_doc_number(connection, *, table: str, prefix: str, width: int) -> str:
    """Следующий номер документа вида `{prefix}NNNN` по таблице `table`.

    MAX подстроки вместо COUNT, чтобы дырки в нумерации не давали дубликатов;
    UNIQUE constraint на doc_number гарантирует атомарность.
    `table`/`prefix` приходят только из кода (константы модулей), не из запроса.
    """
    start = len(prefix) + 1
    row = connection.execute(
        f"""
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, {start}) AS INTEGER)), 0) AS max_n
        FROM {table}
        WHERE doc_number LIKE '{prefix}%' AND SUBSTR(doc_number, {start}) ~ '^[0-9]+$'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"{prefix}{n:0{width}d}"


# Разумные границы бизнес-дат документов: раньше 2020 года склад не существовал,
# планирование дальше чем на 2 года вперёд — почти наверняка опечатка в годе.
BUSINESS_DATE_MIN = date(2020, 1, 1)
BUSINESS_DATE_MAX_AHEAD_DAYS = 730


def validate_business_date(value, *, field_ru: str) -> str | None:
    """Нормализует бизнес-дату документа: пусто → None, иначе YYYY-MM-DD в разумном диапазоне.

    400 с русским detail при мусоре или дате вне диапазона (например, 1991 год).
    """
    s = (str(value) if value is not None else "").strip()
    if not s:
        return None
    try:
        d = date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field_ru}: укажите дату в формате ГГГГ-ММ-ДД")
    if d < BUSINESS_DATE_MIN or d > date.today() + timedelta(days=BUSINESS_DATE_MAX_AHEAD_DAYS):
        raise HTTPException(
            status_code=400,
            detail=f"{field_ru}: дата {d.isoformat()} вне допустимого диапазона",
        )
    return d.isoformat()


def size_order_sql(sort_order_col: str, size_name_col: str) -> str:
    """ORDER BY-фрагмент «размеры по сетке»: sort_order справочника, затем размер.

    Пока sort_order у размера не заполнен, сортировка по имени ставит 104 перед 48
    (текстовое сравнение), поэтому числовые размеры сравниваются как числа.
    """
    return (
        f"{sort_order_col} IS NULL, {sort_order_col}, "
        f"COALESCE({size_name_col}, '') !~ '^[0-9]+$', "
        f"CASE WHEN {size_name_col} ~ '^[0-9]+$' THEN {size_name_col}::bigint END, "
        f"{size_name_col} NULLS FIRST"
    )


def qr_svg(payload: str) -> str:
    """QR-код строкой SVG для печатных этикеток (места хранения, короба).

    segno отдаёт фиксированные width/height без viewBox — при CSS-масштабе рисунок
    не тянется под размер этикетки, поэтому viewBox добавляется вручную.
    """
    import io
    import re

    try:
        import segno
    except ImportError as exc:  # сборка backend без segno
        raise HTTPException(
            status_code=503,
            detail="QR-генератор не установлен (segno). Пересоберите backend.",
        ) from exc
    qr = segno.make(payload, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=4, border=2, xmldecl=False, svgns=True)
    svg = buf.getvalue().decode("utf-8")
    if "viewBox" not in svg:
        m = re.search(r'<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"', svg)
        if m:
            svg = svg.replace("<svg", f'<svg viewBox="0 0 {m.group(1)} {m.group(2)}"', 1)
    return svg


# Code 128: ширины элементов (штрих/пробел, чередуя, первый — штрих) по значению
# символа. 0..102 — данные, 103..105 — старты A/B/C, 106 — стоп.
_CODE128_PATTERNS = (
    "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 "
    "221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 "
    "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 "
    "212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 "
    "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 "
    "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 "
    "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 "
    "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 "
    "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 "
    "214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 "
    "114131 311141 411131 211412 211214 211232 2331112"
).split()

_CODE128_CODE_B = 100
_CODE128_CODE_C = 99
_CODE128_START_B = 104
_CODE128_START_C = 105
_CODE128_STOP = 106
# Тихая зона по стандарту — не меньше 10 модулей с каждой стороны. Держим её внутри
# SVG: иначе вёрстка этикетки, прижавшая код к краю, ломает считывание.
_CODE128_QUIET = 10


def _code128_values(code: str) -> list[int]:
    """Символы Code 128 для строки: набор B с переходом в C на сериях цифр.

    Плотность здесь не косметика: 13-значный код набором B — 178 модулей, то есть
    вся ширина этикетки 43 мм без запаса, а набором C — 123 модуля.
    """
    n = len(code)

    def digits_from(start: int) -> int:
        i = start
        while i < n and code[i].isdigit():
            i += 1
        return i - start

    def value_b(ch: str) -> int:
        if not (32 <= ord(ch) <= 126):
            raise HTTPException(
                status_code=400,
                detail=f"Штрих-код «{code}» содержит символы, которые не печатаются в Code 128",
            )
        return ord(ch) - 32

    lead = digits_from(0)
    numeric_mode = lead >= 4 or (lead == n and n >= 2)
    values = [_CODE128_START_C if numeric_mode and lead % 2 == 0 else _CODE128_START_B]
    mode_c = values[0] == _CODE128_START_C
    i = 0
    while i < n:
        if mode_c:
            if i + 1 < n and code[i].isdigit() and code[i + 1].isdigit():
                values.append(int(code[i:i + 2]))
                i += 2
            else:
                values.append(_CODE128_CODE_B)
                mode_c = False
            continue
        run = digits_from(i)
        if run >= 6 or (run == n - i and run >= 4):
            if run % 2 == 1:
                values.append(value_b(code[i]))
                i += 1
            values.append(_CODE128_CODE_C)
            mode_c = True
            continue
        values.append(value_b(code[i]))
        i += 1
    check = values[0]
    for pos, value in enumerate(values[1:], start=1):
        check += pos * value
    values.append(check % 103)
    values.append(_CODE128_STOP)
    return values


def barcode_svg(code: str) -> tuple[str, int]:
    """Штрих-код Code 128 строкой SVG + его ширина в модулях (с тихими зонами).

    Ширина в модулях уезжает на фронт, чтобы лист этикеток печатал код с
    постоянной толщиной модуля: растянутый на всю этикетку длинный код даёт
    штрих тоньше точки термопринтера и не читается сканером.
    """
    text = str(code or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Пустой штрих-код не напечатать")
    x = _CODE128_QUIET
    bars: list[str] = []
    for value in _code128_values(text):
        is_bar = True
        for width in _CODE128_PATTERNS[value]:
            w = int(width)
            if is_bar:
                bars.append(f'<rect x="{x}" y="0" width="{w}" height="10"/>')
            x += w
            is_bar = not is_bar
    modules = x + _CODE128_QUIET
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {modules} 10" '
        f'preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">'
        f'{"".join(bars)}</svg>'
    )
    return svg, modules
