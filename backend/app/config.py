from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase
    supabase_url: str = "http://localhost:54321"
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = "dev-secret"
    database_url: str = "postgresql://postgres:postgres@localhost:54322/postgres"

    # OpenRouter
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    chat_model: str = "anthropic/claude-3.5-sonnet"
    embed_model: str = "openai/text-embedding-3-small"
    embed_dim: int = 1536

    # STT
    stt_provider: str = "deepgram"  # deepgram | openrouter
    deepgram_api_key: str = ""
    deepgram_base_url: str = "https://api.deepgram.com/v1"
    stt_chunk_sec: int = 600

    # web push (VAPID)
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    # CORS
    web_origin: str = "http://localhost:3000"

    # storage buckets
    audio_bucket: str = "audio"
    images_bucket: str = "images"

    # pipeline
    chunk_seg_sec: int = 30
    chunk_overlap_sec: int = 2
    index_window_sec: int = 90
    index_overlap_sec: int = 15
    embed_batch_size: int = 64
    map_reduce_char_threshold: int = 240_000  # ~60k tokens * 4 chars/token
    map_reduce_window_min: int = 30

    # worker
    queue_name: str = "lecture_jobs_q"
    job_vt_seconds: int = 1800
    transcribe_concurrency: int = 6
    retention_check_interval_sec: int = 3600
    daily_cost_cap_usd: float = 20.0

    # quotas
    quota_audio_hours_per_month: float = 40.0
    quota_questions_per_day: int = 50

    # retry backoff (seconds), injectable in tests
    retry_backoff: tuple[float, float, float] = (2.0, 8.0, 30.0)


settings = Settings()
