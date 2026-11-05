"""Regras de horário de funcionamento (tabela única `business_hours`)."""

from datetime import datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .models import BusinessHour

settings = get_settings()
TZ = ZoneInfo(settings.timezone)


def now_local() -> datetime:
    return datetime.now(TZ)


def weekday_js(value: datetime) -> int:
    """Dia da semana no padrão do JavaScript: 0 = domingo ... 6 = sábado."""
    return (value.weekday() + 1) % 7


def to_local(value: datetime) -> datetime:
    """Interpreta datas sem fuso como horário local da loja."""
    if value.tzinfo is None:
        return value.replace(tzinfo=TZ)
    return value.astimezone(TZ)


def fmt_time(value: time | None) -> str | None:
    return value.strftime("%H:%M") if value is not None else None


def is_open_at(hour: BusinessHour, at: datetime) -> bool:
    if not hour.is_open or hour.opens_at is None or hour.closes_at is None:
        return False
    if hour.opens_at == hour.closes_at:
        return False
    current = at.time()
    if hour.opens_at < hour.closes_at:
        return hour.opens_at <= current < hour.closes_at
    # Fecha depois da meia-noite (ex.: 18:00 -> 02:00).
    return current >= hour.opens_at or current < hour.closes_at


def is_open_datetime(hours: list[BusinessHour], at: datetime) -> bool:
    """Aberto no instante informado, considerando turnos que viram a noite.

    Além do horário do próprio dia, verifica o turno do dia anterior quando ele
    termina depois da meia-noite (ex.: sexta 18:00 -> sábado 02:00).
    """
    at = to_local(at)
    by_weekday = {hour.weekday: hour for hour in hours}
    weekday = weekday_js(at)
    current = at.time()

    def open_in_row(hour: BusinessHour | None, *, previous: bool) -> bool:
        if (
            hour is None
            or not hour.is_open
            or hour.opens_at is None
            or hour.closes_at is None
            or hour.opens_at == hour.closes_at
        ):
            return False
        if hour.opens_at < hour.closes_at:
            return not previous and hour.opens_at <= current < hour.closes_at
        # Turno que vira a noite: no próprio dia vale de opens_at até 00:00;
        # depois da meia-noite só vale como continuação do dia anterior.
        return current < hour.closes_at if previous else current >= hour.opens_at

    if open_in_row(by_weekday.get(weekday), previous=False):
        return True
    return open_in_row(by_weekday.get((weekday - 1) % 7), previous=True)


def serialize_day(hour: BusinessHour) -> dict:
    """Formato consumido pelo painel e pelo popup de horários.

    `open_time`/`close_time` são os nomes usados pelo SPA novo; `opens_at`/
    `closes_at` continuam disponíveis para compatibilidade.
    """
    opens_at = fmt_time(hour.opens_at)
    closes_at = fmt_time(hour.closes_at)
    return {
        "id": hour.id,
        "weekday": hour.weekday,
        "open": hour.is_open,
        "is_open": hour.is_open,
        "opens_at": opens_at,
        "closes_at": closes_at,
        "open_time": opens_at,
        "close_time": closes_at,
    }


async def load_hours(session: AsyncSession) -> list[BusinessHour]:
    result = await session.scalars(select(BusinessHour).order_by(BusinessHour.weekday))
    return list(result.all())


def public_status(hours: list[BusinessHour], at: datetime | None = None) -> dict:
    at = at or now_local()
    by_weekday = {hour.weekday: hour for hour in hours}
    today = by_weekday.get(weekday_js(at))
    return {
        "timezone": settings.timezone,
        "now": at.isoformat(timespec="seconds"),
        "is_open_now": is_open_datetime(hours, at),
        "today": serialize_day(today) if today else None,
        "days": [serialize_day(hour) for hour in hours],
    }
