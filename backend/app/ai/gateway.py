"""The ONLY module allowed to call OpenRouter. chat / chat_stream / embed.

Retries on 429/5xx/timeout with backoff settings.retry_backoff (default 2s/8s/30s).
Sleep function is injectable for tests (pass sleep=... to skip real waiting).
Every call logs to ai_usage using the response's `usage.cost` field (OpenRouter
returns cost in USD when `usage: {include: true}` is requested).
"""

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Any

import httpx

from app.config import settings
from app.db import get_pool

RETRYABLE_STATUS = {429, 500, 502, 503, 504}

SleepFn = Callable[[float], Coroutine[Any, Any, None]]


async def _default_sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


async def _log_usage(
    *,
    user_id: str | None,
    lecture_id: str | None,
    kind: str,
    model: str,
    usage: dict,
) -> None:
    pool = await get_pool()
    input_units = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
    output_units = usage.get("completion_tokens") or usage.get("output_tokens") or 0
    cost = usage.get("cost") or 0
    await pool.execute(
        """insert into ai_usage(user_id, lecture_id, kind, model, input_units, output_units, cost_usd)
           values ($1,$2,$3,$4,$5,$6,$7)""",
        user_id,
        lecture_id,
        kind,
        model,
        int(input_units),
        int(output_units),
        float(cost),
    )


async def _request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    json_body: dict,
    headers: dict,
    sleep: SleepFn = _default_sleep,
) -> httpx.Response:
    backoffs = list(settings.retry_backoff)
    attempt = 0
    while True:
        try:
            resp = await client.request(method, url, json=json_body, headers=headers, timeout=60.0)
        except (httpx.TimeoutException, httpx.TransportError):
            if attempt >= len(backoffs):
                raise
            await sleep(backoffs[attempt])
            attempt += 1
            continue
        if resp.status_code in RETRYABLE_STATUS and attempt < len(backoffs):
            await sleep(backoffs[attempt])
            attempt += 1
            continue
        resp.raise_for_status()
        return resp


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }


async def chat(
    messages: list[dict],
    *,
    model: str | None = None,
    response_format: dict | None = None,
    user_id: str | None = None,
    lecture_id: str | None = None,
    kind: str = "chat",
    sleep: SleepFn = _default_sleep,
    client: httpx.AsyncClient | None = None,
) -> dict:
    """Non-streaming chat completion. Returns the parsed JSON body."""
    model = model or settings.chat_model
    body: dict = {"model": model, "messages": messages, "usage": {"include": True}}
    if response_format:
        body["response_format"] = response_format

    owns_client = client is None
    client = client or httpx.AsyncClient()
    try:
        resp = await _request_with_retry(
            client,
            "POST",
            f"{settings.openrouter_base_url}/chat/completions",
            json_body=body,
            headers=_headers(),
            sleep=sleep,
        )
        data = resp.json()
    finally:
        if owns_client:
            await client.aclose()

    usage = data.get("usage", {})
    await _log_usage(user_id=user_id, lecture_id=lecture_id, kind=kind, model=model, usage=usage)
    return data


async def chat_stream(
    messages: list[dict],
    *,
    model: str | None = None,
    user_id: str | None = None,
    lecture_id: str | None = None,
    kind: str = "chat",
    sleep: SleepFn = _default_sleep,
) -> AsyncIterator[dict]:
    """Streams SSE chunks from OpenRouter. Yields decoded JSON objects per chunk.
    Retries (with backoff) only apply to the initial connection attempt, not
    mid-stream failures (can't safely retry a partially-consumed stream).
    """
    model = model or settings.chat_model
    body = {"model": model, "messages": messages, "stream": True, "usage": {"include": True}}

    backoffs = list(settings.retry_backoff)
    attempt = 0
    async with httpx.AsyncClient() as client:
        while True:
            try:
                async with client.stream(
                    "POST",
                    f"{settings.openrouter_base_url}/chat/completions",
                    json=body,
                    headers=_headers(),
                    timeout=120.0,
                ) as resp:
                    if resp.status_code in RETRYABLE_STATUS and attempt < len(backoffs):
                        await sleep(backoffs[attempt])
                        attempt += 1
                        continue
                    resp.raise_for_status()
                    final_usage: dict = {}
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[len("data:") :].strip()
                        if payload == "[DONE]":
                            break
                        chunk = json.loads(payload)
                        if chunk.get("usage"):
                            final_usage = chunk["usage"]
                        yield chunk
                    if final_usage:
                        await _log_usage(
                            user_id=user_id,
                            lecture_id=lecture_id,
                            kind=kind,
                            model=model,
                            usage=final_usage,
                        )
                    return
            except (httpx.TimeoutException, httpx.TransportError):
                if attempt >= len(backoffs):
                    raise
                await sleep(backoffs[attempt])
                attempt += 1


async def embed(
    texts: list[str],
    *,
    model: str | None = None,
    user_id: str | None = None,
    lecture_id: str | None = None,
    sleep: SleepFn = _default_sleep,
    client: httpx.AsyncClient | None = None,
) -> list[list[float]]:
    model = model or settings.embed_model
    body = {"model": model, "input": texts}
    owns_client = client is None
    client = client or httpx.AsyncClient()
    try:
        resp = await _request_with_retry(
            client,
            "POST",
            f"{settings.openrouter_base_url}/embeddings",
            json_body=body,
            headers=_headers(),
            sleep=sleep,
        )
        data = resp.json()
    finally:
        if owns_client:
            await client.aclose()

    usage = data.get("usage", {})
    await _log_usage(user_id=user_id, lecture_id=lecture_id, kind="embed", model=model, usage=usage)
    return [item["embedding"] for item in data["data"]]
