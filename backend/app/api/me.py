import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import current_user
from app.config import settings
from app.db import get_pool
from app.storage import delete_prefix

router = APIRouter(tags=["me"])


class ProfilePatch(BaseModel):
    timezone: str | None = None
    retention_days: int | None = None
    push_subscription: dict | None = None


@router.get("/me")
async def get_profile(user_id: str = Depends(current_user)):
    pool = await get_pool()
    row = await pool.fetchrow("select * from profiles where user_id=$1", user_id)
    return dict(row) if row else {}


@router.put("/me")
async def update_profile(body: ProfilePatch, user_id: str = Depends(current_user)):
    pool = await get_pool()
    fields = body.model_dump(exclude_unset=True)
    if "push_subscription" in fields and fields["push_subscription"] is not None:
        fields["push_subscription"] = json.dumps(fields["push_subscription"])
    if fields:
        set_clause = ", ".join(f"{k}=${i+2}" for i, k in enumerate(fields))
        row = await pool.fetchrow(
            f"update profiles set {set_clause} where user_id=$1 returning *", user_id, *fields.values()
        )
    else:
        row = await pool.fetchrow("select * from profiles where user_id=$1", user_id)
    return dict(row)


@router.delete("/me", status_code=204)
async def delete_account(user_id: str = Depends(current_user)):
    pool = await get_pool()
    await delete_prefix(settings.audio_bucket, user_id)
    await delete_prefix(settings.images_bucket, user_id)
    await pool.execute("delete from auth.users where id=$1", user_id)
