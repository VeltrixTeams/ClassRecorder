"""Web Push notifications (pywebpush + VAPID), sent to the browser
subscription stored on profiles.push_subscription (jsonb: the standard
PushSubscription JSON: {endpoint, keys:{p256dh,auth}}).
"""

import json
import logging

from pywebpush import WebPushException, webpush

from app.config import settings

logger = logging.getLogger("notify")


async def send_push(push_subscription: dict | str | None, title: str, body: str, data: dict | None = None) -> bool:
    """Returns False (and the caller should drop the stored subscription) if
    the push service reports the subscription is gone (404/410)."""
    if not push_subscription:
        return True
    if isinstance(push_subscription, str):
        push_subscription = json.loads(push_subscription)

    payload = json.dumps({"title": title, "body": body, "data": data or {}})
    try:
        webpush(
            subscription_info=push_subscription,
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
        )
        return True
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            return False
        logger.warning("push failed: %s", e)
        return True
