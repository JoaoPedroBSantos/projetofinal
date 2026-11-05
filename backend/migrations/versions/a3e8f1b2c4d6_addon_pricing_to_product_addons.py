"""move addon pricing to product_addons

Revision ID: a3e8f1b2c4d6
Revises: 7c2f5d9a4b10
Create Date: 2026-10-31 19:25:00.000000

Move price_cents, cost_cents and priced from the addons table to product_addons
so that each product can define its own price for each add-on.
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a3e8f1b2c4d6'
down_revision: str | None = '7c2f5d9a4b10'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add pricing columns to product_addons.
    op.add_column(
        'product_addons',
        sa.Column('price_cents', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'product_addons',
        sa.Column('cost_cents', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'product_addons',
        sa.Column('priced', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.create_check_constraint(
        'ck_product_addons_price', 'product_addons', 'price_cents >= 0'
    )
    op.create_check_constraint(
        'ck_product_addons_cost', 'product_addons', 'cost_cents >= 0'
    )

    # 2. Copy existing prices from addons into every product_addons link.
    op.execute(
        "UPDATE product_addons pa "
        "SET price_cents = a.price_cents, "
        "    cost_cents  = a.cost_cents, "
        "    priced      = a.priced "
        "FROM addons a WHERE a.id = pa.addon_id"
    )

    # 3. Drop server defaults (they were only for the migration).
    op.alter_column('product_addons', 'price_cents', server_default=None)
    op.alter_column('product_addons', 'cost_cents', server_default=None)
    op.alter_column('product_addons', 'priced', server_default=None)

    # 4. Remove pricing columns from addons.
    op.drop_constraint('ck_addons_price', 'addons', type_='check')
    op.drop_constraint('ck_addons_cost', 'addons', type_='check')
    op.drop_column('addons', 'price_cents')
    op.drop_column('addons', 'cost_cents')
    op.drop_column('addons', 'priced')


def downgrade() -> None:
    # 1. Re-add pricing columns to addons.
    op.add_column(
        'addons',
        sa.Column('price_cents', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'addons',
        sa.Column('cost_cents', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'addons',
        sa.Column('priced', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.create_check_constraint('ck_addons_price', 'addons', 'price_cents >= 0')
    op.create_check_constraint('ck_addons_cost', 'addons', 'cost_cents >= 0')

    # 2. Copy the first encountered price back (arbitrary if different per product).
    op.execute(
        "UPDATE addons a "
        "SET price_cents = pa.price_cents, "
        "    cost_cents  = pa.cost_cents, "
        "    priced      = pa.priced "
        "FROM ( "
        "  SELECT DISTINCT ON (addon_id) addon_id, price_cents, cost_cents, priced "
        "  FROM product_addons ORDER BY addon_id, product_id "
        ") pa WHERE pa.addon_id = a.id"
    )

    # 3. Drop server defaults.
    op.alter_column('addons', 'price_cents', server_default=None)
    op.alter_column('addons', 'cost_cents', server_default=None)
    op.alter_column('addons', 'priced', server_default=None)

    # 4. Remove pricing columns from product_addons.
    op.drop_constraint('ck_product_addons_price', 'product_addons', type_='check')
    op.drop_constraint('ck_product_addons_cost', 'product_addons', type_='check')
    op.drop_column('product_addons', 'price_cents')
    op.drop_column('product_addons', 'cost_cents')
    op.drop_column('product_addons', 'priced')
