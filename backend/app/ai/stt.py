"""Speech-to-text. transcribe(path, offset_ms, prompt) -> list[Word].

STT_PROVIDER=deepgram (default): direct Deepgram nova-3, word-level timestamps,
diarization. STT_PROVIDER=openrouter: chat completions with input_audio,
segment-level timestamps only (no verified word-timestamp STT via OpenRouter).
Both providers route retries through the same backoff scheme as the gateway
and log ai_usage.
"""

import base64
from collections.abc import Callable, Coroutine
from typing import Any, TypedDict

import httpx

from app.ai.gateway import RETRYABLE_STATUS, _default_sleep, _headers, _log_usage
from app.config import settings

SleepFn = Callable[[float], Coroutine[Any, Any, None]]


class Word(TypedDict):
    start_ms: int
    end_ms: int
    text: str
    speaker: str  # 'lecturer' | 'student'


async def _retry_post(
    client: httpx.AsyncClient, url: str, *, headers: dict, content: bytes | None = None,
    json_body: dict | None = None, sleep: SleepFn = _default_sleep,
) -> httpx.Response:
    backoffs = list(settings.retry_backoff)
    attempt = 0
    while True:
        try:
            resp = await client.post(url, headers=headers, content=content, json=json_body, timeout=300.0)
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


def _diarize_speaker(dg_speaker: int | None, lecturer_speaker_id: int | None) -> str:
    if dg_speaker is None or lecturer_speaker_id is None:
        return "lecturer"
    return "lecturer" if dg_speaker == lecturer_speaker_id else "student"


async def _transcribe_deepgram(
    path: str, offset_ms: int, *, user_id: str | None, lecture_id: str | None, sleep: SleepFn,
) -> list[Word]:
    with open(path, "rb") as f:
        audio_bytes = f.read()

    url = (
        f"{settings.deepgram_base_url}/listen"
        "?model=nova-3&language=en&diarize=true&smart_format=true&punctuate=true&utterances=true"
    )
    headers = {"Authorization": f"Token {settings.deepgram_api_key}", "Content-Type": "audio/ogg"}

    async with httpx.AsyncClient() as client:
        resp = await _retry_post(client, url, headers=headers, content=audio_bytes, sleep=sleep)
        data = resp.json()

    metadata = data.get("metadata", {})
    duration_sec = metadata.get("duration", 0)
    await _log_usage(
        user_id=user_id,
        lecture_id=lecture_id,
        kind="stt",
        model="deepgram-nova-3",
        usage={"input_units": int(duration_sec), "output_units": 0, "cost": duration_sec * 0.0043 / 60},
    )

    channel = data.get("results", {}).get("channels", [{}])[0]
    alt = channel.get("alternatives", [{}])[0]
    words_raw = alt.get("words", [])

    # Speaker who talks the most in this chunk = lecturer (per-chunk rule, §4).
    talk_time: dict[int, float] = {}
    for w in words_raw:
        spk = w.get("speaker")
        if spk is None:
            continue
        talk_time[spk] = talk_time.get(spk, 0.0) + (w.get("end", 0) - w.get("start", 0))
    lecturer_speaker_id = max(talk_time, key=talk_time.get) if talk_time else None

    words: list[Word] = []
    for w in words_raw:
        words.append(
            Word(
                start_ms=offset_ms + int(w.get("start", 0) * 1000),
                end_ms=offset_ms + int(w.get("end", 0) * 1000),
                text=w.get("punctuated_word") or w.get("word", ""),
                speaker=_diarize_speaker(w.get("speaker"), lecturer_speaker_id),
            )
        )
    return words


async def _transcribe_openrouter(
    path: str, offset_ms: int, prompt: str | None, *, user_id: str | None, lecture_id: str | None, sleep: SleepFn,
) -> list[Word]:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    content = [
        {
            "type": "text",
            "text": (
                "Transcribe this lecture audio segment. Return segments with approximate "
                "start/end seconds relative to this clip, speaker (lecturer or student), "
                "and text, as a JSON array of {start,end,speaker,text}."
                + (f" Vocabulary hints: {prompt}" if prompt else "")
            ),
        },
        {"type": "input_audio", "input_audio": {"data": b64, "format": "ogg"}},
    ]
    body = {
        "model": settings.chat_model,
        "messages": [{"role": "user", "content": content}],
        "usage": {"include": True},
    }

    async with httpx.AsyncClient() as client:
        resp = await _retry_post(
            client,
            f"{settings.openrouter_base_url}/chat/completions",
            headers=_headers(),
            json_body=body,
            sleep=sleep,
        )
        data = resp.json()

    usage = data.get("usage", {})
    await _log_usage(user_id=user_id, lecture_id=lecture_id, kind="stt", model=settings.chat_model, usage=usage)

    import json as _json

    text = data["choices"][0]["message"]["content"]
    try:
        segments = _json.loads(text)
    except ValueError:
        segments = []

    words: list[Word] = []
    for seg in segments:
        words.append(
            Word(
                start_ms=offset_ms + int(float(seg.get("start", 0)) * 1000),
                end_ms=offset_ms + int(float(seg.get("end", 0)) * 1000),
                text=seg.get("text", ""),
                speaker=seg.get("speaker") or "lecturer",
            )
        )
    return words


async def transcribe(
    path: str,
    offset_ms: int,
    prompt: str | None = None,
    *,
    user_id: str | None = None,
    lecture_id: str | None = None,
    sleep: SleepFn = _default_sleep,
) -> list[Word]:
    if settings.stt_provider == "openrouter":
        return await _transcribe_openrouter(
            path, offset_ms, prompt, user_id=user_id, lecture_id=lecture_id, sleep=sleep
        )
    return await _transcribe_deepgram(path, offset_ms, user_id=user_id, lecture_id=lecture_id, sleep=sleep)
