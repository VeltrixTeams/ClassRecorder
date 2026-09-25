"""Worker entrypoint: pgmq.read -> process_lecture -> archive/fail.

All durable state lives in Supabase Storage + Postgres, never on local disk:
a job can be picked up by any worker process (or the same one after a crash
or restart), so every step downloads its inputs from storage/DB rather than
assuming files left behind by a previous attempt. `work_dir` is a scratch
directory for ffmpeg intermediates only and is removed once the lecture is
ready (or left behind harmlessly if the process dies first — a re-run just
recreates it).

Each step is gated on whether ITS OUTPUT already exists (§3 tables/columns),
not on the lecture's current `status` column, via `plan_steps()` below. This
is what makes /retry and a mid-step crash both resume correctly: the status
column is only used for the UI's progress display.
Job visibility timeout is extended (pgmq.set_vt) between chunk-level steps
so a slow lecture doesn't get redelivered to another worker mid-flight.
"""

import asyncio
import json
import logging
import os
import shutil
import tempfile

from app.config import settings
from app.db import get_pool
from app.pipeline import index as index_step
from app.pipeline import prepare
from app.pipeline.notify import send_push
from app.pipeline.summarize import summarize
from app.pipeline.transcribe import save_segments, transcribe_chunks
from app.storage import delete_prefix, download, upload

logger = logging.getLogger("worker")

STEP_ORDER = ("prepare", "transcribe", "summarize", "index")

# lecture.status to show in the UI while running each step (best-effort; the
# actual resume decision is plan_steps(), not this status column).
STEP_STATUS = {"prepare": "preparing", "transcribe": "transcribing", "summarize": "summarizing", "index": "indexing"}


def plan_steps(
    *, has_full_opus: bool, has_transcript: bool, has_th_summary: bool, has_search_chunks: bool
) -> list[str]:
    """PURE: given which outputs already exist, return the ordered list of
    steps still needed to reach 'ready'. Used both for a fresh job and to
    resume a job that crashed mid-step or is being retried after a failure —
    whichever steps already produced their output are skipped.
    """
    steps = []
    if not has_full_opus:
        steps.append("prepare")
    if not has_transcript:
        steps.append("transcribe")
    if not has_th_summary:
        steps.append("summarize")
    if not has_search_chunks:
        steps.append("index")
    return steps


async def set_status(pool, lecture_id: str, status: str, *, progress: dict | None = None, error: str | None = None) -> None:
    await pool.execute(
        "update lectures set status=$2, progress=coalesce($3, progress), error=$4 where id=$1",
        lecture_id, status, json.dumps(progress) if progress is not None else None, error,
    )


async def _notify(pool, user_id: str, title: str, body: str, data: dict | None = None) -> None:
    profile = await pool.fetchrow("select push_subscription from profiles where user_id=$1", user_id)
    if not profile or not profile["push_subscription"]:
        return
    ok = await send_push(profile["push_subscription"], title, body, data)
    if not ok:
        await pool.execute("update profiles set push_subscription=null where user_id=$1", user_id)


async def extend_vt(pool, msg_id: int) -> None:
    await pool.execute(f"select pgmq.set_vt('{settings.queue_name}', $1, $2)", msg_id, settings.job_vt_seconds)


def audio_path_for(user_id: str, lecture_id: str) -> str:
    # First path segment must be the uid to match the storage bucket's RLS
    # policy (auth.uid() = first path segment).
    return f"{user_id}/{lecture_id}/full.opus"


def chunk_object_path(user_id: str, lecture_id: str, idx: int) -> str:
    return f"{user_id}/{lecture_id}/chunks/{idx:04d}.audio"


async def _has_outputs(pool, lecture_id: str, user_id: str, lecture) -> dict[str, bool]:
    has_transcript = bool(
        await pool.fetchval(
            "select count(*) from transcript_segments where lecture_id=$1 and user_id=$2", lecture_id, user_id
        )
    )
    has_th_summary = bool(
        await pool.fetchval(
            "select 1 from summaries where lecture_id=$1 and user_id=$2 and lang='th'", lecture_id, user_id
        )
    )
    has_search_chunks = bool(
        await pool.fetchval(
            "select count(*) from search_chunks where lecture_id=$1 and user_id=$2", lecture_id, user_id
        )
    )
    return {
        "has_full_opus": bool(lecture["audio_path"]),
        "has_transcript": has_transcript,
        "has_th_summary": has_th_summary,
        "has_search_chunks": has_search_chunks,
    }


async def _download_chunks(work_dir: str, user_id: str, lecture_id: str, chunk_count: int) -> list[str]:
    chunk_dir = os.path.join(work_dir, "chunks")
    os.makedirs(chunk_dir, exist_ok=True)
    paths = []
    for idx in range(chunk_count):
        dest = os.path.join(chunk_dir, f"{idx:04d}.audio")
        await download(settings.audio_bucket, chunk_object_path(user_id, lecture_id, idx), dest)
        paths.append(dest)
    return paths


async def _ensure_full_opus_local(work_dir: str, pool, user_id: str, lecture_id: str, lecture) -> str:
    """Returns a local path to full.opus, downloading from storage if this
    worker doesn't have it locally (resumed job / different worker)."""
    full_opus = os.path.join(work_dir, "full.opus")
    if os.path.exists(full_opus):
        return full_opus
    if lecture["audio_path"]:
        await download(settings.audio_bucket, lecture["audio_path"], full_opus)
        return full_opus
    raise RuntimeError("full.opus missing both locally and in storage; run the prepare step first")


async def _run_prepare(pool, work_dir, *, user_id, lecture_id, lecture) -> None:
    chunk_count = lecture["chunk_count"] or 0
    chunk_paths = await _download_chunks(work_dir, user_id, lecture_id, chunk_count)
    full_opus = os.path.join(work_dir, "full.opus")
    await prepare.concat_to_opus(chunk_paths, full_opus)
    duration_ms = await prepare.probe_duration_ms(full_opus)
    audio_path = audio_path_for(user_id, lecture_id)
    await upload(settings.audio_bucket, audio_path, full_opus, content_type="audio/ogg")
    await pool.execute(
        "update lectures set audio_path=$2, duration_ms=$3 where id=$1", lecture_id, audio_path, duration_ms
    )


async def _run_transcribe(pool, work_dir, *, user_id, lecture_id, lecture, course_id) -> None:
    full_opus = await _ensure_full_opus_local(work_dir, pool, user_id, lecture_id, lecture)
    full_wav = os.path.join(work_dir, "full.wav")
    await prepare.to_wav_16k(full_opus, full_wav)
    stt_chunk_paths = await prepare.split_stt_chunks(full_wav, os.path.join(work_dir, "stt"), settings.stt_chunk_sec)

    course = (
        await pool.fetchrow("select vocabulary from courses where id=$1 and user_id=$2", lecture["course_id"], user_id)
        if course_id
        else None
    )
    vocab_prompt = ", ".join(course["vocabulary"]) if course and course["vocabulary"] else None

    chunks = await transcribe_chunks(
        pool, user_id=user_id, lecture_id=lecture_id, chunk_paths=stt_chunk_paths,
        chunk_sec=settings.stt_chunk_sec, vocabulary_prompt=vocab_prompt,
    )
    await save_segments(pool, user_id=user_id, lecture_id=lecture_id, chunks=chunks)


async def _run_summarize(pool, *, user_id, lecture_id, lecture) -> None:
    seg_rows = await pool.fetch(
        """select start_ms, end_ms, speaker, text from transcript_segments
           where lecture_id=$1 and user_id=$2 order by start_ms""",
        lecture_id, user_id,
    )
    segments = [dict(r) for r in seg_rows]
    result = await summarize(segments, lecture["duration_ms"] or 0, user_id=user_id, lecture_id=lecture_id)
    content = result.model_dump()
    await pool.execute(
        """insert into summaries(lecture_id, user_id, lang, content) values ($1,$2,'th',$3)
           on conflict (lecture_id, lang) do update set content=excluded.content, stale=false""",
        lecture_id, user_id, json.dumps(content),
    )


async def _run_index(pool, *, user_id, lecture_id, course_id) -> None:
    seg_rows = await pool.fetch(
        "select start_ms, end_ms, text from transcript_segments where lecture_id=$1 and user_id=$2 order by start_ms",
        lecture_id, user_id,
    )
    segments = [dict(r) for r in seg_rows]
    await index_step.index_lecture(pool, user_id=user_id, lecture_id=lecture_id, course_id=course_id, segments=segments)


async def process_lecture(pool, lecture_id: str, msg_id: int) -> None:
    lecture = await pool.fetchrow("select * from lectures where id=$1", lecture_id)
    if lecture is None:
        return
    user_id = str(lecture["user_id"])
    course_id = str(lecture["course_id"]) if lecture["course_id"] else None

    work_dir = os.path.join(tempfile.gettempdir(), "lecturenote-work", lecture_id)
    os.makedirs(work_dir, exist_ok=True)

    try:
        while True:
            outputs = await _has_outputs(pool, lecture_id, user_id, lecture)
            steps = plan_steps(
                has_full_opus=outputs["has_full_opus"],
                has_transcript=outputs["has_transcript"],
                has_th_summary=outputs["has_th_summary"],
                has_search_chunks=outputs["has_search_chunks"],
            )
            if not steps:
                break
            step = steps[0]
            await set_status(
                pool, lecture_id, STEP_STATUS[step],
                progress={"step": step, "done": STEP_ORDER.index(step), "total": len(STEP_ORDER)},
            )

            if step == "prepare":
                await _run_prepare(pool, work_dir, user_id=user_id, lecture_id=lecture_id, lecture=lecture)
            elif step == "transcribe":
                await _run_transcribe(pool, work_dir, user_id=user_id, lecture_id=lecture_id, lecture=lecture, course_id=course_id)
            elif step == "summarize":
                await _run_summarize(pool, user_id=user_id, lecture_id=lecture_id, lecture=lecture)
            elif step == "index":
                await _run_index(pool, user_id=user_id, lecture_id=lecture_id, course_id=course_id)

            await extend_vt(pool, msg_id)
            lecture = await pool.fetchrow("select * from lectures where id=$1", lecture_id)

        # done: drop the 30s chunk objects (§1 retention), keep full.opus
        await delete_prefix(settings.audio_bucket, f"{user_id}/{lecture_id}/chunks")
        await set_status(pool, lecture_id, "ready", progress={"step": "ready", "done": len(STEP_ORDER), "total": len(STEP_ORDER)})
        await _notify(pool, user_id, "สรุปพร้อมแล้ว", "บันทึกการบรรยายของคุณพร้อมให้อ่านแล้ว", {"lecture_id": lecture_id})
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


async def run_once(pool) -> bool:
    """Reads and processes a single job. Returns True if a job was processed."""
    cap_exceeded = await pool.fetchval(
        "select coalesce(sum(cost_usd),0) >= $1 from ai_usage where created_at >= date_trunc('day', now())",
        settings.daily_cost_cap_usd,
    )
    if cap_exceeded:
        return False

    row = await pool.fetchrow(
        f"select * from pgmq.read('{settings.queue_name}', $1, 1)", settings.job_vt_seconds
    )
    if row is None:
        return False

    msg_id = row["msg_id"]
    message = row["message"] if isinstance(row["message"], dict) else json.loads(row["message"])
    lecture_id = message["lecture_id"]

    try:
        await process_lecture(pool, lecture_id, msg_id)
        await pool.execute(f"select pgmq.archive('{settings.queue_name}', $1)", msg_id)
    except Exception as e:
        logger.exception("job failed for lecture %s", lecture_id)
        await set_status(pool, lecture_id, "failed", error=str(e))
        try:
            lecture = await pool.fetchrow("select user_id from lectures where id=$1", lecture_id)
            await _notify(pool, str(lecture["user_id"]), "เกิดข้อผิดพลาด", "การประมวลผลบันทึกล้มเหลว ลองใหม่อีกครั้ง", {"lecture_id": lecture_id})
        except Exception:  # noqa: BLE001
            pass
        await pool.execute(f"select pgmq.archive('{settings.queue_name}', $1)", msg_id)
    return True


async def cleanup_retention(pool) -> None:
    """Hourly: delete full.opus for lectures past the user's retention_days."""
    rows = await pool.fetch(
        """select l.id, l.user_id, l.audio_path from lectures l
           join profiles p on p.user_id = l.user_id
           where l.audio_path is not null
             and l.status = 'ready'
             and l.recorded_at < now() - (p.retention_days || ' days')::interval"""
    )
    from app.storage import delete_object

    for r in rows:
        await delete_object(settings.audio_bucket, r["audio_path"])
        await pool.execute("update lectures set audio_path=null where id=$1", r["id"])


async def main_loop() -> None:
    pool = await get_pool()
    last_cleanup = 0.0
    loop = asyncio.get_event_loop()
    while True:
        processed = await run_once(pool)
        now = loop.time()
        if now - last_cleanup > settings.retention_check_interval_sec:
            await cleanup_retention(pool)
            last_cleanup = now
        if not processed:
            await asyncio.sleep(5)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main_loop())
