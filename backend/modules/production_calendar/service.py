"""Производственный календарь склада: рабочие/нерабочие дни.

Правило по умолчанию — рабочая неделя 6/1: рабочий день = любой день, кроме
воскресенья. Таблица production_calendar хранит только исключения и перебивает
правило в обе стороны (праздник/закрытие делает рабочий день нерабочим; выход
в воскресенье — наоборот). Используется делителем «рабочих дней в месяце» при
дневной разбивке оклада в аналитике и при начислении оклада в реестр.
"""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

# Python date.weekday(): Mon=0 … Sun=6. По умолчанию нерабочее — воскресенье.
_DEFAULT_OFF_WEEKDAY = 6


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _default_is_working(d: date) -> bool:
    return d.weekday() != _DEFAULT_OFF_WEEKDAY


def load_overrides(connection, date_from: str, date_to: str) -> dict[str, bool]:
    """{cal_date_iso → is_working} для исключений в диапазоне [date_from..date_to] вкл."""
    rows = connection.execute(
        "SELECT cal_date, is_working FROM production_calendar "
        "WHERE COALESCE(is_deleted, 0) = 0 AND cal_date >= ? AND cal_date <= ?",
        (date_from[:10], date_to[:10]),
    ).fetchall()
    return {str(r["cal_date"])[:10]: bool(int(r["is_working"])) for r in rows}


def is_working_day(connection, d: date) -> bool:
    """Рабочий ли день: исключение из календаря либо правило 6/1."""
    iso = d.isoformat()
    row = connection.execute(
        "SELECT is_working FROM production_calendar "
        "WHERE cal_date = ? AND COALESCE(is_deleted, 0) = 0",
        (iso,),
    ).fetchone()
    if row is not None:
        return bool(int(row["is_working"]))
    return _default_is_working(d)


def working_days_of_month(
    connection, year: int, month: int, *, overrides: dict[str, bool] | None = None
) -> list[date]:
    """Упорядоченный список рабочих дней месяца с учётом производственного календаря.

    overrides — предзагруженная карта исключений (чтобы не дёргать БД на каждый месяц);
    если не передана, грузится за этот месяц.
    """
    last = calendar.monthrange(year, month)[1]
    if overrides is None:
        overrides = load_overrides(
            connection, date(year, month, 1).isoformat(), date(year, month, last).isoformat()
        )
    out: list[date] = []
    for day in range(1, last + 1):
        d = date(year, month, day)
        working = overrides.get(d.isoformat(), _default_is_working(d))
        if working:
            out.append(d)
    return out


# ── Справочник (CRUD) ─────────────────────────────────────────────────────────

def list_month(connection, year: int, month: int) -> dict:
    """Сводка месяца для справочника: число рабочих дней + список исключений."""
    last = calendar.monthrange(year, month)[1]
    df = date(year, month, 1).isoformat()
    dt = date(year, month, last).isoformat()
    overrides = load_overrides(connection, df, dt)
    rows = connection.execute(
        "SELECT id, cal_date, is_working, reason FROM production_calendar "
        "WHERE COALESCE(is_deleted, 0) = 0 AND cal_date >= ? AND cal_date <= ? "
        "ORDER BY cal_date ASC",
        (df, dt),
    ).fetchall()
    items = [
        {
            "id": str(r["id"]),
            "cal_date": str(r["cal_date"])[:10],
            "is_working": bool(int(r["is_working"])),
            "reason": r["reason"],
        }
        for r in rows
    ]
    return {
        "year": year,
        "month": month,
        "working_days": len(working_days_of_month(connection, year, month, overrides=overrides)),
        "items": items,
    }


def set_day(connection, *, cal_date: str, is_working: bool, reason: str | None, uid: str | None) -> None:
    """Заводит/обновляет исключение на дату (одно действующее на дату)."""
    iso = cal_date[:10]
    existing = connection.execute(
        "SELECT id FROM production_calendar WHERE cal_date = ? AND COALESCE(is_deleted, 0) = 0",
        (iso,),
    ).fetchone()
    if existing:
        connection.execute(
            "UPDATE production_calendar SET is_working = ?, reason = ?, updated_at = ? WHERE id = ?",
            (1 if is_working else 0, reason, _now(), existing["id"]),
        )
        return
    connection.execute(
        "INSERT INTO production_calendar (id, cal_date, is_working, reason, created_at, created_by, is_deleted) "
        "VALUES (?,?,?,?,?,?,0)",
        (str(uuid4()), iso, 1 if is_working else 0, reason, _now(), uid),
    )


def delete_day(connection, cal_date: str) -> bool:
    """Снимает исключение на дату — день возвращается к правилу 6/1."""
    iso = cal_date[:10]
    row = connection.execute(
        "SELECT id FROM production_calendar WHERE cal_date = ? AND COALESCE(is_deleted, 0) = 0",
        (iso,),
    ).fetchone()
    if not row:
        return False
    connection.execute(
        "UPDATE production_calendar SET is_deleted = 1, updated_at = ? WHERE id = ?",
        (_now(), row["id"]),
    )
    return True
