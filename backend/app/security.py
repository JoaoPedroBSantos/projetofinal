"""Autenticação simples do painel: um único usuário/senha padrão + cookie assinado."""

import base64
import hashlib
import hmac
import time

from fastapi import HTTPException, Request

from .config import get_settings

settings = get_settings()
COOKIE_NAME = "sid"


def _b64encode(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def _b64decode(value: str) -> str:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding).decode("utf-8")


def _signature(payload: str) -> str:
    return hmac.new(
        settings.secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def create_session_token(username: str) -> str:
    expires_at = int(time.time()) + settings.session_seconds
    payload = f"{username}:{expires_at}"
    return f"{_b64encode(payload)}.{_signature(payload)}"


def read_session_token(token: str | None) -> str | None:
    if not token:
        return None
    try:
        encoded, signature = token.split(".", 1)
        payload = _b64decode(encoded)
    except (ValueError, UnicodeDecodeError):
        return None

    if not hmac.compare_digest(signature, _signature(payload)):
        return None

    try:
        username, expires_at = payload.rsplit(":", 1)
        if int(expires_at) < int(time.time()):
            return None
    except ValueError:
        return None

    if not hmac.compare_digest(
        username.encode("utf-8"), settings.admin_username.encode("utf-8")
    ):
        return None
    return username


def check_credentials(username: str, password: str) -> bool:
    user_ok = hmac.compare_digest(
        username.strip().casefold().encode("utf-8"),
        settings.admin_username.strip().casefold().encode("utf-8"),
    )
    password_ok = hmac.compare_digest(
        password.encode("utf-8"), settings.admin_password.encode("utf-8")
    )
    return user_ok and password_ok


def _token_from_request(request: Request) -> str | None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        return token
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return None


async def require_admin(request: Request) -> str:
    username = read_session_token(_token_from_request(request))
    if not username:
        raise HTTPException(401, "Sessão expirada. Entre novamente.")
    return username
