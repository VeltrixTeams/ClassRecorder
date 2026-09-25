"""Supabase Storage REST helpers using the service role key."""

import httpx

from app.config import settings


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
        "Content-Type": "application/json",
    }


async def create_signed_upload_url(bucket: str, path: str, expires_in: int = 900) -> dict:
    """POST /storage/v1/object/upload/sign/{bucket}/{path} -> {url, token}."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/storage/v1/object/upload/sign/{bucket}/{path}",
            headers=_headers(),
            json={"expiresIn": expires_in},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
    signed_url = data.get("url") or data.get("signedURL") or data.get("signedUrl")
    return {"url": f"{settings.supabase_url}/storage/v1{signed_url}", "path": path}


async def create_signed_download_url(bucket: str, path: str, expires_in: int = 3600) -> str:
    """POST /storage/v1/object/sign/{bucket}/{path} -> signed GET url."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/storage/v1/object/sign/{bucket}/{path}",
            headers=_headers(),
            json={"expiresIn": expires_in},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
    signed_url = data.get("signedURL") or data.get("signedUrl")
    return f"{settings.supabase_url}/storage/v1{signed_url}"


async def list_objects(bucket: str, prefix: str, limit: int = 10000) -> list[dict]:
    """POST /storage/v1/object/list/{bucket} -> objects directly under prefix.
    Each item includes at least `name` and `metadata.size` for real uploads.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/storage/v1/object/list/{bucket}",
            headers=_headers(),
            json={"prefix": prefix, "limit": limit},
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.json()


async def download(bucket: str, path: str, dest: str) -> str:
    """GET /storage/v1/object/{bucket}/{path} -> writes the object to dest."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.supabase_url}/storage/v1/object/{bucket}/{path}",
            headers=_headers(),
            timeout=120.0,
        )
        resp.raise_for_status()
    with open(dest, "wb") as f:
        f.write(resp.content)
    return dest


async def upload(bucket: str, path: str, src: str, content_type: str = "application/octet-stream") -> str:
    """POST /storage/v1/object/{bucket}/{path} with the file's bytes (upsert)."""
    with open(src, "rb") as f:
        data = f.read()
    headers = {**_headers(), "Content-Type": content_type, "x-upsert": "true"}
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/storage/v1/object/{bucket}/{path}",
            headers=headers,
            content=data,
            timeout=120.0,
        )
        resp.raise_for_status()
    return path


async def delete_object(bucket: str, path: str) -> None:
    async with httpx.AsyncClient() as client:
        await client.request(
            "DELETE",
            f"{settings.supabase_url}/storage/v1/object/{bucket}/{path}",
            headers=_headers(),
            timeout=15.0,
        )


async def delete_prefix(bucket: str, prefix: str) -> None:
    """List and delete all objects under a prefix (used for account deletion)."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/storage/v1/object/list/{bucket}",
            headers=_headers(),
            json={"prefix": prefix},
            timeout=15.0,
        )
        if resp.status_code != 200:
            return
        objects = resp.json()
        paths = [f"{prefix}/{o['name']}" for o in objects]
        if paths:
            await client.request(
                "DELETE",
                f"{settings.supabase_url}/storage/v1/object/{bucket}",
                headers=_headers(),
                json={"prefixes": paths},
                timeout=15.0,
            )
