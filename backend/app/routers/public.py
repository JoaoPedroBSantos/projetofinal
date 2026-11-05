"""Rotas públicas: cardápio, horários e criação de pedidos."""

import re
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..business_hours import (
    is_open_datetime,
    load_hours,
    now_local,
    public_status,
    serialize_day,
    to_local,
)
from ..config import get_settings
from ..database import get_session
from ..models import (
    Addon,
    Category,
    Order,
    OrderItem,
    OrderItemAddon,
    Product,
    ProductAddon,
)
from ..rate_limit import check_order_limit
from ..schemas import OrderIn

router = APIRouter(prefix="/api", tags=["public"])
settings = get_settings()


@router.get("/categories")
async def list_categories(session: AsyncSession = Depends(get_session)):
    """Categorias na ordem do cardápio (podem existir sem produtos)."""
    categories = (
        await session.scalars(select(Category).order_by(Category.sort, Category.id))
    ).all()
    return [
        {"id": category.id, "name": category.name, "slug": category.slug}
        for category in categories
    ]


@router.get("/products")
async def list_products(session: AsyncSession = Depends(get_session)):
    """Cardápio público: só disponíveis, sem custo e sem estoque zerado."""
    result = await session.scalars(
        select(Product)
        .where(
            Product.available.is_(True),
            or_(Product.stock.is_(None), Product.stock > 0),
        )
        .order_by(Product.sort, Product.id)
    )
    products = list(result.all())

    rows = await session.execute(
        select(
            ProductAddon.product_id,
            ProductAddon.price_cents,
            ProductAddon.priced,
            Addon,
        )
        .join(Addon, Addon.id == ProductAddon.addon_id)
        .where(Addon.available.is_(True), ProductAddon.priced.is_(True))
        .order_by(Addon.id)
    )
    addons_by_product: dict[int, list[dict]] = defaultdict(list)
    for product_id, price_cents, priced, addon in rows.all():
        addons_by_product[product_id].append(
            {
                "id": addon.id,
                "name": addon.name,
                "price_cents": price_cents,
                "priced": priced,
            }
        )

    return [
        {
            "id": product.id,
            "name": product.name,
            "category_id": product.category_id,
            "category": product.category.slug,
            "category_name": product.category.name,
            "price_cents": product.price_cents,
            "image": product.image,
            "featured": product.featured,
            "addons": addons_by_product.get(product.id, []),
        }
        for product in products
    ]


@router.get("/business-hours")
async def business_hours(session: AsyncSession = Depends(get_session)):
    """Horários da semana + se o estabelecimento está aberto agora."""
    return public_status(await load_hours(session))


@router.get("/hours")
async def business_hours_alias(session: AsyncSession = Depends(get_session)):
    """Lista simples por dia (formato usado pelo popup "Horários" do site)."""
    return [serialize_day(hour) for hour in await load_hours(session)]


@router.post("/orders", status_code=201)
async def create_order(
    payload: OrderIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    check_order_limit(request, settings.order_rate_limit, settings.order_rate_window)

    name = payload.customer.name.strip()[:80]
    phone = re.sub(r"\D", "", payload.customer.phone)
    if not name:
        raise HTTPException(400, "Informe seu nome.")
    if not 10 <= len(phone) <= 13:
        raise HTTPException(400, "Informe um telefone válido com DDD.")

    async with session.begin():
        hours = await load_hours(session)
        at = now_local()
        delivery_at = (
            to_local(payload.delivery_at) if payload.delivery_at is not None else None
        )

        if delivery_at is not None:
            # Pedido agendado: pode ser feito com a loja fechada, desde que o
            # horário escolhido seja futuro e esteja dentro do funcionamento.
            if delivery_at <= at:
                raise HTTPException(
                    400, "Escolha uma data e um horário futuros para o pedido."
                )
            if not is_open_datetime(hours, delivery_at):
                raise HTTPException(
                    409,
                    "Escolha um horário dentro dos nossos horários de funcionamento.",
                )
        elif not is_open_datetime(hours, at):
            raise HTTPException(
                409,
                "Hoje não estamos atendendo. Confira nossos horários de funcionamento.",
            )

        product_ids = {item.product_id for item in payload.items}
        result = await session.execute(
            select(Product).where(Product.id.in_(product_ids)).with_for_update()
        )
        products = {product.id: product for product in result.scalars().all()}

        lines: list[tuple[Product, int, list[dict], str]] = []
        wanted: dict[int, int] = defaultdict(int)

        for item in payload.items:
            product = products.get(item.product_id)
            if product is None or not product.available:
                raise HTTPException(400, "Um dos produtos não está mais disponível.")

            addon_ids = list(dict.fromkeys(item.addon_ids))
            addons: list[dict] = []
            if addon_ids:
                rows = await session.execute(
                    select(
                        Addon,
                        ProductAddon.price_cents,
                        ProductAddon.cost_cents,
                    )
                    .join(ProductAddon, ProductAddon.addon_id == Addon.id)
                    .where(
                        Addon.id.in_(addon_ids),
                        ProductAddon.product_id == product.id,
                        ProductAddon.priced.is_(True),
                        Addon.available.is_(True),
                    )
                )
                found = {
                    addon.id: (addon, price_cents, cost_cents)
                    for addon, price_cents, cost_cents in rows.all()
                }
                for addon_id in addon_ids:
                    row = found.get(addon_id)
                    if row is None:
                        raise HTTPException(
                            400, f"Adicional indisponível para {product.name}."
                        )
                    addon, price_cents, cost_cents = row
                    addons.append(
                        {
                            "name": addon.name,
                            "price_cents": price_cents,
                            "cost_cents": cost_cents,
                        }
                    )

            lines.append(
                (product, item.qty, addons, item.note.strip()[:200])
            )
            wanted[product.id] += item.qty

        # Estoque: confere tudo antes de baixar (e as linhas estão travadas).
        for product_id, qty in wanted.items():
            product = products[product_id]
            if product.stock is not None:
                if product.stock < qty:
                    raise HTTPException(
                        400, f"Estoque insuficiente para {product.name}."
                    )
                product.stock -= qty

        total_cents = sum(
            qty * (product.price_cents + sum(addon["price_cents"] for addon in addons))
            for product, qty, addons, _ in lines
        )

        note = (payload.note or "").strip()[:500] or None
        order = Order(
            customer_name=name,
            customer_phone=phone,
            status="novo",
            total_cents=total_cents,
            delivery_type=payload.delivery_type,
            delivery_at=delivery_at,
            delivery_address=(payload.delivery_address or "").strip()[:255] or None,
            note=note,
        )
        session.add(order)
        await session.flush()

        for product, qty, addons, item_note in lines:
            order_item = OrderItem(
                order_id=order.id,
                product_id=product.id,
                name=product.name,
                qty=qty,
                unit_price_cents=product.price_cents,
                unit_cost_cents=product.cost_cents,
                note=item_note,
            )
            session.add(order_item)
            await session.flush()
            for addon in addons:
                session.add(
                    OrderItemAddon(
                        order_item_id=order_item.id,
                        name=addon["name"],
                        price_cents=addon["price_cents"],
                        cost_cents=addon["cost_cents"],
                    )
                )

    return {
        "id": order.id,
        "total_cents": total_cents,
        "delivery_type": order.delivery_type,
        "delivery_at": delivery_at.isoformat(timespec="minutes") if delivery_at else None,
    }
