"""Rename migration-era receipt/shipment table names.

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-27
"""

from __future__ import annotations

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _rename_table_sql(old_name: str, new_name: str) -> str:
    return f"""
    DO $$
    BEGIN
        IF to_regclass('public.{old_name}') IS NOT NULL
           AND to_regclass('public.{new_name}') IS NULL THEN
            ALTER TABLE {old_name} RENAME TO {new_name};
        ELSIF to_regclass('public.{old_name}') IS NOT NULL
              AND to_regclass('public.{new_name}') IS NOT NULL THEN
            RAISE EXCEPTION 'Both {old_name} and {new_name} exist; manual merge is required';
        END IF;
    END $$;
    """


def _rename_index_sql(old_name: str, new_name: str) -> str:
    return f"""
    DO $$
    BEGIN
        IF to_regclass('public.{old_name}') IS NOT NULL
           AND to_regclass('public.{new_name}') IS NULL THEN
            ALTER INDEX {old_name} RENAME TO {new_name};
        END IF;
    END $$;
    """


def upgrade() -> None:
    from alembic import op

    table_renames = [
        ("receipt2_docs", "receipt_docs"),
        ("receipt2_lines", "receipt_lines"),
        ("receipt2_ops", "receipt_ops"),
        ("shipment2_docs", "shipment_docs"),
        ("shipment2_lines", "shipment_lines"),
        ("shipment2_ops", "shipment_ops"),
    ]
    index_renames = [
        ("idx_r2docs_client", "idx_receipt_docs_client"),
        ("idx_r2lines_doc", "idx_receipt_lines_doc"),
        ("idx_r2ops_doc", "idx_receipt_ops_doc"),
        ("idx_s2docs_client", "idx_shipment_docs_client"),
        ("idx_s2lines_doc", "idx_shipment_lines_doc"),
        ("idx_s2ops_doc", "idx_shipment_ops_doc"),
    ]

    for old_name, new_name in table_renames:
        op.execute(_rename_table_sql(old_name, new_name))
    for old_name, new_name in index_renames:
        op.execute(_rename_index_sql(old_name, new_name))


def downgrade() -> None:
    from alembic import op

    table_renames = [
        ("shipment_ops", "shipment2_ops"),
        ("shipment_lines", "shipment2_lines"),
        ("shipment_docs", "shipment2_docs"),
        ("receipt_ops", "receipt2_ops"),
        ("receipt_lines", "receipt2_lines"),
        ("receipt_docs", "receipt2_docs"),
    ]
    index_renames = [
        ("idx_shipment_ops_doc", "idx_s2ops_doc"),
        ("idx_shipment_lines_doc", "idx_s2lines_doc"),
        ("idx_shipment_docs_client", "idx_s2docs_client"),
        ("idx_receipt_ops_doc", "idx_r2ops_doc"),
        ("idx_receipt_lines_doc", "idx_r2lines_doc"),
        ("idx_receipt_docs_client", "idx_r2docs_client"),
    ]

    for old_name, new_name in table_renames:
        op.execute(_rename_table_sql(old_name, new_name))
    for old_name, new_name in index_renames:
        op.execute(_rename_index_sql(old_name, new_name))
