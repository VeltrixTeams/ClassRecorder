import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import current_user
from app.db import get_pool
from app.errors import not_found

router = APIRouter(prefix="/vocabulary", tags=["vocabulary"])


class VocabIn(BaseModel):
    term: str
    meaning: str | None = None
    course_id: uuid.UUID | None = None
    lecture_id: uuid.UUID | None = None
    t_ms: int | None = None


def _row(r: dict) -> dict:
    d = dict(r)
    for k in ("id", "course_id", "lecture_id"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    return d


@router.get("")
async def list_vocab(user_id: str = Depends(current_user)):
    pool = await get_pool()
    rows = await pool.fetch("select * from vocabulary where user_id=$1 order by id desc", user_id)
    return [_row(r) for r in rows]


@router.post("")
async def create_vocab(body: VocabIn, user_id: str = Depends(current_user)):
    pool = await get_pool()
    row = await pool.fetchrow(
        """insert into vocabulary(id, user_id, course_id, term, meaning, lecture_id, t_ms)
           values ($1,$2,$3,$4,$5,$6,$7) returning *""",
        uuid.uuid4(), user_id, body.course_id, body.term, body.meaning, body.lecture_id, body.t_ms,
    )
    return _row(row)


@router.delete("/{vocab_id}", status_code=204)
async def delete_vocab(vocab_id: uuid.UUID, user_id: str = Depends(current_user)):
    pool = await get_pool()
    result = await pool.execute("delete from vocabulary where id=$1 and user_id=$2", vocab_id, user_id)
    if result == "DELETE 0":
        raise not_found("vocabulary")
