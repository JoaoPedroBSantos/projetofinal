"""Rotas do painel administrativo."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..business_hours import load_hours, serialize_day
from ..config import get_settings
from ..database import get_session
from ..models import (
    Addon,
    BusinessHour,
    Category,
    Order,
    OrderItem,
    OrderItemAddon,
    Product,
    ProductAddon,
)
from ..rate_limit import check_login_limit
from ..schemas import (
    AddonIn,
    AddonPatchIn,
    CategoryIn,
    CategoryPatchIn,
    HoursUpdateIn,
    LoginIn,
    OrderStatusIn,
    ProductIn,
    ProductPatchIn,
)
from ..security import (
    COOKIE_NAME,
    check_credentials,
    create_session_token,
    require_admin,
)

settings = get_settings()

# Login/logout não exigem sessão; o resto do painel exige.
auth_router = APIRouter(prefix="/api/admin", tags=["admin"])
router = APIRouter(
    prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)]
)

ORDER_VIEWS = {"open": "novo", "done": "concluido", "canceled": "cancelado"}
TRANSITIONS = {
    "novo": {"concluido", "cancelado"},
    "concluido": {"novo"},
    "cancelado": {"novo"},
}


def _to_iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.session_seconds,
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
        path="/",
    )


# --------------------------------------------------------------------- sessão
@auth_router.post("/login")
async def login(payload: LoginIn, request: Request, response: Response):
    check_login_limit(
        request, settings.login_rate_limit, settings.login_rate_window
    )
    username = (payload.username or payload.email or "").strip()
    if not check_credentials(username, payload.password):
        raise HTTPException(401, "Usuário ou senha incorretos.")
    _set_session_cookie(response, create_session_token(settings.admin_username))
    return {"username": settings.admin_username, "email": settings.admin_username}


@auth_router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
    )
    return {"ok": True}


@router.get("/me")
async def me(username: str = Depends(require_admin)):
    return {"username": username, "email": username}


# ------------------------------------------------------- horário de funcionamento
@router.get("/days")
@router.get("/hours")
@router.get("/business-hours")
async def get_hours(session: AsyncSession = Depends(get_session)):
    return [serialize_day(hour) for hour in await load_hours(session)]


@router.put("/days/{weekday}")
@router.put("/hours/{weekday}")
@router.put("/business-hours/{weekday}")
async def update_hours(
    weekday: int,
    payload: HoursUpdateIn,
    session: AsyncSession = Depends(get_session),
):
    if not 0 <= weekday <= 6:
        raise HTTPException(400, "Dia da semana inválido.")

    hour = await session.scalar(
        select(BusinessHour).where(BusinessHour.weekday == weekday)
    )
    if hour is None:
        raise HTTPException(404, "Horário não encontrado.")

    data = payload.model_dump(exclude_unset=True)
    if "open" in data and data["open"] is not None:
        hour.is_open = bool(data["open"])
    if "opens_at" in data:
        hour.opens_at = data["opens_at"]
    if "closes_at" in data:
        hour.closes_at = data["closes_at"]

    if hour.opens_at is not None and hour.opens_at == hour.closes_at:
        raise HTTPException(
            400, "Os horários de abertura e fechamento precisam ser diferentes."
        )
    if hour.is_open and (hour.opens_at is None or hour.closes_at is None):
        raise HTTPException(
            400, "Defina os horários de abertura e fechamento."
        )

    await session.commit()
    return serialize_day(hour)


# ------------------------------------------------------------------- categorias
def _slugify(value: str) -> str:
    normalized = (
        value.strip()
        .casefold()
        .replace("á", "a")
        .replace("à", "a")
        .replace("â", "a")
        .replace("ã", "a")
        .replace("é", "e")
        .replace("ê", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ô", "o")
        .replace("õ", "o")
        .replace("ú", "u")
        .replace("ç", "c")
    )
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return slug or "categoria"


async def _unique_slug(
    session: AsyncSession, name: str, *, ignore_id: int | None = None
) -> str:
    base = _slugify(name)
    slug = base
    suffix = 2
    while True:
        query = select(Category.id).where(Category.slug == slug)
        if ignore_id is not None:
            query = query.where(Category.id != ignore_id)
        if await session.scalar(query) is None:
            return slug
        slug = f"{base}-{suffix}"
        suffix += 1


def _category_payload(category: Category, product_count: int | None = None) -> dict:
    payload = {
        "id": category.id,
        "name": category.name,
        "slug": category.slug,
        "sort": category.sort,
    }
    if product_count is not None:
        payload["product_count"] = product_count
    return payload


@router.get("/categories")
async def admin_categories(session: AsyncSession = Depends(get_session)):
    counts = dict(
        (
            await session.execute(
                select(Product.category_id, func.count(Product.id)).group_by(
                    Product.category_id
                )
            )
        ).all()
    )
    categories = (
        await session.scalars(select(Category).order_by(Category.sort, Category.id))
    ).all()
    return [
        _category_payload(category, int(counts.get(category.id, 0)))
        for category in categories
    ]


@router.post("/categories", status_code=201)
async def create_category(
    payload: CategoryIn, session: AsyncSession = Depends(get_session)
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Informe o nome da categoria.")
    if await session.scalar(select(Category.id).where(Category.name == name)):
        raise HTTPException(409, "Já existe uma categoria com esse nome.")
    sort = payload.sort
    if sort is None:
        sort = int(
            await session.scalar(select(func.coalesce(func.max(Category.sort), -1)))
        ) + 1
    category = Category(
        name=name,
        slug=await _unique_slug(session, name),
        sort=sort,
    )
    session.add(category)
    await session.commit()
    return _category_payload(category, 0)


@router.put("/categories/{category_id}")
@router.patch("/categories/{category_id}")
async def update_category(
    category_id: int,
    payload: CategoryPatchIn,
    session: AsyncSession = Depends(get_session),
):
    category = await session.get(Category, category_id)
    if category is None:
        raise HTTPException(404, "Categoria não encontrada.")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        name = data["name"].strip()
        if not name:
            raise HTTPException(400, "Informe o nome da categoria.")
        duplicate = await session.scalar(
            select(Category.id).where(
                Category.name == name, Category.id != category_id
            )
        )
        if duplicate is not None:
            raise HTTPException(409, "Já existe uma categoria com esse nome.")
        category.name = name
        category.slug = await _unique_slug(
            session, name, ignore_id=category_id
        )
    if "sort" in data and data["sort"] is not None:
        category.sort = data["sort"]
    await session.commit()
    return _category_payload(category)


@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: int, session: AsyncSession = Depends(get_session)
):
    category = await session.get(Category, category_id)
    if category is None:
        raise HTTPException(404, "Categoria não encontrada.")
    products = await session.scalar(
        select(func.count(Product.id)).where(Product.category_id == category_id)
    )
    if products:
        raise HTTPException(
            409, "Mova os produtos para outra categoria antes de excluir."
        )
    await session.delete(category)
    await session.commit()
    return {"id": category_id}


# --------------------------------------------------------------------- produtos
def _product_payload(
    product: Product,
    addon_links: list[dict],
    sold,
    revenue,
    cost,
) -> dict:
    return {
        "id": product.id,
        "name": product.name,
        "category_id": product.category_id,
        "category": product.category.slug,
        "category_name": product.category.name,
        "price_cents": product.price_cents,
        "cost_cents": product.cost_cents,
        "image": product.image,
        "available": product.available,
        "stock": product.stock,
        "description": product.description,
        "featured": product.featured,
        "addons": addon_links,
        "addonIds": [a["addon_id"] for a in addon_links],
        "stats": {
            "sold": sold,
            "revenue_cents": revenue,
            "cost_cents": cost,
        },
    }


async def _admin_products(session: AsyncSession) -> list[dict]:
    products = list(
        (await session.scalars(select(Product).order_by(Product.sort, Product.id)))
        .all()
    )

    links: dict[int, list[dict]] = defaultdict(list)
    for product_id, addon_id, price_cents, cost_cents, priced, addon_name in (
        await session.execute(
            select(
                ProductAddon.product_id,
                ProductAddon.addon_id,
                ProductAddon.price_cents,
                ProductAddon.cost_cents,
                ProductAddon.priced,
                Addon.name,
            )
            .join(Addon, Addon.id == ProductAddon.addon_id)
            .order_by(ProductAddon.addon_id)
        )
    ).all():
        links[product_id].append({
            "addon_id": addon_id,
            "name": addon_name,
            "price_cents": price_cents,
            "cost_cents": cost_cents,
            "priced": priced,
        })

    sales_rows = (
        await session.execute(
            select(
                OrderItem.product_id,
                func.coalesce(func.sum(OrderItem.qty), 0),
                func.coalesce(func.sum(OrderItem.qty * OrderItem.unit_price_cents), 0),
                func.coalesce(func.sum(OrderItem.qty * OrderItem.unit_cost_cents), 0),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .where(Order.status == "concluido", OrderItem.product_id.is_not(None))
            .group_by(OrderItem.product_id)
        )
    ).all()
    sales = {pid: (int(sold), int(rev), int(cost)) for pid, sold, rev, cost in sales_rows}

    extra_rows = (
        await session.execute(
            select(
                OrderItem.product_id,
                func.coalesce(
                    func.sum(OrderItem.qty * OrderItemAddon.price_cents), 0
                ),
                func.coalesce(
                    func.sum(OrderItem.qty * OrderItemAddon.cost_cents), 0
                ),
            )
            .select_from(OrderItemAddon)
            .join(OrderItem, OrderItem.id == OrderItemAddon.order_item_id)
            .join(Order, Order.id == OrderItem.order_id)
            .where(Order.status == "concluido", OrderItem.product_id.is_not(None))
            .group_by(OrderItem.product_id)
        )
    ).all()
    extra = {pid: (int(rev), int(cost)) for pid, rev, cost in extra_rows}

    out = []
    for product in products:
        sold, revenue, cost = sales.get(product.id, (0, 0, 0))
        extra_revenue, extra_cost = extra.get(product.id, (0, 0))
        out.append(
            _product_payload(
                product,
                links.get(product.id, []),
                sold,
                revenue + extra_revenue,
                cost + extra_cost,
            )
        )
    return out


async def _validate_image(image: str | None) -> str | None:
    if not image:
        return None
    if not re.fullmatch(r"[A-Za-z0-9._/-]{1,255}", image) or ".." in image:
        raise HTTPException(400, "Escolha uma foto válida.")
    if image.startswith("uploads/"):
        if not re.fullmatch(r"uploads/[a-f0-9]{24}\.(jpg|png|webp)", image):
            raise HTTPException(400, "Escolha uma foto válida.")
        if not await storage.image_exists(image):
            raise HTTPException(400, "Envie a foto novamente.")
    elif "/" in image:
        raise HTTPException(400, "Escolha uma foto válida.")
    return image


async def _validate_addon_ids(session: AsyncSession, addon_ids: list[int]) -> list[int]:
    addon_ids = list(dict.fromkeys(addon_ids))
    if not addon_ids:
        return []
    existing = set(
        (await session.scalars(select(Addon.id).where(Addon.id.in_(addon_ids)))).all()
    )
    if existing != set(addon_ids):
        raise HTTPException(400, "Adicional não encontrado.")
    return addon_ids


async def _resolve_category(session: AsyncSession, payload: ProductIn) -> Category:
    """Aceita `category_id` (novo) ou `category` com slug/nome (compatível)."""
    category: Category | None = None
    if payload.category_id is not None:
        category = await session.get(Category, payload.category_id)
    elif payload.category:
        wanted = payload.category.strip()
        category = await session.scalar(
            select(Category).where(
                or_(
                    Category.slug == _slugify(wanted),
                    func.lower(Category.name) == wanted.casefold(),
                )
            )
        )
    if category is None:
        raise HTTPException(400, "Escolha uma categoria válida.")
    return category


@router.get("/products")
async def admin_products(session: AsyncSession = Depends(get_session)):
    return await _admin_products(session)


@router.post("/products", status_code=201)
async def create_product(
    payload: ProductIn, session: AsyncSession = Depends(get_session)
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Informe o nome do produto.")
    addon_ids = await _validate_addon_ids(session, payload.addon_ids)
    image = await _validate_image(payload.image)
    if image is None:
        raise HTTPException(400, "Escolha a foto do produto.")
    category = await _resolve_category(session, payload)

    max_sort = await session.scalar(select(func.coalesce(func.max(Product.sort), -1)))
    product = Product(
        name=name,
        description=payload.description,
        category=category,
        price_cents=payload.price_cents,
        cost_cents=payload.cost_cents,
        image=image,
        available=payload.available,
        stock=payload.stock,
        featured=payload.featured,
        sort=int(max_sort) + 1,
    )
    session.add(product)
    await session.flush()
    for addon_entry in payload.addons:
        session.add(
            ProductAddon(
                product_id=product.id,
                addon_id=addon_entry.addon_id,
                price_cents=addon_entry.price_cents,
                cost_cents=addon_entry.cost_cents,
                priced=addon_entry.priced,
            )
        )
    existing_addon_ids = {a.addon_id for a in payload.addons}
    for addon_id in addon_ids:
        if addon_id not in existing_addon_ids:
            session.add(ProductAddon(product_id=product.id, addon_id=addon_id))
    await session.commit()

    return next(p for p in await _admin_products(session) if p["id"] == product.id)


@router.put("/products/{product_id}")
async def update_product(
    product_id: int, payload: ProductIn, session: AsyncSession = Depends(get_session)
):
    product = await session.get(Product, product_id)
    if product is None:
        raise HTTPException(404, "Produto não encontrado.")

    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Informe o nome do produto.")
    addon_ids = await _validate_addon_ids(session, payload.addon_ids)

    image = payload.image if payload.image and payload.image != product.image else product.image
    if image != product.image:
        image = await _validate_image(image)
    if image is None:
        raise HTTPException(400, "Escolha a foto do produto.")
    category = await _resolve_category(session, payload)

    product.name = name
    product.description = payload.description
    product.category = category
    product.price_cents = payload.price_cents
    product.cost_cents = payload.cost_cents
    product.image = image
    product.available = payload.available
    product.stock = payload.stock
    product.featured = payload.featured

    await session.execute(
        delete(ProductAddon).where(ProductAddon.product_id == product_id)
    )
    for addon_entry in payload.addons:
        session.add(
            ProductAddon(
                product_id=product_id,
                addon_id=addon_entry.addon_id,
                price_cents=addon_entry.price_cents,
                cost_cents=addon_entry.cost_cents,
                priced=addon_entry.priced,
            )
        )
    existing_addon_ids = {a.addon_id for a in payload.addons}
    for addon_id in addon_ids:
        if addon_id not in existing_addon_ids:
            session.add(ProductAddon(product_id=product_id, addon_id=addon_id))
    await session.commit()

    return next(p for p in await _admin_products(session) if p["id"] == product_id)


@router.patch("/products/{product_id}")
async def patch_product(
    product_id: int,
    payload: ProductPatchIn,
    session: AsyncSession = Depends(get_session),
):
    product = await session.get(Product, product_id)
    if product is None:
        raise HTTPException(404, "Produto não encontrado.")

    fields = payload.model_fields_set
    if not fields:
        raise HTTPException(400, "Dados inválidos.")
    if "available" in fields and payload.available is not None:
        product.available = payload.available
    if "stock" in fields:
        product.stock = payload.stock
    await session.commit()

    return {
        "id": product.id,
        "available": product.available,
        "stock": product.stock,
    }


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: int, session: AsyncSession = Depends(get_session)
):
    product = await session.get(Product, product_id)
    if product is None:
        raise HTTPException(404, "Produto não encontrado.")
    # As FKs de product_addons (CASCADE) e order_items (SET NULL) tratam as
    # referências no banco; o ORM não deve tentar apagá-las/atualizá-las.
    await session.delete(product)
    await session.commit()
    return {"id": product_id}


# ------------------------------------------------------------------- adicionais
def _addon_payload(addon: Addon) -> dict:
    return {
        "id": addon.id,
        "name": addon.name,
    }


@router.get("/addons")
async def admin_addons(session: AsyncSession = Depends(get_session)):
    addons = (await session.scalars(select(Addon).order_by(Addon.id))).all()
    return [_addon_payload(addon) for addon in addons]


@router.post("/addons", status_code=201)
async def create_addon(payload: AddonIn, session: AsyncSession = Depends(get_session)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Informe o nome do adicional.")
    duplicate = await session.scalar(
        select(Addon.id).where(func.lower(Addon.name) == name.lower())
    )
    if duplicate:
        raise HTTPException(409, "Já existe um adicional com esse nome.")

    addon = Addon(name=name, available=True)
    session.add(addon)
    await session.commit()
    return _addon_payload(addon)


@router.patch("/addons/{addon_id}")
async def patch_addon(
    addon_id: int, payload: AddonPatchIn, session: AsyncSession = Depends(get_session)
):
    addon = await session.get(Addon, addon_id)
    if addon is None:
        raise HTTPException(404, "Adicional não encontrado.")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        name = data["name"].strip()
        if not name:
            raise HTTPException(400, "Informe o nome do adicional.")
        duplicate = await session.scalar(
            select(Addon.id).where(
                func.lower(Addon.name) == name.lower(), Addon.id != addon_id
            )
        )
        if duplicate:
            raise HTTPException(409, "Já existe um adicional com esse nome.")
        addon.name = name
    if "price_cents" in data and data["price_cents"] is not None:
        await session.execute(
            update(ProductAddon)
            .where(ProductAddon.addon_id == addon_id)
            .values(price_cents=data["price_cents"], priced=True)
        )
    await session.commit()
    return _addon_payload(addon)


@router.delete("/addons/{addon_id}")
async def delete_addon(
    addon_id: int, session: AsyncSession = Depends(get_session)
):
    addon = await session.get(Addon, addon_id)
    if addon is None:
        raise HTTPException(404, "Adicional não encontrado.")
    # product_addons tem ON DELETE CASCADE na FK de addons.
    await session.delete(addon)
    await session.commit()
    return {"id": addon_id}


# ------------------------------------------------------------------------ pedidos
@router.get("/orders")
async def admin_orders(
    status: str = "open", session: AsyncSession = Depends(get_session)
):
    view = status if status in ORDER_VIEWS else "open"
    target = ORDER_VIEWS[view]

    order_by = Order.id.asc() if view == "open" else Order.id.desc()
    orders = (
        await session.scalars(
            select(Order).where(Order.status == target).order_by(order_by).limit(100)
        )
    ).all()

    counts = {"open": 0, "done": 0, "canceled": 0}
    status_to_view = {value: key for key, value in ORDER_VIEWS.items()}
    for order_status, total in (
        await session.execute(select(Order.status, func.count()).group_by(Order.status))
    ).all():
        key = status_to_view.get(order_status)
        if key:
            counts[key] = int(total)

    items_by_order: dict[int, list[dict]] = defaultdict(list)
    if orders:
        order_ids = [order.id for order in orders]
        rows = (
            await session.execute(
                select(OrderItem, Product.image)
                .outerjoin(Product, Product.id == OrderItem.product_id)
                .where(OrderItem.order_id.in_(order_ids))
                .order_by(OrderItem.id)
            )
        ).all()

        item_ids = [item.id for item, _ in rows]
        addons_by_item: dict[int, list[dict]] = defaultdict(list)
        if item_ids:
            for addon in (
                await session.scalars(
                    select(OrderItemAddon)
                    .where(OrderItemAddon.order_item_id.in_(item_ids))
                    .order_by(OrderItemAddon.id)
                )
            ).all():
                addons_by_item[addon.order_item_id].append(
                    {"name": addon.name, "price_cents": addon.price_cents}
                )

        for item, image in rows:
            items_by_order[item.order_id].append(
                {
                    "id": item.id,
                    "name": item.name,
                    "qty": item.qty,
                    "unit_price_cents": item.unit_price_cents,
                    "note": item.note,
                    "image": image,
                    "addons": addons_by_item.get(item.id, []),
                }
            )

    return {
        "counts": counts,
        "orders": [
            {
                "id": order.id,
                "customer_name": order.customer_name,
                "customer_phone": order.customer_phone,
                "status": order.status,
                "total_cents": order.total_cents,
                "cancel_loss": order.cancel_loss,
                "delivery_type": order.delivery_type,
                "delivery_at": _to_iso(order.delivery_at),
                "delivery_address": order.delivery_address,
                "note": order.note,
                "created_at": _to_iso(order.created_at),
                "items": items_by_order.get(order.id, []),
            }
            for order in orders
        ],
    }


@router.patch("/orders/{order_id}")
async def update_order_status(
    order_id: int,
    payload: OrderStatusIn,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Order).where(Order.id == order_id).with_for_update()
    )
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(404, "Pedido não encontrado.")
    if payload.status not in TRANSITIONS.get(order.status, set()):
        raise HTTPException(409, "Esse pedido não pode mudar para esse status.")

    items = (
        await session.scalars(
            select(OrderItem).where(OrderItem.order_id == order_id)
        )
    ).all()

    if payload.status == "cancelado":
        if not payload.loss:
            for item in items:
                if item.product_id is not None:
                    await session.execute(
                        update(Product)
                        .where(
                            Product.id == item.product_id,
                            Product.stock.is_not(None),
                        )
                        .values(stock=Product.stock + item.qty)
                    )
        order.status = "cancelado"
        order.cancel_loss = payload.loss
    else:
        if order.status == "cancelado" and not order.cancel_loss:
            wanted: dict[int, int] = defaultdict(int)
            for item in items:
                if item.product_id is not None:
                    wanted[item.product_id] += item.qty
            if wanted:
                result = await session.execute(
                    select(Product)
                    .where(Product.id.in_(wanted))
                    .with_for_update()
                )
                products = {product.id: product for product in result.scalars().all()}
                for product_id, qty in wanted.items():
                    product = products.get(product_id)
                    if product is None or product.stock is None:
                        continue
                    if product.stock < qty:
                        raise HTTPException(
                            409,
                            f"Estoque insuficiente para reabrir: {product.name}.",
                        )
                    product.stock -= qty
        order.status = payload.status
        order.cancel_loss = False

    await session.commit()
    return {"id": order.id, "status": order.status}


@router.get("/sales")
async def admin_sales(session: AsyncSession = Depends(get_session)):
    orders = (
        await session.scalars(
            select(Order)
            .where(
                or_(
                    Order.status == "concluido",
                    and_(Order.status == "cancelado", Order.cancel_loss.is_(True)),
                )
            )
            .order_by(Order.id.desc())
            .limit(5000)
        )
    ).all()

    items_by_order: dict[int, list[dict]] = defaultdict(list)
    if orders:
        order_ids = [order.id for order in orders]
        rows = (
            await session.execute(
                select(OrderItem, Category.slug, Category.name)
                .outerjoin(Product, Product.id == OrderItem.product_id)
                .outerjoin(Category, Category.id == Product.category_id)
                .where(OrderItem.order_id.in_(order_ids))
                .order_by(OrderItem.id)
            )
        ).all()

        item_ids = [item.id for item, _slug, _name in rows]
        addons_by_item: dict[int, list[dict]] = defaultdict(list)
        if item_ids:
            for addon in (
                await session.scalars(
                    select(OrderItemAddon)
                    .where(OrderItemAddon.order_item_id.in_(item_ids))
                    .order_by(OrderItemAddon.id)
                )
            ).all():
                addons_by_item[addon.order_item_id].append(
                    {
                        "name": addon.name,
                        "price_cents": addon.price_cents,
                        "cost_cents": addon.cost_cents,
                    }
                )

        for item, category_slug, category_name in rows:
            items_by_order[item.order_id].append(
                {
                    "id": item.id,
                    "name": item.name,
                    "qty": item.qty,
                    "unit_price_cents": item.unit_price_cents,
                    "unit_cost_cents": item.unit_cost_cents,
                    "note": item.note,
                    "category": category_slug or "sem-categoria",
                    "category_name": category_name or "Sem categoria",
                    "addons": addons_by_item.get(item.id, []),
                }
            )

    return {
        "orders": [
            {
                "id": order.id,
                "customer_name": order.customer_name,
                "customer_phone": order.customer_phone,
                "status": order.status,
                "created_at": _to_iso(order.created_at),
                "items": items_by_order.get(order.id, []),
            }
            for order in orders
        ]
    }


# ------------------------------------------------------------------------ uploads
@router.post("/uploads", status_code=201)
async def upload_image(request: Request):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > settings.max_upload_bytes:
        raise HTTPException(413, "A foto é muito grande.")

    body = await request.body()
    if not body:
        raise HTTPException(400, "Envie uma foto JPG, PNG ou WebP.")
    if len(body) > settings.max_upload_bytes:
        raise HTTPException(413, "A foto é muito grande.")

    extension = storage.sniff_image(body)
    if extension is None:
        raise HTTPException(400, "Envie uma foto JPG, PNG ou WebP.")

    try:
        image = await storage.put_image(body, extension)
    except storage.StorageError:
        raise HTTPException(
            503, "Não foi possível salvar a foto no armazenamento."
        )
    return {"image": image}
