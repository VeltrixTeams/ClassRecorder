import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.ai.gateway import embed
from app.auth import current_user
from app.db import get_pool

router = APIRouter(tags=["search"])


@router.get("/search")
async def search(
    q: str,
    course_id: uuid.UUID | None = None,
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    user_id: str = Depends(current_user),
):
    pool = await get_pool()
    [vec] = await embed([q], user_id=user_id)
    rows = await pool.fetch(
        "select * from hybrid_search($1,$2,$3,$4,$5,$6,$7)",
        user_id, str(vec), q, course_id, from_, to, 20,
    )
    return [
        {
            "lecture_id": str(r["lecture_id"]),
            "course_id": str(r["course_id"]) if r["course_id"] else None,
            "start_ms": r["start_ms"],
            "end_ms": r["end_ms"],
            "text": r["text"],
            "score": r["score"],
        }
        for r in rows
    ]
