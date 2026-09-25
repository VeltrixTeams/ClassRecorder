import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

/** Deepgram pre-recorded-by-URL submission with callback (§v2.1 STT row):
 * POST /v1/listen?model=nova-3&...&callback=... body {url}. Returns the
 * Deepgram request_id to store on the lecture as stt_request_id. */
export async function submit(url: string, callbackUrl: string, keywords?: string[]): Promise<string> {
  const params = new URLSearchParams({
    model: "nova-3",
    language: "en",
    diarize: "true",
    smart_format: "true",
    punctuate: "true",
    utterances: "true",
    callback: callbackUrl,
  });
  for (const kw of keywords ?? []) params.append("keywords", kw);

  const resp = await fetch(`${config.deepgramBaseUrl}/listen?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${config.deepgramApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) {
    throw new Error(`deepgram submit failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const requestId = data.request_id ?? data.metadata?.request_id;
  if (!requestId) throw new Error("deepgram submit: no request_id in response");
  return requestId;
}

/** HMAC-SHA256(lectureId) with WEBHOOK_SECRET, hex-encoded, for the
 * `token` query param on the Deepgram callback URL. */
export function hmac(lectureId: string): string {
  return createHmac("sha256", config.webhookSecret).update(lectureId).digest("hex");
}

/** Timing-safe verification of a webhook's `token` against the expected
 * HMAC for lectureId. */
export function verifyHmac(lectureId: string, token: string): boolean {
  const expected = Buffer.from(hmac(lectureId), "hex");
  let actual: Buffer;
  try {
    actual = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
