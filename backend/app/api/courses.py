import json
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import current_user
from app.db import get_pool
from app.errors import not_found

router = APIRouter(prefix="/courses", tags=["courses"])


class ScheduleItem(BaseModel):
    dow: int
    start: str
    end: str


class CourseIn(BaseModel):
    name: str
    instructor: str | None = None
    color: int = 0
    schedule: list[ScheduleItem] = []
    vocabulary: list[str] = []


class CoursePatch(BaseModel):
    name: str | None = None
    instructor: str | None = None
    color: int | None = None
    schedule: list[ScheduleItem] | None = None
    vocabulary: list[str] | None = None


def _row_to_course(r: dict) -> dict:
    d = dict(r)
    d["schedule"] = json.loads(d["schedule"]) if isinstance(d["schedule"], str) else d["schedule"]
    d["id"] = str(d["id"])
    return d


@router.get("")
async def list_courses(user_id: str = Depends(current_user)):
    pool = await get_pool()
    rows = await pool.fetch("select * from courses where user_id=$1 order by created_at desc", user_id)
    return [_row_to_course(r) for r in rows]


@router.post("")
async def create_course(body: CourseIn, user_id: str = Depends(current_user)):
    pool = await get_pool()
    row = await pool.fetchrow(
        """insert into courses(id, user_id, name, instructor, color, schedule, vocabulary)
           values ($1,$2,$3,$4,$5,$6,$7) returning *""",
        uuid.uuid4(), user_id, body.name, body.instructor, body.color,
        json.dumps([s.model_dump() for s in body.schedule]), body.vocabulary,
    )
    return _row_to_course(row)


@router.patch("/{course_id}")
async def patch_course(course_id: uuid.UUID, body: CoursePatch, user_id: str = Depends(current_user)):
    pool = await get_pool()
    existing = await pool.fetchrow("select * from courses where id=$1 and user_id=$2", course_id, user_id)
    if not existing:
        raise not_found("course")
    fields = body.model_dump(exclude_unset=True)
    if "schedule" in fields and fields["schedule"] is not None:
        fields["schedule"] = json.dumps(fields["schedule"])
    if not fields:
        return _row_to_course(existing)
    set_clause = ", ".join(f"{k}=${i+3}" for i, k in enumerate(fields))
    row = await pool.fetchrow(
        f"update courses set {set_clause} where id=$1 and user_id=$2 returning *",
        course_id, user_id, *fields.values(),
    )
    return _row_to_course(row)


@router.delete("/{course_id}", status_code=204)
async def delete_course(course_id: uuid.UUID, user_id: str = Depends(current_user)):
    pool = await get_pool()
    await pool.execute("delete from courses where id=$1 and user_id=$2", course_id, user_id)
