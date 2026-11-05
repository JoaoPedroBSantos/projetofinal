"""categorias do cardápio (produto N:1 categoria)

Revision ID: 7c2f5d9a4b10
Revises: 1a5b0a2b25d9
Create Date: 2026-10-31 09:00:00.000000

Substitui a coluna textual `products.category` por `category_id`, com uma
tabela `categories` própria. As categorias antigas (salgados/doces) são
preservadas e os produtos existentes são migrados para elas.
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '7c2f5d9a4b10'
down_revision: str | None = '1a5b0a2b25d9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'categories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=40), nullable=False),
        sa.Column('slug', sa.String(length=40), nullable=False),
        sa.Column('sort', sa.Integer(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name', name='uq_categories_name'),
        sa.UniqueConstraint('slug', name='uq_categories_slug'),
    )

    # Categorias que o cardápio já usava.
    op.execute(
        "INSERT INTO categories (name, slug, sort) VALUES "
        "('Salgados', 'salgados', 0), ('Doces', 'doces', 1)"
    )

    op.add_column('products', sa.Column('category_id', sa.Integer(), nullable=True))
    op.execute(
        "UPDATE products p SET category_id = c.id "
        "FROM categories c WHERE c.slug = p.category"
    )
    # Qualquer valor inesperado cai em "Doces" (mesmo padrão da API antiga).
    op.execute(
        "UPDATE products SET category_id = "
        "(SELECT id FROM categories WHERE slug = 'doces') "
        "WHERE category_id IS NULL"
    )
    op.alter_column('products', 'category_id', nullable=False)
    op.create_foreign_key(
        'fk_products_category_id',
        'products',
        'categories',
        ['category_id'],
        ['id'],
        ondelete='RESTRICT',
    )
    op.create_index(
        'ix_products_category_id', 'products', ['category_id'], unique=False
    )
    op.drop_constraint('ck_products_category', 'products', type_='check')
    op.drop_column('products', 'category')


def downgrade() -> None:
    op.add_column(
        'products',
        sa.Column('category', sa.String(length=20), nullable=True),
    )
    op.execute(
        "UPDATE products p SET category = c.slug "
        "FROM categories c WHERE c.id = p.category_id"
    )
    op.execute("UPDATE products SET category = 'doces' WHERE category IS NULL")
    op.alter_column('products', 'category', nullable=False)
    op.create_check_constraint(
        'ck_products_category',
        'products',
        "category IN ('salgados', 'doces')",
    )
    op.drop_index('ix_products_category_id', table_name='products')
    op.drop_constraint(
        'fk_products_category_id', 'products', type_='foreignkey'
    )
    op.drop_column('products', 'category_id')
    op.drop_table('categories')
