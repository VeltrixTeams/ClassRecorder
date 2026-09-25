import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ValidationError

from app.ai.gateway import chat
from app.auth import current_user
from app.config import settings
from app.db import get_pool
from app.errors import api_error, not_found
from app.pipeline.summarize import SummaryContent
from app.storage import create_signed_download_url, create_signed_upload_url, delete_prefix, list_objects

router = APIRouter(prefix="/lectures", tags=["lectures"])


class LectureIn(BaseModel):
    course_id: uuid.UUID | None = None
    title: str | None = None
    recorded_at: datetime


class UploadUrlsIn(BaseModel):
    indices: list[int]


class CompleteIn(BaseModel):
    chunk_count: int
    checksums: list[str]


class BookmarkIn(BaseModel):
    t_ms: int
    note: str | None = None
    image_path: str | None = None


class SummaryPatchIn(BaseModel):
    content: dict


def missing_indices(chunk_count: int, uploaded: set[int]) -> list[int]:
    """Pure helper: which chunk indices in [0, chunk_count) are not uploaded."""
    return sorted(set(range(chunk_count)) - uploaded)


def parse_uploaded_indices(objects: list[dict]) -> set[int]:
    """Pure helper: given a Supabase Storage object-list response for a
    lecture's chunks/ prefix, return the set of chunk indices that are
    actually present with non-zero size (i.e. really uploaded, not just
    claimed by the client)."""
    present = set()
    for obj in objects:
        name = obj.get("name", "")
        size = (obj.get("metadata") or {}).get("size", 0) or 0
        if size <= 0:
            continue
        stem = name.split(".", 1)[0]
        if stem.isdigit():
            present.add(int(stem))
    return present


def _row(r: dict) -> dict:
    d = dict(r)
    for k in ("id", "user_id", "course_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    if isinstance(d.get("progress"), str):
        d["progress"] = json.loads(d["progress"])
    return d


async def _guess_course_id(pool, user_id: str, recorded_at: datetime) -> str | None:
    """Best-effort: match recorded_at against course.schedule + profile.timezone."""
    dow = recorded_at.isoweekday()
    hhmm = recorded_at.strftime("%H:%M")
    courses = await pool.fetch("select id, schedule from courses where user_id=$1", user_id)
    for c in courses:
        schedule = json.loads(c["schedule"]) if isinstance(c["schedule"], str) else c["schedule"]
        for slot in schedule or []:
            if slot.get("dow") == dow and slot.get("start", "00:00") <= hhmm <= slot.get("end", "23:59"):
                return str(c["id"])
    return None


@router.post("")
async def create_lecture(body: LectureIn, user_id: str = Depends(current_user)):
    pool = await get_pool()
    course_id = body.course_id
    if course_id is None:
        course_id = await _guess_course_id(pool, user_id, body.recorded_at)
    row = await pool.fetchrow(
        """insert into lectures(id, user_id, course_id, title, recorded_at, status)
           values ($1,$2,$3,$4,$5,'uploading') returning *""",
        uuid.uuid4(), user_id, course_id, body.title, body.recorded_at,
    )
    return _row(row)


@router.get("")
async def list_lectures(
    course_id: uuid.UUID | None = None, cursor: str | None = None, user_id: str = Depends(current_user)
):
    pool = await get_pool()
    if course_id:
        rows = await pool.fetch(
            "select * from lectures where user_id=$1 and course_id=$2 order by recorded_at desc limit 50",
            user_id, course_id,
        )
    else:
        rows = await pool.fetch(
            "select * from lectures where user_id=$1 order by recorded_at desc limit 50", user_id
        )
    return [_row(r) for r in rows]


@router.get("/{lecture_id}")
async def get_lecture(lecture_id: uuid.UUID, user_id: str = Depends(current_user)):
    pool = await get_pool()
    row = await pool.fetchrow("select * from lectures where id=$1 and user_id=$2", lecture_id, user_id)
    if not row:
        raise not_found("lecture")
    return _row(row)


@router.post("/{lecture_id}/upload-urls")
async def upload_urls(lecture_id: uuid.UUID, body: UploadUrlsIn, user_id: str = Depends(current_user)):
    pool = await get_pool()
    lecture = await pool.fetchrow("select id from lectures where id=$1 and user_id=$2", lecture_id, user_id)
    if not lecture:
        raise not_found("lecture")
    urls = []
    for idx in body.indices:
        # Extension-agnostic: mobile/web clients may upload webm or mp4/m4a
        # opus chunks; prepare.py decodes each segment rather than relying on
        # the container implied by a fixed extension.
        path = f"{user_id}/{lecture_id}/chunks/{idx:04d}.audio"
        signed = await create_signed_upload_url(settings.audio_bucket, path)
        await pool.execute(
            """insert into audio_chunks(lecture_id, user_id, idx, uploaded) values ($1,$2,$3,false)
               on conflict (lecture_id, idx) do nothing""",
            lecture_id, user_id, idx,
        )
        urls.append({"idx": idx, "url": signed["url"], "path": path})
    return {"urls": urls}


@router.post("/{lecture_id}/complete", status_code=202)
async def complete_lecture(lecture_id: uuid.UUID, body: CompleteIn, user_id: str = Depends(current_user)):
    pool = await get_pool()
    lecture = await pool.fetchrow("select * from lectures where id=$1 and user_id=$2", lecture_id, user_id)
    if not lecture:
        raise not_found("lecture")

    if len(body.checksums) != body.chunk_count:
        raise api_error(422, "checksum_count_mismatch", "checksums must have exactly chunk_count entries")

    # Client PUTs chunks directly to signed storage URLs, so /complete is where
    # we verify which indices actually landed: one storage list call on the
    # lecture's chunks/ prefix, trusting only objects that exist with size>0
    # (never the client's claim alone).
    objects = await list_objects(settings.audio_bucket, f"{user_id}/{lecture_id}/chunks")
    uploaded = parse_uploaded_indices(objects)
    missing = missing_indices(body.chunk_count, uploaded)
    if missing:
        raise _missing_409(missing)

    for idx, checksum in enumerate(body.checksums):
        await pool.execute(
            """insert into audio_chunks(lecture_id, user_id, idx, checksum, uploaded) values ($1,$2,$3,$4,true)
               on conflict (lecture_id, idx) do update set checksum=excluded.checksum, uploaded=true""",
            lecture_id, user_id, idx, checksum,
        )

    # quota check: audio hours this month
    usage = await pool.fetchval(
        """select coalesce(sum(duration_ms),0) from lectures
           where user_id=$1 and created_at >= date_trunc('month', now())""",
        user_id,
    )
    this_lecture_hours = (body.chunk_count * settings.chunk_seg_sec) / 3600.0
    if (usage or 0) / 3_600_000.0 + this_lecture_hours > settings.quota_audio_hours_per_month:
        raise api_error(402, "quota_exceeded", "monthly audio quota exceeded")

    await pool.execute(
        "update lectures set chunk_count=$2, status='queued' where id=$1", lecture_id, body.chunk_count
    )
    await pool.execute(f"select pgmq.send('{settings.queue_name}', $1)", json.dumps({"lecture_id": str(lecture_id)}))
    row = await pool.fetchrow("select * from lectures where id=$1", lecture_id)
    return _row(row)


def _missing_409(missing: list[int]):
    from fastapi import HTTPException

    return HTTPException(status_code=409, detail={"missing": missing})


@router.get("/{lecture_id}/audio-url")
async def audio_url(lecture_id: uuid.UUID, user_id: str = Depends(current_user)):
    pool = await get_pool()
    lecture = await pool.fetchrow("select audio_path from lectures where id=$1 and user_id=$2", lecture_id, user_id)
    if not lecture or not lecture["audio_path"]:
        raise not_found("audio")
    # audio_path is already the bucket-relative path ({uid}/{lecture_id}/full.opus).
    url = await create_signed_download_url(settings.audio_bucket, lecture["audio_path"], expires_in=3600)
    return {"url": url}


@router.get("/{lecture_id}/transcript")
async def transcript(
    lecture_id: uuid.UUID, after_ms: int = 0, limit: int = Query(200, le=500), user_id: str = Depends(current_user)
):
    pool = await get_pool()
    rows = await pool.fetch(
        """select id, start_ms, end_ms, speaker, text from transcript_segments
           where lecture_id=$1 and user_id=$2 and start_ms > $3 order by start_ms limit $4""",
        lecture_id, user_id, after_ms, limit,
    )
    return [{**dict(r), "id": str(r["id"])} for r in rows]


@router.get("/{lecture_id}/summary")
async def get_summary(lecture_id: uuid.UUID, lang: str = "th", user_id: str = Depends(current_user)):
    pool = await get_pool()
    lecture = await pool.fetchrow("select * from lectures where id=$1 and user_id=$2", lecture_id, user_id)
    if not lecture:
        raise not_found("lecture")

    row = await pool.fetchrow(
        "select * from summaries where lecture_id=$1 and user_id=$2 and lang=$3", lecture_id, user_id, lang
    )
    if row and not row["stale"]:
        return _summary_row(row)

    if lang == "en" and (row is None or row["stale"]):
        th_row = await pool.fetchrow(
            "select content from summaries where lecture_id=$1 and user_id=$2 and lang='th'", lecture_id, user_id
        )
        if not th_row:
            raise not_found("summary")
        content = json.loads(th_row["content"]) if isinstance(th_row["content"], str) else th_row["content"]
        translated = await _translate_summary(content, user_id, str(lecture_id))
        row = await pool.fetchrow(
            """insert into summaries(lecture_id, user_id, lang, content) values ($1,$2,'en',$3)
               on conflict (lecture_id, lang) do update set content=excluded.content, stale=false
               returning *""",
            lecture_id, user_id, json.dumps(translated),
        )
        return _summary_row(row)

    if not row:
        raise not_found("summary")
    return _summary_row(row)


async def _translate_summary(content: dict, user_id: str, lecture_id: str) -> dict:
    resp = await chat(
        [
            {
                "role": "system",
                "content": (
                    "Translate the following lecture summary JSON to English. "
                    "Keep the same JSON shape with 't' unchanged."
                ),
            },
            {"role": "user", "content": json.dumps(content)},
        ],
        user_id=user_id, lecture_id=lecture_id, kind="translate",
    )
    text = resp["choices"][0]["message"]["content"]
    try:
        parsed = json.loads(text)
        return SummaryContent.model_validate(parsed).model_dump()
    except (ValueError, ValidationError):
        return content


def _summary_row(row) -> dict:
    d = dict(row)
    d["content"] = json.loads(d["content"]) if isinstance(d["content"], str) else d["content"]
    d["lecture_id"] = str(d["lecture_id"])
    return d


@router.patch("/{lecture_id}/summary")
async def patch_summary(lecture_id: uuid.UUID, body: SummaryPatchIn, user_id: str = Depends(current_user)):
    pool = await get_pool()
    try:
        validated = SummaryContent.model_validate(body.content)
    except ValidationError as e:
        raise api_error(422, "invalid_summary", str(e)) from e

    row = await pool.fetchrow(
        """update summaries set content=$3, edited=true where lecture_id=$1 and user_id=$2 and lang='th'
           returning *""",
        lecture_id, user_id, json.dumps(validated.model_dump()),
    )
    if not row:
        raise not_found("summary")
    await pool.execute(
        "update summaries set stale=true where lecture_id=$1 and user_id=$2 and lang='en'", lecture_id, user_id
    )
    return _summary_row(row)


@router.post("/{lecture_id}/bookmarks")
async def create_bookmark(lecture_id: uuid.UUID, body: BookmarkIn, user_id: str = Depends(current_user)):
    pool = await get_pool()
    row = await pool.fetchrow(
        """insert into bookmarks(id, lecture_id, user_id, t_ms, note, image_path)
           values ($1,$2,$3,$4,$5,$6) returning *""",
        uuid.uuid4(), lecture_id, user_id, body.t_ms, body.note, body.image_path,
    )
    d = dict(row)
    d["id"] = str(d["id"])
    d["lecture_id"] = str(d["lecture_id"])
    return d


@router.post("/{lecture_id}/retry", status_code=202)
async def retry_lecture(lecture_id: uuid.UUID, user_id: str = Depends(current_user)):
    pool = await get_pool()
    row = await pool.fetchrow(
        "update lectures set status='queued', error=null where id=$1 and user_id=$2 and status='failed' returning id",
        lecture_id, user_id,
    )
    if not row:
        raise not_found("failed lecture")
    await pool.execute(f"select pgmq.send('{settings.queue_name}', $1)", json.dumps({"lecture_id": str(lecture_id)}))
    return {"status": "queued"}


@router.delete("/{lecture_id}", status_code=204)
async def delete_lecture(lecture_id: uuid.UUID, user_id: str = Depends(current_user)):
    pool = await get_pool()
    lecture = await pool.fetchrow("select * from lectures where id=$1 and user_id=$2", lecture_id, user_id)
    if not lecture:
        raise not_found("lecture")
    await delete_prefix(settings.audio_bucket, f"{user_id}/{lecture_id}")
    await pool.execute("delete from lectures where id=$1 and user_id=$2", lecture_id, user_id)
