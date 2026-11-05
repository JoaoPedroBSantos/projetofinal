"""Modelos ORM (PostgreSQL).

O cardápio/pedidos seguem o formato que o SPA já consome. O horário de
funcionamento fica em uma única tabela (`business_hours`), uma linha por dia da
semana (0 = domingo ... 6 = sábado, igual ao `Date.getDay()` do JavaScript).
"""

from datetime import datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Category(Base):
    """Categoria do cardápio (N produtos : 1 categoria)."""

    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("name", name="uq_categories_name"),
        UniqueConstraint("slug", name="uq_categories_slug"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    # Identificador estável usado na API/SEO (ex.: "salgados").
    slug: Mapped[str] = mapped_column(String(40), nullable=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    products: Mapped[list["Product"]] = relationship(
        back_populates="category", passive_deletes=True
    )


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("price_cents >= 0", name="ck_products_price"),
        CheckConstraint("cost_cents >= 0", name="ck_products_cost"),
        CheckConstraint("stock IS NULL OR stock >= 0", name="ck_products_stock"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    category: Mapped[Category] = relationship(
        back_populates="products", lazy="selectin"
    )
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    image: Mapped[str | None] = mapped_column(String(255))
    available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # NULL = produto sem controle de estoque.
    stock: Mapped[int | None] = mapped_column(Integer)
    featured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    order_items: Mapped[list["OrderItem"]] = relationship(
        back_populates="product", passive_deletes=True
    )


class Addon(Base):
    __tablename__ = "addons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ProductAddon(Base):
    """Vínculo produto–adicional, com o preço válido para aquele produto."""

    __tablename__ = "product_addons"
    __table_args__ = (
        CheckConstraint("price_cents >= 0", name="ck_product_addons_price"),
        CheckConstraint("cost_cents >= 0", name="ck_product_addons_cost"),
    )

    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    )
    addon_id: Mapped[int] = mapped_column(
        ForeignKey("addons.id", ondelete="CASCADE"), primary_key=True
    )
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # False = preço ainda não definido para este produto: aparece no painel,
    # mas não para o cliente.
    priced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(
            "status IN ('novo', 'concluido', 'cancelado')", name="ck_orders_status"
        ),
        CheckConstraint("total_cents >= 0", name="ck_orders_total"),
        Index("ix_orders_status_id", "status", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_name: Mapped[str] = mapped_column(String(80), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(13), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="novo")
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    # Pedido cancelado depois de já ter sido produzido: o custo vira prejuízo.
    cancel_loss: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Campos do escopo (opcionais por enquanto: o SPA atual só envia cliente/itens).
    delivery_type: Mapped[str | None] = mapped_column(String(20))
    delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivery_address: Mapped[str | None] = mapped_column(String(255))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_order_items_qty"),
        CheckConstraint("unit_price_cents >= 0", name="ck_order_items_price"),
        CheckConstraint("unit_cost_cents >= 0", name="ck_order_items_cost"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str] = mapped_column(String(200), nullable=False, default="")

    order: Mapped[Order] = relationship(back_populates="items")
    product: Mapped[Product | None] = relationship(back_populates="order_items")
    addons: Mapped[list["OrderItemAddon"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )


class OrderItemAddon(Base):
    __tablename__ = "order_item_addons"
    __table_args__ = (
        CheckConstraint("price_cents >= 0", name="ck_order_item_addons_price"),
        CheckConstraint("cost_cents >= 0", name="ck_order_item_addons_cost"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    item: Mapped[OrderItem] = relationship(back_populates="addons")


class BusinessHour(Base):
    """Uma linha por dia da semana (0 = domingo ... 6 = sábado)."""

    __tablename__ = "business_hours"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_business_hours_weekday"),
        UniqueConstraint("weekday", name="uq_business_hours_weekday"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    is_open: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    opens_at: Mapped[time | None] = mapped_column(Time)
    closes_at: Mapped[time | None] = mapped_column(Time)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
