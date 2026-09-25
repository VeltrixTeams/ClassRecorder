import "server-only";
import { config } from "../config";
import { sql } from "../db";

/** The ONLY module allowed to call OpenRouter. chat / chatStream / embed.
 *
 * Retries on 429/5xx/timeout with backoff config.retryBackoff (default
 * 2s/8s/30s). Sleep function is injectable for tests (pass sleep=... to skip
 * real waiting). Every call logs to ai_usage using the response's
 * `usage.cost` field (OpenRouter returns cost in USD when
 * `usage: {include: true}` is requested). Ported from backend/app/ai/gateway.py. */

export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export type SleepFn = (seconds: number) => Promise<void>;

export const defaultSleep: SleepFn = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

interface Usage {
  prompt_tokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
  output_tokens?: number;
  cost?: number;
  [k: string]: unknown;
}

export async function logUsage(opts: {
  userId?: string | null;
  lectureId?: string | null;
  kind: string;
  model: string;
  usage: Usage;
}): Promise<void> {
  const { userId = null, lectureId = null, kind, model, usage } = opts;
  const inputUnits = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputUnits = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const cost = usage.cost ?? 0;
  await sql()`
    insert into ai_usage(user_id, lecture_id, kind, model, input_units, output_units, cost_usd)
    values (${userId}, ${lectureId}, ${kind}, ${model}, ${Math.trunc(inputUnits)}, ${Math.trunc(outputUnits)}, ${cost})
  `;
}

/** Minimal fetch-compatible client interface, so tests can fake the
 * transport without mocking global fetch. */
export interface HttpClient {
  request(
    method: string,
    url: string,
    opts: { json?: unknown; headers?: Record<string, string> },
  ): Promise<Response>;
}

const fetchClient: HttpClient = {
  async request(method, url, { json, headers }) {
    return fetch(url, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  },
};

async function requestWithRetry(
  client: HttpClient,
  method: string,
  url: string,
  opts: { jsonBody: unknown; headers: Record<string, string>; sleep?: SleepFn },
): Promise<Response> {
  const sleep = opts.sleep ?? defaultSleep;
  const backoffs = [...config.retryBackoff];
  let attempt = 0;
  while (true) {
    let resp: Response;
    try {
      resp = await client.request(method, url, { json: opts.jsonBody, headers: opts.headers });
    } catch (e) {
      if (attempt >= backoffs.length) throw e;
      await sleep(backoffs[attempt]);
      attempt += 1;
      continue;
    }
    if (RETRYABLE_STATUS.has(resp.status) && attempt < backoffs.length) {
      await sleep(backoffs[attempt]);
      attempt += 1;
      continue;
    }
    if (!resp.ok) {
      throw new HttpStatusError(resp.status, `request failed: ${resp.status}`);
    }
    return resp;
  }
}

export class HttpStatusError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
  };
}

export interface ChatMessage {
  role: string;
  content: string | unknown;
}

export interface ChatOpts {
  model?: string;
  responseFormat?: Record<string, unknown>;
  userId?: string | null;
  lectureId?: string | null;
  kind?: string;
  sleep?: SleepFn;
  client?: HttpClient;
}

/** The parts of an OpenRouter chat completion body that callers read. */
export interface ChatCompletion {
  choices: { message: { content: string | null } }[];
  usage?: Usage;
}

/** Non-streaming chat completion. Returns the parsed JSON body. */
export async function chat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<ChatCompletion> {
  const model = opts.model ?? config.chatModel;
  const body: Record<string, unknown> = { model, messages, usage: { include: true } };
  if (opts.responseFormat) body.response_format = opts.responseFormat;

  const client = opts.client ?? fetchClient;
  const resp = await requestWithRetry(client, "POST", `${config.openrouterBaseUrl}/chat/completions`, {
    jsonBody: body,
    headers: headers(),
    sleep: opts.sleep,
  });
  const data = (await resp.json()) as ChatCompletion;

  await logUsage({
    userId: opts.userId,
    lectureId: opts.lectureId,
    kind: opts.kind ?? "chat",
    model,
    usage: data.usage ?? {},
  });
  return data;
}

export interface ChatStreamOpts {
  model?: string;
  userId?: string | null;
  lectureId?: string | null;
  kind?: string;
  sleep?: SleepFn;
  fetchFn?: typeof fetch;
}

/** Streams SSE chunks from OpenRouter. Yields decoded JSON objects per chunk.
 * Retries (with backoff) only apply to the initial connection attempt, not
 * mid-stream failures (can't safely retry a partially-consumed stream). */
export async function* chatStream(
  messages: ChatMessage[],
  opts: ChatStreamOpts = {},
): AsyncIterator<Record<string, unknown>> {
  const model = opts.model ?? config.chatModel;
  const body = { model, messages, stream: true, usage: { include: true } };
  const sleep = opts.sleep ?? defaultSleep;
  const doFetch = opts.fetchFn ?? fetch;
  const backoffs = [...config.retryBackoff];
  let attempt = 0;

  while (true) {
    let resp: Response;
    try {
      resp = await doFetch(`${config.openrouterBaseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt >= backoffs.length) throw e;
      await sleep(backoffs[attempt]);
      attempt += 1;
      continue;
    }

    if (RETRYABLE_STATUS.has(resp.status) && attempt < backoffs.length) {
      await sleep(backoffs[attempt]);
      attempt += 1;
      continue;
    }
    if (!resp.ok || !resp.body) {
      throw new HttpStatusError(resp.status, `request failed: ${resp.status}`);
    }

    let finalUsage: Usage = {};
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice("data:".length).trim();
        if (payload === "[DONE]") break;
        const chunk = JSON.parse(payload);
        if (chunk.usage) finalUsage = chunk.usage;
        yield chunk;
      }
    }
    if (Object.keys(finalUsage).length > 0) {
      await logUsage({
        userId: opts.userId,
        lectureId: opts.lectureId,
        kind: opts.kind ?? "chat",
        model,
        usage: finalUsage,
      });
    }
    return;
  }
}

export interface EmbedOpts {
  model?: string;
  userId?: string | null;
  lectureId?: string | null;
  sleep?: SleepFn;
  client?: HttpClient;
}

export async function embed(texts: string[], opts: EmbedOpts = {}): Promise<number[][]> {
  const model = opts.model ?? config.embedModel;
  const body = { model, input: texts };
  const client = opts.client ?? fetchClient;
  const resp = await requestWithRetry(client, "POST", `${config.openrouterBaseUrl}/embeddings`, {
    jsonBody: body,
    headers: headers(),
    sleep: opts.sleep,
  });
  const data = await resp.json();

  await logUsage({
    userId: opts.userId,
    lectureId: opts.lectureId,
    kind: "embed",
    model,
    usage: data.usage ?? {},
  });
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}
