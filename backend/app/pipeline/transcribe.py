"""Parallel per-chunk STT (asyncio.Semaphore(6)), cached in stt_chunks, then
merged via pipeline.merge into transcript_segments.
"""

import asyncio
import json

from app.ai.stt import transcribe as stt_transcribe
from app.config import settings
from app.pipeline.merge import merge_chunks


async def transcribe_chunks(
    pool,
    *,
    user_id: str,
    lecture_id: str,
    chunk_paths: list[str],
    chunk_sec: int,
    vocabulary_prompt: str | None = None,
) -> list[list[dict]]:
    """Runs STT per chunk (parallel, capped), using stt_chunks as a cache.
    Returns a list of word-lists, one per chunk index, in order.
    """
    sem = asyncio.Semaphore(settings.transcribe_concurrency)
    results: list[list[dict] | None] = [None] * len(chunk_paths)

    async def do_chunk(idx: int, path: str) -> None:
        cached = await pool.fetchrow(
            "select result from stt_chunks where lecture_id=$1 and idx=$2 and user_id=$3",
            lecture_id, idx, user_id,
        )
        if cached is not None:
            results[idx] = json.loads(cached["result"]) if isinstance(cached["result"], str) else cached["result"]
            return
        async with sem:
            offset_ms = idx * chunk_sec * 1000
            words = await stt_transcribe(
                path, offset_ms, vocabulary_prompt, user_id=user_id, lecture_id=lecture_id
            )
        await pool.execute(
            """insert into stt_chunks(lecture_id, user_id, idx, start_ms, result)
               values ($1,$2,$3,$4,$5)
               on conflict (lecture_id, idx) do update set result = excluded.result""",
            lecture_id, user_id, idx, offset_ms, json.dumps(words),
        )
        results[idx] = words

    await asyncio.gather(*(do_chunk(i, p) for i, p in enumerate(chunk_paths)))
    return [r or [] for r in results]


async def save_segments(pool, *, user_id: str, lecture_id: str, chunks: list[list[dict]]) -> list[dict]:
    """Replaces this lecture's transcript_segments in one delete+insert
    transaction, so a redelivered message after a partial write (or a retry)
    never leaves duplicate/partial segments behind.
    """
    segments = merge_chunks(chunks)
    rows = [
        (lecture_id, user_id, s["start_ms"], s["end_ms"], s["speaker"], s["text"], json.dumps(s["words"]))
        for s in segments
    ]
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "delete from transcript_segments where lecture_id=$1 and user_id=$2", lecture_id, user_id
        )
        if rows:
            await conn.executemany(
                """insert into transcript_segments(lecture_id, user_id, start_ms, end_ms, speaker, text, words)
                   values ($1,$2,$3,$4,$5,$6,$7)""",
                rows,
            )
    return segments
