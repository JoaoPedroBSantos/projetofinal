"""Rotas das fotos: a API lê do SeaweedFS e o nginx faz proxy de /assets."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from .. import storage

router = APIRouter(tags=["assets"])


def _valid_key(key: str) -> bool:
    return bool(
        key
        and len(key) <= 255
        and not key.startswith("/")
        and "\\" not in key
        and ".." not in key
    )


@router.get("/assets/{key:path}")
async def get_asset(key: str):
    if not _valid_key(key):
        raise HTTPException(404, "Imagem não encontrada.")
    try:
        body, content_type = await storage.get_image(key)
    except storage.StorageError:
        # 404 faz o nginx cair no arquivo que veio no build do SPA.
        raise HTTPException(404, "Imagem não encontrada.")
    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=604800",
            "X-Content-Type-Options": "nosniff",
        },
    )
