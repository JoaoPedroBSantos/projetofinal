"""Schemas de entrada da API (Pydantic v2)."""

from datetime import datetime, time
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class CustomerIn(BaseModel):
    name: str = Field(max_length=80)
    phone: str = Field(max_length=20)


class OrderItemIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    product_id: int = Field(validation_alias=AliasChoices("productId", "product_id"))
    qty: int = Field(ge=1, le=50)
    addon_ids: list[int] = Field(
        default_factory=list,
        validation_alias=AliasChoices("addonIds", "addon_ids"),
        max_length=40,
    )
    note: str = Field(default="", max_length=200)


class OrderIn(BaseModel):
    customer: CustomerIn
    items: list[OrderItemIn] = Field(min_length=1, max_length=40)
    delivery_type: Literal["retirada", "entrega"] | None = None
    delivery_at: datetime | None = None
    delivery_address: str | None = Field(default=None, max_length=255)
    note: str | None = Field(default=None, max_length=500)


class LoginIn(BaseModel):
    email: str | None = None
    username: str | None = None
    password: str = ""


class ProductAddonIn(BaseModel):
    """Preço do adicional válido para um produto específico."""

    model_config = ConfigDict(populate_by_name=True)

    addon_id: int = Field(
        validation_alias=AliasChoices("addonId", "addon_id"), ge=1
    )
    price_cents: int = Field(default=0, ge=0, le=10_000_000)
    cost_cents: int = Field(default=0, ge=0, le=10_000_000)
    priced: bool = False


class ProductIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=80)
    # Nova forma (FK). `category` aceita o slug/nome para compatibilidade.
    category_id: int | None = Field(default=None, ge=1)
    category: str | None = Field(default=None, max_length=40)
    price_cents: int = Field(ge=0, le=10_000_000)
    cost_cents: int = Field(default=0, ge=0, le=10_000_000)
    stock: int | None = Field(default=None, ge=0, le=99_999)
    available: bool
    addons: list[ProductAddonIn] = Field(default_factory=list, max_length=100)
    # Compatibilidade: vínculos sem preço definido (priced=False).
    addon_ids: list[int] = Field(
        default_factory=list,
        validation_alias=AliasChoices("addonIds", "addon_ids"),
        max_length=100,
    )
    image: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    featured: bool = False


class ProductPatchIn(BaseModel):
    available: bool | None = None
    stock: int | None = Field(default=None, ge=0, le=99_999)


class AddonIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    # Aceito por compatibilidade; o preço agora vive em product_addons.
    price_cents: int | None = Field(default=None, ge=0, le=10_000_000)


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    sort: int | None = Field(default=None, ge=0, le=99_999)


class CategoryPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    sort: int | None = Field(default=None, ge=0, le=99_999)


class AddonPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    # Compatibilidade: quando enviado, atualiza o preço em todos os vínculos.
    price_cents: int | None = Field(default=None, ge=0, le=10_000_000)


class OrderStatusIn(BaseModel):
    status: Literal["novo", "concluido", "cancelado"]
    loss: bool = False


class HoursUpdateIn(BaseModel):
    """Aceita `open` (painel) ou `is_open`, e `open_time`/`close_time` (SPA novo)."""

    model_config = ConfigDict(populate_by_name=True)

    open: bool | None = Field(
        default=None, validation_alias=AliasChoices("open", "is_open")
    )
    opens_at: time | None = Field(
        default=None, validation_alias=AliasChoices("opens_at", "open_time")
    )
    closes_at: time | None = Field(
        default=None, validation_alias=AliasChoices("closes_at", "close_time")
    )
