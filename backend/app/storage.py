"""Armazenamento das fotos no SeaweedFS (API compatível com S3)."""

import asyncio
import logging
import mimetypes
import secrets

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .config import get_settings

settings = get_settings()
log = logging.getLogger("delicias.storage")

_CONTENT_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}

_client = None
_bucket_ready = False


class StorageError(RuntimeError):
    """Falha ao conversar com o object storage."""


def _s3():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=Config(
                signature_version="s3v4",
                s3={
                    "addressing_style": "path"
                    if settings.s3_force_path_style
                    else "auto"
                },
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=5,
                read_timeout=15,
            ),
        )
    return _client


def _ensure_bucket_sync() -> None:
    global _bucket_ready
    if _bucket_ready:
        return
    client = _s3()
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code not in ("404", "NoSuchBucket", "NotFound", "403"):
            raise
        try:
            client.create_bucket(Bucket=settings.s3_bucket)
        except ClientError as create_exc:
            code = str(create_exc.response.get("Error", {}).get("Code", ""))
            if code not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                raise
    _bucket_ready = True


async def ensure_bucket(retries: int = 1, delay: float = 1.0) -> bool:
    """Garante que o bucket exista; o SeaweedFS sobe junto com a API."""
    for attempt in range(1, retries + 1):
        try:
            await asyncio.to_thread(_ensure_bucket_sync)
            return True
        except (ClientError, BotoCoreError, OSError) as exc:
            log.warning(
                "SeaweedFS indisponível (%s/%s): %s", attempt, retries, exc
            )
            if attempt < retries:
                await asyncio.sleep(delay)
    return False


def bucket_ready() -> bool:
    return _bucket_ready


def sniff_image(data: bytes) -> str | None:
    """Descobre a extensão pela assinatura do arquivo (não confia no cliente)."""
    if len(data) < 12:
        return None
    if data[0:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[0:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


async def put_image(data: bytes, extension: str) -> str:
    if not await ensure_bucket(retries=5, delay=1.0):
        raise StorageError("object storage indisponível")

    key = f"uploads/{secrets.token_hex(12)}.{extension}"
    content_type = _CONTENT_TYPES.get(extension, "application/octet-stream")
    try:
        await asyncio.to_thread(
            _s3().put_object,
            Bucket=settings.s3_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=604800",
        )
    except (ClientError, BotoCoreError, OSError) as exc:
        raise StorageError("falha ao enviar a imagem") from exc
    return key


async def image_exists(key: str) -> bool:
    if not await ensure_bucket(retries=3, delay=1.0):
        return False
    try:
        await asyncio.to_thread(
            _s3().head_object, Bucket=settings.s3_bucket, Key=key
        )
        return True
    except (ClientError, BotoCoreError, OSError):
        return False


async def get_image(key: str) -> tuple[bytes, str]:
    if not await ensure_bucket(retries=3, delay=1.0):
        raise StorageError("object storage indisponível")
    try:
        obj = await asyncio.to_thread(
            _s3().get_object, Bucket=settings.s3_bucket, Key=key
        )
        body = await asyncio.to_thread(obj["Body"].read)
    except (ClientError, BotoCoreError, OSError, KeyError) as exc:
        raise StorageError("imagem não encontrada") from exc

    content_type = obj.get("ContentType")
    if not content_type or content_type == "application/octet-stream":
        content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
    return body, content_type
