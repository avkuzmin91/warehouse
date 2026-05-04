"""Очистка тестовых данных: товары, варианты, приёмка/отгрузка/остатки (через inventory_operations)."""
from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "auth.db"
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"


def main() -> None:
    if not DB_PATH.is_file():
        raise SystemExit(f"БД не найдена: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("BEGIN")
        # Порядок: операции → варианты → товары (остатки — агрегат по операциям).
        cur = conn.execute("DELETE FROM inventory_operations")
        n_ops = cur.rowcount
        cur = conn.execute("DELETE FROM product_variants")
        n_var = cur.rowcount
        cur = conn.execute("DELETE FROM products")
        n_prod = cur.rowcount
        conn.commit()
        print(
            f"OK: удалено операций учёта: {n_ops}, вариантов: {n_var}, товаров: {n_prod}"
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    removed = 0
    if UPLOADS_DIR.is_dir():
        for p in UPLOADS_DIR.iterdir():
            if p.is_file() and p.suffix.lower() in (
                ".jpg",
                ".jpeg",
                ".png",
                ".webp",
                ".heic",
                ".gif",
            ):
                try:
                    p.unlink()
                    removed += 1
                except OSError as e:
                    print(f"Предупреждение: не удалось удалить {p}: {e}")
    print(f"OK: удалено файлов в uploads: {removed}")


if __name__ == "__main__":
    main()
