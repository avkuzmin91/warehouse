"""Очистка тестовых данных: товары, варианты, приёмка/отгрузка/остатки (через inventory_operations)."""
from __future__ import annotations

import os
from pathlib import Path

from dbconn import get_connection


def _resolve_uploads_dir() -> Path:
    raw = (os.environ.get("WAREHOUSE_UPLOADS_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return Path(__file__).resolve().parent / "uploads"


UPLOADS_DIR = _resolve_uploads_dir()


def main() -> None:
    with get_connection() as conn:
        try:
            n_ops = conn.execute("DELETE FROM inventory_operations").rowcount
            n_var = conn.execute("DELETE FROM product_variants").rowcount
            n_prod = conn.execute("DELETE FROM products").rowcount
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        print(
            f"OK: удалено операций учёта: {n_ops}, вариантов: {n_var}, товаров: {n_prod}"
        )

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
