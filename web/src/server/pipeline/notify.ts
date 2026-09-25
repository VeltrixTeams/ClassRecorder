import "server-only";
import webpush from "web-push";
import { config } from "../config";
import { sql } from "../db";

/** Web Push (web-push npm + VAPID) to the subscription stored on
 * profiles.push_subscription (jsonb: standard PushSubscription JSON).
 * Port of backend/app/pipeline/notify.py. */

export interface PushSubscriptionLike {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one push message. Returns false if the push service reports the
 * subscription is gone (404/410) — caller should drop the stored
 * subscription in that case. */
export async function sendPush(
  subscription: PushSubscriptionLike | null | undefined,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<boolean> {
  if (!subscription) return true;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  try {
    await webpush.sendNotification(
      subscription as webpush.PushSubscription,
      JSON.stringify({ title, body, data }),
    );
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return false;
    console.warn("push failed", e);
    return true;
  }
}

/** Loads the user's push subscription and sends; drops the stored
 * subscription if the push service reports it's gone. */
export async function notifyUser(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const db = sql();
  const rows = await db<{ push_subscription: PushSubscriptionLike | null }[]>`
    select push_subscription from profiles where user_id=${userId}
  `;
  const sub = rows[0]?.push_subscription;
  if (!sub) return;
  const ok = await sendPush(sub, title, body, data);
  if (!ok) {
    await db`update profiles set push_subscription=null where user_id=${userId}`;
  }
}
