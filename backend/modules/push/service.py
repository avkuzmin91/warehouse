from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime
from uuid import uuid4

from config import FIREBASE_CREDENTIALS_FILE, PUSH_STORM_THRESHOLD
from modules.tasks.service import (
    ROLE_MANAGER,
    ROLE_SHIFT,
    ROLE_WAREHOUSE,
    ROLE_WAREHOUSE_HEAD,
    list_my_tasks,
)

log = logging.getLogger("wms.push")

# Кому виден каждый ролевый поток задач — зеркало visible_roles в list_my_tasks:
# пуш получают ровно те, у кого задача появится в «Мои задачи».
TASK_ROLE_AUDIENCE: dict[str, tuple[str, ...]] = {
    ROLE_WAREHOUSE: (ROLE_WAREHOUSE, ROLE_WAREHOUSE_HEAD, "admin"),
    ROLE_MANAGER: (ROLE_MANAGER, "admin"),
    ROLE_SHIFT: (ROLE_SHIFT, ROLE_WAREHOUSE_HEAD, "admin"),
    ROLE_WAREHOUSE_HEAD: (ROLE_WAREHOUSE_HEAD, "admin"),
}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def save_push_token(connection, *, user_id: str, token: str, platform: str | None) -> None:
    """Upsert по токену: при перелогине на том же устройстве токен переезжает
    на нового пользователя, а не плодит дубли."""
    existing = connection.execute(
        "SELECT id FROM push_tokens WHERE token = ?", (token,)
    ).fetchone()
    if existing:
        connection.execute(
            "UPDATE push_tokens SET user_id = ?, platform = ?, updated_at = ? WHERE id = ?",
            (user_id, platform, _now(), str(existing["id"])),
        )
    else:
        connection.execute(
            "INSERT INTO push_tokens (id, user_id, token, platform, created_at) VALUES (?,?,?,?,?)",
            (str(uuid4()), user_id, token, platform, _now()),
        )


def remove_push_token(connection, *, token: str) -> None:
    connection.execute("DELETE FROM push_tokens WHERE token = ?", (token,))


# ── FCM ───────────────────────────────────────────────────────────────────────

_fcm_lock = threading.Lock()
_fcm_state: str | None = None  # None = не инициализировали, "ready" | "disabled"


def _ensure_fcm() -> bool:
    """Ленивая инициализация firebase-admin. Без FIREBASE_CREDENTIALS_FILE отправка
    выключена (лог один раз), но дифф задач продолжает вестись — включение ключа
    позже не даст шторма по накопившимся задачам."""
    global _fcm_state
    if _fcm_state is not None:
        return _fcm_state == "ready"
    with _fcm_lock:
        if _fcm_state is not None:
            return _fcm_state == "ready"
        if not FIREBASE_CREDENTIALS_FILE:
            log.warning("FIREBASE_CREDENTIALS_FILE не задан — пуш-уведомления отключены")
            _fcm_state = "disabled"
            return False
        try:
            import firebase_admin
            from firebase_admin import credentials

            firebase_admin.initialize_app(credentials.Certificate(FIREBASE_CREDENTIALS_FILE))
            _fcm_state = "ready"
        except Exception:
            log.exception("Не удалось инициализировать Firebase — пуш-уведомления отключены")
            _fcm_state = "disabled"
    return _fcm_state == "ready"


def _send_push(tokens: list[str], *, title: str, body: str, data: dict[str, str]) -> list[str]:
    """Шлёт пуш на токены, возвращает список невалидных (устройство снесло
    приложение / токен протух) — их надо удалить."""
    from firebase_admin import messaging

    messages = [
        messaging.Message(
            token=t,
            notification=messaging.Notification(title=title, body=body),
            data=data,
            android=messaging.AndroidConfig(priority="high"),
        )
        for t in tokens
    ]
    invalid: list[str] = []
    response = messaging.send_each(messages)
    for token, item in zip(tokens, response.responses):
        if item.exception is None:
            continue
        if isinstance(item.exception, (messaging.UnregisteredError, messaging.SenderIdMismatchError)):
            invalid.append(token)
        else:
            log.warning("Ошибка отправки пуша: %s", item.exception)
    return invalid


def notify_packing_correction(connection, *, doc_id: str, doc_number: str, body: str) -> int:
    """Прямой пуш команде упаковки: менеджер скорректировал задачу, которая уже в работе.

    Аудитория — та же, что у задачи «Упаковать» (ROLE_SHIFT): начальник смены,
    начальник склада, админ. Вызывается после commit основной операции; любая
    ошибка отправки глотается — пуш не должен ломать корректировку.
    """
    try:
        audience = TASK_ROLE_AUDIENCE[ROLE_SHIFT]
        placeholders = ",".join("?" * len(audience))
        rows = connection.execute(
            f"SELECT pt.token FROM push_tokens pt "
            f"JOIN users u ON u.id = pt.user_id "
            f"WHERE COALESCE(u.is_deleted, 0) = 0 AND u.role IN ({placeholders})",
            tuple(audience),
        ).fetchall()
        tokens = [str(r["token"]) for r in rows]
        if not tokens or not _ensure_fcm():
            return 0
        data = {
            "kind": "shipment_pack",
            "doc_type": "shipment",
            "doc_id": doc_id,
            "doc_number": doc_number,
        }
        invalid = _send_push(tokens, title=f"Задача {doc_number} изменена", body=body, data=data)
        for token in invalid:
            remove_push_token(connection, token=token)
        if invalid:
            connection.commit()
        return len(tokens) - len(invalid)
    except Exception:
        log.exception("Не удалось отправить пуш о корректировке задачи упаковки")
        return 0


# ── Дифф задач ────────────────────────────────────────────────────────────────

def notify_new_tasks(connection) -> int:
    """Один тик фонового цикла: пересчитать очередь задач, отправить пуш по новым.

    Задачи вычисляемые (нет события «создана») — сравниваем активный набор с
    push_notified_tasks. Ключ = kind:doc_id; исчезнувшие ключи удаляем, чтобы
    возврат документа в статус (например, задачу упаковки вернули менеджеру и
    поставили заново) снова дал уведомление.
    """
    tasks = list_my_tasks(connection, user={"role": "admin"})
    active = {f"{t['kind']}:{t['doc_id']}": t for t in tasks}

    notified = {
        str(r["task_key"])
        for r in connection.execute("SELECT task_key FROM push_notified_tasks").fetchall()
    }

    for key in notified - active.keys():
        connection.execute("DELETE FROM push_notified_tasks WHERE task_key = ?", (key,))

    # Отметки «прочитано» живут, пока задача активна: возврат документа в статус
    # (ключ исчез и появился снова) делает задачу снова непрочитанной для всех.
    read_keys = {
        str(r["task_key"])
        for r in connection.execute("SELECT DISTINCT task_key FROM task_reads").fetchall()
    }
    for key in read_keys - active.keys():
        connection.execute("DELETE FROM task_reads WHERE task_key = ?", (key,))

    new_items = [(key, task) for key, task in active.items() if key not in notified]

    # Шторм (первичное заполнение после раскатки, массовый импорт) — эти задачи
    # не «новые» для людей, спамить устройства нельзя: записываем молча.
    storm = len(new_items) > PUSH_STORM_THRESHOLD
    if storm and new_items:
        log.warning("Шторм задач: %d новых за тик — записаны без отправки пушей", len(new_items))

    sent = 0
    for key, task in new_items:
        audience = TASK_ROLE_AUDIENCE.get(str(task["role"]), ()) if not storm else ()
        if audience:
            placeholders = ",".join("?" * len(audience))
            rows = connection.execute(
                f"SELECT pt.token FROM push_tokens pt "
                f"JOIN users u ON u.id = pt.user_id "
                f"WHERE COALESCE(u.is_deleted, 0) = 0 AND u.role IN ({placeholders})",
                tuple(audience),
            ).fetchall()
            tokens = [str(r["token"]) for r in rows]
            if tokens and _ensure_fcm():
                data = {
                    "kind": str(task["kind"]),
                    "doc_type": str(task["doc_type"]),
                    "doc_id": str(task["doc_id"]),
                    "doc_number": str(task["doc_number"]),
                }
                invalid = _send_push(tokens, title="Новая задача", body=str(task["title"]), data=data)
                for token in invalid:
                    remove_push_token(connection, token=token)
                sent += len(tokens) - len(invalid)
        connection.execute(
            "INSERT INTO push_notified_tasks (task_key, notified_at) VALUES (?,?)",
            (key, _now()),
        )
    connection.commit()
    return sent
