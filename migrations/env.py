import os
import sys
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool
from alembic import context

# --- добавляем доступ к корню проекта ---
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# --- load .env ---
load_dotenv()

# --- Alembic config ---
config = context.config

# --- database url ---
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in .env")

config.set_main_option("sqlalchemy.url", DATABASE_URL)

# --- logging ---
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# --- IMPORT MODELS ---
from models import Base

# ВАЖНО: именно это нужно для autogenerate
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")

    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()