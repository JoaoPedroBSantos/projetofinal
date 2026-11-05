"""Inicialização do banco: migrações (Alembic) + seed idempotente.

O schema é versionado por migrações. O seed roda depois, sempre de forma
idempotente (só cria horários quando a tabela está vazia e o catálogo de
demonstração quando `SEED_DEMO_DATA=true` e não há produtos/adicionais).

`ensure_schema` é seguro para chamadas concorrentes: um lock evita que duas
requisições rodem migrações ao mesmo tempo quando o banco é recriado com a API
no ar.
"""

import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from .config import get_settings
from .database import Base, SessionLocal
from .seed import seed_database

settings = get_settings()
log = logging.getLogger("delicias.bootstrap")

BACKEND_DIR = Path(__file__).resolve().parent.parent

_schema_lock = asyncio.Lock()


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    # Não deixa o Alembic reconfigurar o logging do uvicorn/da aplicação.
    cfg.attributes["configure_logger"] = False
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    # ConfigParser interpola "%": escapa senhas com esse caractere.
    cfg.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    return cfg


def _migrate_sync() -> None:
    """Roda as migrações (Alembic é síncrono; chamado via asyncio.to_thread)."""
    cfg = _alembic_config()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    try:
        inspector = inspect(engine)
        has_version = inspector.has_table("alembic_version")
        has_schema = inspector.has_table("products")
        if has_schema and not has_version:
            # Banco antigo, criado por create_all: adota o schema como baseline.
            log.warning(
                "Banco sem alembic_version; marcando a revisão atual como aplicada."
            )
            command.stamp(cfg, "head")
        command.upgrade(cfg, "head")

        # Reparo de emergência: se alguma tabela esperada sumiu (DROP acidental,
        # restauração parcial), recria só o que falta. As migrações continuam
        # sendo a fonte da verdade para evolução do schema.
        expected = set(Base.metadata.tables)
        missing = expected - set(inspect(engine).get_table_names())
        if missing:
            log.warning("Tabelas ausentes (%s); recriando.", ", ".join(sorted(missing)))
            Base.metadata.create_all(
                engine, tables=[Base.metadata.tables[name] for name in sorted(missing)]
            )
    finally:
        engine.dispose()


async def ensure_schema() -> None:
    """Aplica migrações pendentes e garante os dados iniciais."""
    async with _schema_lock:
        await asyncio.to_thread(_migrate_sync)
        async with SessionLocal() as session:
            await seed_database(session, demo=settings.seed_demo_data)
