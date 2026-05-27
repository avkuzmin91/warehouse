from __future__ import annotations

import os
from logging.config import fileConfig

import psycopg
from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

DATABASE_URL = os.environ["DATABASE_URL"]


def run_migrations_offline() -> None:
    context.configure(
        url=DATABASE_URL,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Alembic не знает о psycopg_pool — используем прямое соединение только для миграций.
    connectable = psycopg.connect(DATABASE_URL)
    with connectable:
        context.configure(connection=connectable)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
