"""Aplicação FastAPI: startup (banco + bucket), erros e rotas."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import InterfaceError, OperationalError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import models, storage  # noqa: F401 (models registra as tabelas)
from .bootstrap import ensure_schema
from .config import get_settings
from .database import Base, engine, get_session
from .routers import admin, assets, public

settings = get_settings()
log = logging.getLogger("delicias")


async def _prepare_database() -> None:
    last_error: Exception | None = None
    for attempt in range(1, settings.database_connect_retries + 1):
        try:
            await ensure_schema()
            log.info("Banco de dados pronto.")
            return
        except (SQLAlchemyError, OSError) as exc:
            last_error = exc
            log.warning(
                "Banco indisponível (%s/%s): %s",
                attempt,
                settings.database_connect_retries,
                exc,
            )
            await asyncio.sleep(min(attempt, 5))
    raise RuntimeError("Não foi possível conectar ao PostgreSQL.") from last_error


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await _prepare_database()
    # O SeaweedFS pode ainda estar subindo; o bucket é garantido de novo no upload.
    if not await storage.ensure_bucket(retries=5, delay=1.0):
        log.warning("SeaweedFS indisponível no startup; uploads serão tentados depois.")
    yield
    await engine.dispose()


async def _schema_ready(session: AsyncSession) -> bool:
    """Confirma que o banco responde e que todas as tabelas esperadas existem."""
    await session.execute(text("SELECT 1"))
    existing = set(
        (
            await session.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            )
        )
        .scalars()
        .all()
    )
    expected = set(Base.metadata.tables) | {"alembic_version"}
    return expected <= existing


def _storage_status() -> str:
    return "ok" if storage.bucket_ready() else "indisponível"


def _degraded_payload(*, database: bool) -> dict:
    return {
        "status": "degraded",
        "database": database,
        "schema": False,
        "storage": _storage_status(),
    }


def _sqlstate(exc: SQLAlchemyError) -> str | None:
    orig = getattr(exc, "orig", None)
    return getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        lifespan=lifespan,
    )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            {"error": exc.detail}, status_code=exc.status_code, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError):
        return JSONResponse({"error": "Dados inválidos."}, status_code=422)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(_request: Request, exc: SQLAlchemyError):
        sqlstate = _sqlstate(exc)
        if sqlstate == "42P01":  # undefined_table: banco recriado com a API no ar
            log.warning("Schema ausente; recriando tabelas e dados iniciais.")
            try:
                await ensure_schema()
            except (SQLAlchemyError, OSError):
                log.exception("Falha ao recriar o schema")
            return JSONResponse(
                {"error": "Banco de dados sendo inicializado; tente novamente."},
                status_code=503,
                headers={"Retry-After": "1"},
            )
        if isinstance(exc, (OperationalError, InterfaceError)):
            log.warning("Banco de dados indisponível: %s", exc)
            return JSONResponse(
                {"error": "Banco de dados indisponível."},
                status_code=503,
                headers={"Retry-After": "5"},
            )
        log.exception("Erro de banco de dados", exc_info=exc)
        return JSONResponse({"error": "Erro inesperado."}, status_code=500)

    app.include_router(public.router)
    app.include_router(admin.auth_router)
    app.include_router(admin.router)
    app.include_router(assets.router)

    @app.get("/", tags=["health"])
    async def root():
        return {"status": "ok", "service": settings.app_name}

    @app.get("/api/health", tags=["health"])
    async def health(session: AsyncSession = Depends(get_session)):
        """Liveness + banco/schema. Retorna 503 quando não dá para atender."""
        try:
            schema = await _schema_ready(session)
        except SQLAlchemyError as exc:
            log.warning("Health: banco indisponível: %s", exc)
            return JSONResponse(_degraded_payload(database=False), status_code=503)
        if not schema:
            # Banco respondendo, mas sem schema (volume recriado/restauração
            # parcial): tenta recuperar sem exigir reinício da API.
            log.warning("Health: schema ausente; tentando recriar.")
            try:
                await ensure_schema()
                await session.rollback()
                schema = await _schema_ready(session)
            except (SQLAlchemyError, OSError) as exc:
                log.warning("Health: falha ao recriar o schema: %s", exc)
                return JSONResponse(
                    _degraded_payload(database=False), status_code=503
                )
        if not schema:
            log.warning("Health: schema continua ausente.")
            return JSONResponse(_degraded_payload(database=True), status_code=503)
        return {
            "status": "ok",
            "database": True,
            "schema": True,
            "storage": _storage_status(),
        }

    @app.get("/api/ready", tags=["health"])
    async def ready(session: AsyncSession = Depends(get_session)):
        """Readiness: só responde 200 quando o schema está pronto para uso."""
        return await health(session)

    return app
