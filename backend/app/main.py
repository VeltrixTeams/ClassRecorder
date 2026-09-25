from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import chat, courses, lectures, me, search, vocabulary
from app.config import settings
from app.db import close_pool, get_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield
    await close_pool()


app = FastAPI(title="LectureNote API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail:
        return JSONResponse(status_code=exc.status_code, content=detail)
    if isinstance(detail, dict) and "missing" in detail:
        return JSONResponse(status_code=exc.status_code, content=detail)
    return JSONResponse(
        status_code=exc.status_code, content={"error": {"code": "error", "message": str(detail)}}
    )


app.include_router(courses.router)
app.include_router(lectures.router)
app.include_router(search.router)
app.include_router(chat.router)
app.include_router(vocabulary.router)
app.include_router(me.router)


@app.get("/health")
async def health():
    return {"ok": True}
