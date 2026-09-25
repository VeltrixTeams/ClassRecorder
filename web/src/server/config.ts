import "server-only";

/** Typed env read, lazy so `next build` works without env vars set. Mirrors
 * backend/app/config.py (pydantic Settings) for the fields still relevant
 * server-side in the all-in-Vercel port. */

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env var ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  return v === undefined ? fallback : Number(v);
}

export const config = {
  // Supabase
  get supabaseUrl() {
    return env("SUPABASE_URL", "http://localhost:54321");
  },
  get supabaseServiceRoleKey() {
    return env("SUPABASE_SERVICE_ROLE_KEY", "");
  },
  get supabaseJwtSecret() {
    return env("SUPABASE_JWT_SECRET", "dev-secret");
  },
  get databaseUrl() {
    return env("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres");
  },

  // OpenRouter
  get openrouterApiKey() {
    return env("OPENROUTER_API_KEY", "");
  },
  get openrouterBaseUrl() {
    return env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
  },
  get chatModel() {
    return env("CHAT_MODEL", "anthropic/claude-haiku-4.5");
  },
  get summaryModel() {
    return env("SUMMARY_MODEL", "anthropic/claude-sonnet-5");
  },
  get embedModel() {
    return env("EMBED_MODEL", "openai/text-embedding-3-small");
  },
  get embedDim() {
    return num("EMBED_DIM", 1536);
  },

  // STT (Deepgram only in v2)
  get deepgramApiKey() {
    return env("DEEPGRAM_API_KEY", "");
  },
  get deepgramBaseUrl() {
    return env("DEEPGRAM_BASE_URL", "https://api.deepgram.com/v1");
  },

  // web push (VAPID)
  get vapidPrivateKey() {
    return env("VAPID_PRIVATE_KEY", "");
  },
  get vapidPublicKey() {
    return env("VAPID_PUBLIC_KEY", "");
  },
  get vapidSubject() {
    return env("VAPID_SUBJECT", "mailto:admin@example.com");
  },

  // app / webhooks / cron
  get appUrl() {
    return env("APP_URL", "http://localhost:3000");
  },
  get webhookSecret() {
    return env("WEBHOOK_SECRET", "dev-webhook-secret");
  },
  get cronSecret() {
    return env("CRON_SECRET", "dev-cron-secret");
  },

  // storage buckets
  get audioBucket() {
    return env("AUDIO_BUCKET", "audio");
  },
  get imagesBucket() {
    return env("IMAGES_BUCKET", "images");
  },

  // pipeline
  get indexWindowSec() {
    return num("INDEX_WINDOW_SEC", 90);
  },
  get indexOverlapSec() {
    return num("INDEX_OVERLAP_SEC", 15);
  },
  get embedBatchSize() {
    return num("EMBED_BATCH_SIZE", 64);
  },
  get mapReduceCharThreshold() {
    return num("MAP_REDUCE_CHAR_THRESHOLD", 240_000); // ~60k tokens * 4 chars/token
  },
  get mapReduceWindowMin() {
    return num("MAP_REDUCE_WINDOW_MIN", 30);
  },

  get dailyCostCapUsd() {
    return num("DAILY_COST_CAP_USD", 20.0);
  },

  get chunkSegSec() {
    return num("CHUNK_SEG_SEC", 30);
  },

  // quotas
  get quotaAudioHoursPerMonth() {
    return num("QUOTA_AUDIO_HOURS_PER_MONTH", 40.0);
  },
  get quotaQuestionsPerDay() {
    return num("QUOTA_QUESTIONS_PER_DAY", 50);
  },

  // retry backoff (seconds), injectable in tests
  get retryBackoff(): [number, number, number] {
    return [2.0, 8.0, 30.0];
  },
};
