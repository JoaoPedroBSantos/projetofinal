"""Configuração da API, lida de variáveis de ambiente (e de um .env, se existir)."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Delícias Gourmet API"
    timezone: str = "America/Sao_Paulo"

    # Banco de dados. Aceita tanto postgresql:// quanto postgresql+psycopg://.
    database_url: str = "postgresql+psycopg://delicias:delicias_dev_pwd@localhost:5432/delicias"
    database_pool_size: int = 5
    database_max_overflow: int = 5
    database_connect_retries: int = 15

    # Catálogo de demonstração (produtos/adicionais + fotos no SeaweedFS).
    # Fica desligado por padrão: o banco começa vazio para cadastro real.
    seed_demo_data: bool = False

    # SeaweedFS (API S3).
    s3_endpoint: str = "http://localhost:8333"
    s3_region: str = "us-east-1"
    s3_access_key: str = "delicias"
    s3_secret_key: str = "delicias_dev_secret_key"
    s3_bucket: str = "produtos"
    s3_force_path_style: bool = True

    # Administrador único (enquanto não existe tabela de usuários).
    admin_username: str = "admin"
    admin_password: str = "1234"
    secret_key: str = "delicias-dev-secret-change-me"
    session_seconds: int = 8 * 3600
    cookie_secure: bool = False

    # Uploads.
    max_upload_bytes: int = 6 * 1024 * 1024

    # Limites simples em memória (por IP).
    login_rate_limit: int = 5
    login_rate_window: int = 600
    order_rate_limit: int = 10
    order_rate_window: int = 600

    @field_validator("database_url")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return "postgresql+psycopg://" + value[len("postgresql://") :]
        if value.startswith("postgres://"):
            return "postgresql+psycopg://" + value[len("postgres://") :]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
