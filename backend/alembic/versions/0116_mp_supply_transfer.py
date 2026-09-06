"""FBS-поставка: передача площадке и корректировка состава.

mp_transferred_at — момент, когда менеджер передал поставку площадке: у WB в этот
момент заводится поставка продавца и в неё уходят все задания, у Ozon состав
просто фиксируется. После отметки состав не правится, поставка не аннулируется,
и только с неё доступна лента этикеток.

correcting_at — начало последней корректировки состава (статус correcting).

Revision ID: 0116
Revises: 0115
"""

from __future__ import annotations

revision = "0116"
down_revision = "0115"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE mp_supplies ADD COLUMN IF NOT EXISTS mp_transferred_at TEXT")
    op.execute("ALTER TABLE mp_supplies ADD COLUMN IF NOT EXISTS correcting_at TEXT")
    # Поставки, уже заведённые у WB лентой этикеток или упаковкой, считаются
    # переданными: снять их с площадки всё равно нечем.
    op.execute(
        "UPDATE mp_supplies SET mp_transferred_at = COALESCE(mp_transferred_at, updated_at) "
        "WHERE external_supply_id IS NOT NULL AND external_supply_id <> ''"
    )


def downgrade() -> None:
    from alembic import op

    op.execute("ALTER TABLE mp_supplies DROP COLUMN IF EXISTS correcting_at")
    op.execute("ALTER TABLE mp_supplies DROP COLUMN IF EXISTS mp_transferred_at")
