"""Carga inicial do banco: horários e, opcionalmente, catálogo de demonstração.

Os horários são criados sempre que a tabela está vazia (o site precisa deles
para calcular se está aberto). Produtos e adicionais de exemplo só entram com
SEED_DEMO_DATA=true, e nesse caso as fotos são enviadas ao SeaweedFS.
"""

import logging
from datetime import time
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import storage
from .models import Addon, BusinessHour, Category, Product

log = logging.getLogger("delicias.seed")

# Fotos do catálogo de demonstração (não são servidas pelo SPA).
SEED_ASSETS = Path(__file__).parent / "seed_assets"

# Categorias padrão, criadas uma única vez (o painel pode renomear/criar outras).
SEED_CATEGORIES = [("Salgados", "salgados"), ("Doces", "doces")]

# (nome, slug da categoria, preço em reais, arquivo da foto) — mesmos itens do cardápio atual.
SEED_PRODUCTS = [
    ("Shawarma de Carne", "salgados", 27, "shawarma-carne.jpg"),
    ("Pastéis", "salgados", 8, "pasteis.jpg"),
    ("Misto Quente", "salgados", 6, "misto-quente.jpg"),
    ("Mini Pizzas", "salgados", 6, "mini-pizzas.jpg"),
    ("Pão de Queijo", "salgados", 3, "pao-de-queijo.jpg"),
    ("Mini Churros", "doces", 25, "mini-churros.jpg"),
    ("Churros Recheados", "doces", 35, "churros-recheados.jpg"),
    ("Espetinho Doce", "doces", 22, "espetinho-doce.jpg"),
    ("Churros Especiais", "doces", 28, "churros-especiais.jpg"),
    ("Crepe Avelã Confete", "doces", 25, "crepe-avela.jpg"),
    ("Crepe Leitinho c/ Bombom", "doces", 35, "crepe-leitinho.jpg"),
    ("Crepe Dois Amores", "doces", 20, "crepe-dois-amores.jpg"),
    ("Crepe Queijo e Goiabada", "doces", 20, "crepe-goiabada.jpg"),
]

SEED_ADDONS = ["Batata extra", "Alface", "Tomate", "Frango"]


async def _seed_demo_catalog(session: AsyncSession) -> None:
    """Cria o catálogo de exemplo apenas em um banco ainda sem produtos/adicionais."""
    if await session.scalar(select(func.count(Product.id))):
        return
    if await session.scalar(select(func.count(Addon.id))):
        return

    try:
        images: dict[str, str] = {}
        for _name, _category, _price, filename in SEED_PRODUCTS:
            data = (SEED_ASSETS / filename).read_bytes()
            extension = Path(filename).suffix.lstrip(".").lower()
            images[filename] = await storage.put_image(data, extension)
    except (OSError, storage.StorageError) as exc:
        log.warning(
            "Seed de demonstração ignorado: não foi possível enviar as fotos "
            "ao SeaweedFS (%s).",
            exc,
        )
        return

    categories = {
        category.slug: category
        for category in (await session.scalars(select(Category))).all()
    }
    missing = {slug for _name, slug, _price, _image in SEED_PRODUCTS} - set(categories)
    if missing:
        log.warning("Seed de demonstração ignorado: categorias ausentes %s.", missing)
        return

    for sort, (name, category, price, image) in enumerate(SEED_PRODUCTS):
        session.add(
            Product(
                name=name,
                category_id=categories[category].id,
                price_cents=price * 100,
                cost_cents=0,
                image=images[image],
                available=True,
                sort=sort,
            )
        )
    await session.flush()

    addons = [Addon(name=name, available=True) for name in SEED_ADDONS]
    session.add_all(addons)
    await session.flush()

    from .models import ProductAddon

    products = (await session.scalars(select(Product))).all()
    for product in products:
        if product.name == "Pão de Queijo":
            continue
        for addon in addons:
            session.add(
                ProductAddon(
                    product_id=product.id,
                    addon_id=addon.id,
                    price_cents=0,
                    cost_cents=0,
                    priced=False,
                )
            )
    await session.flush()


async def seed_database(session: AsyncSession, *, demo: bool = False) -> None:
    # Categorias são necessárias para cadastrar qualquer produto: cria as
    # padrão apenas quando ainda não existe nenhuma (o painel gerencia depois).
    if not await session.scalar(select(func.count(Category.id))):
        for sort, (name, slug) in enumerate(SEED_CATEGORIES):
            session.add(Category(name=name, slug=slug, sort=sort))
        await session.flush()

    if not await session.scalar(select(func.count(BusinessHour.id))):
        for weekday in range(7):
            session.add(
                BusinessHour(
                    weekday=weekday,
                    is_open=True,
                    opens_at=time(0, 0),
                    closes_at=time(23, 59),
                )
            )
        await session.flush()

    if demo:
        await _seed_demo_catalog(session)

    await session.commit()
