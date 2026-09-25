"""Build search_chunks: 90s windows, 15s overlap, embed in batches of 64."""

from app.ai.gateway import embed
from app.config import settings


def window_segments(segments: list[dict], window_sec: int, overlap_sec: int) -> list[dict]:
    """Group transcript segments into overlapping text windows for embedding."""
    if not segments:
        return []
    window_ms = window_sec * 1000
    step_ms = (window_sec - overlap_sec) * 1000
    end_ms_total = max(s["end_ms"] for s in segments)

    windows = []
    start = segments[0]["start_ms"]
    while start < end_ms_total:
        stop = start + window_ms
        chunk_segs = [s for s in segments if s["start_ms"] < stop and s["end_ms"] > start]
        if chunk_segs:
            windows.append(
                {
                    "start_ms": min(s["start_ms"] for s in chunk_segs),
                    "end_ms": max(s["end_ms"] for s in chunk_segs),
                    "text": " ".join(s["text"] for s in chunk_segs),
                }
            )
        start += step_ms
    return windows


async def index_lecture(
    pool, *, user_id: str, lecture_id: str, course_id: str | None, segments: list[dict]
) -> int:
    """Embeds every window first, then writes all rows in a single
    delete+insert transaction. A crash between embed batches leaves NO rows
    (rather than a partial set that would make plan_steps() see the index as
    already complete), and a redelivered message safely replaces whatever a
    previous partial attempt wrote.
    """
    windows = window_segments(segments, settings.index_window_sec, settings.index_overlap_sec)

    rows = []
    batch_size = settings.embed_batch_size
    for i in range(0, len(windows), batch_size):
        batch = windows[i : i + batch_size]
        vectors = await embed([w["text"] for w in batch], user_id=user_id, lecture_id=lecture_id)
        rows.extend(
            (lecture_id, user_id, course_id, w["start_ms"], w["end_ms"], w["text"], str(vec))
            for w, vec in zip(batch, vectors, strict=True)
        )

    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("delete from search_chunks where lecture_id=$1 and user_id=$2", lecture_id, user_id)
        if rows:
            await conn.executemany(
                """insert into search_chunks(lecture_id, user_id, course_id, start_ms, end_ms, text, embedding)
                   values ($1,$2,$3,$4,$5,$6,$7)""",
                rows,
            )
    return len(rows)
