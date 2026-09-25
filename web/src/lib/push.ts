// Pure-ish helper: converts a base64url VAPID key to a Uint8Array for PushManager.subscribe.
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(): Promise<PushSubscriptionJSON | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return null;
  const reg = await navigator.serviceWorker.register("/sw.js");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
  });
  return sub.toJSON();
}
