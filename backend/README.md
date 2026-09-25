# LectureNote backend

FastAPI API + worker in one Python package (`app/`), sharing one AI gateway.

## Setup

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate   # or source .venv/bin/activate
pip install -e .[dev]
cp .env.example .env     # fill in Supabase + OpenRouter + Deepgram keys
```

## Run

```bash
uvicorn app.main:app --reload          # API
python -m app.pipeline.worker          # worker (pgmq consumer)
```

## Test / lint

```bash
pytest
ruff check .
```

Requires `ffmpeg`/`ffprobe` on PATH for the pipeline (already in the Docker image).
Tests do not require ffmpeg, a database, or network — AI calls and db are faked/injected.
