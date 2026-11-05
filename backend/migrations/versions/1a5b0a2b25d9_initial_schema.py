"""initial schema

Revision ID: 1a5b0a2b25d9
Revises:
Create Date: 2026-10-30 19:39:18.964202

Cria o schema base das Delícias Gourmet: catálogo (products/addons), pedidos
(orders/order_items/order_item_addons) e horários de funcionamento.
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '1a5b0a2b25d9'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'addons',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('price_cents', sa.Integer(), nullable=False),
        sa.Column('cost_cents', sa.Integer(), nullable=False),
        sa.Column('available', sa.Boolean(), nullable=False),
        sa.Column('priced', sa.Boolean(), nullable=False),
        sa.CheckConstraint('cost_cents >= 0', name='ck_addons_cost'),
        sa.CheckConstraint('price_cents >= 0', name='ck_addons_price'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    op.create_table(
        'business_hours',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('weekday', sa.SmallInteger(), nullable=False),
        sa.Column('is_open', sa.Boolean(), nullable=False),
        sa.Column('opens_at', sa.Time(), nullable=True),
        sa.Column('closes_at', sa.Time(), nullable=True),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.CheckConstraint('weekday BETWEEN 0 AND 6', name='ck_business_hours_weekday'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('weekday', name='uq_business_hours_weekday'),
    )
    op.create_table(
        'orders',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('customer_name', sa.String(length=80), nullable=False),
        sa.Column('customer_phone', sa.String(length=13), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('total_cents', sa.Integer(), nullable=False),
        sa.Column('cancel_loss', sa.Boolean(), nullable=False),
        sa.Column('delivery_type', sa.String(length=20), nullable=True),
        sa.Column('delivery_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivery_address', sa.String(length=255), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('novo', 'concluido', 'cancelado')", name='ck_orders_status'
        ),
        sa.CheckConstraint('total_cents >= 0', name='ck_orders_total'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_orders_status_id', 'orders', ['status', 'id'], unique=False)
    op.create_table(
        'products',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('price_cents', sa.Integer(), nullable=False),
        sa.Column('cost_cents', sa.Integer(), nullable=False),
        sa.Column('image', sa.String(length=255), nullable=True),
        sa.Column('available', sa.Boolean(), nullable=False),
        sa.Column('stock', sa.Integer(), nullable=True),
        sa.Column('featured', sa.Boolean(), nullable=False),
        sa.Column('sort', sa.Integer(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.CheckConstraint(
            "category IN ('salgados', 'doces')", name='ck_products_category'
        ),
        sa.CheckConstraint('cost_cents >= 0', name='ck_products_cost'),
        sa.CheckConstraint('price_cents >= 0', name='ck_products_price'),
        sa.CheckConstraint('stock IS NULL OR stock >= 0', name='ck_products_stock'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'order_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('qty', sa.Integer(), nullable=False),
        sa.Column('unit_price_cents', sa.Integer(), nullable=False),
        sa.Column('unit_cost_cents', sa.Integer(), nullable=False),
        sa.Column('note', sa.String(length=200), nullable=False),
        sa.CheckConstraint('qty > 0', name='ck_order_items_qty'),
        sa.CheckConstraint('unit_cost_cents >= 0', name='ck_order_items_cost'),
        sa.CheckConstraint('unit_price_cents >= 0', name='ck_order_items_price'),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'product_addons',
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('addon_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['addon_id'], ['addons.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('product_id', 'addon_id'),
    )
    op.create_table(
        'order_item_addons',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('order_item_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('price_cents', sa.Integer(), nullable=False),
        sa.Column('cost_cents', sa.Integer(), nullable=False),
        sa.CheckConstraint('cost_cents >= 0', name='ck_order_item_addons_cost'),
        sa.CheckConstraint('price_cents >= 0', name='ck_order_item_addons_price'),
        sa.ForeignKeyConstraint(['order_item_id'], ['order_items.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('order_item_addons')
    op.drop_table('product_addons')
    op.drop_table('order_items')
    op.drop_table('products')
    op.drop_index('ix_orders_status_id', table_name='orders')
    op.drop_table('orders')
    op.drop_table('business_hours')
    op.drop_table('addons')
