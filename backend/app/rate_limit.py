"""Limitador de taxa em memória (suficiente para uma instância da API)."""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int, window_seconds: int) -> bool:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] >= window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


login_limiter = SlidingWindowLimiter()
order_limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "desconhecido"


def check_login_limit(request: Request, limit: int, window: int) -> None:
    if not login_limiter.allow(client_ip(request), limit, window):
        raise HTTPException(429, "Muitas tentativas. Aguarde alguns minutos.")


def check_order_limit(request: Request, limit: int, window: int) -> None:
    if not order_limiter.allow(client_ip(request), limit, window):
        raise HTTPException(
            429, "Muitas tentativas. Tente novamente em alguns minutos."
        )
