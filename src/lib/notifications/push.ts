import webpush from "web-push";

/**
 * Notifications Center — Web Push sender. Same never-throws /
 * config-reported-not-thrown contract as src/lib/email/send.ts's
 * sendInvitationEmail, for the same reason: a failed push send must never
 * abort the caller's larger operation (a blog publish, an unsubscribe
 * cleanup) — the caller decides whether to log, retry, or drop the
 * subscription.
 */
export interface PushSendResult {
  sent: boolean;
  /** Set when the push service reports the subscription is gone (404/410)
   * — the caller should delete the PushSubscription row. */
  expired?: boolean;
  reason?: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configured = false;
let configChecked = false;

export function isPushConfigured(): boolean {
  if (!configChecked) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (publicKey && privateKey && subject) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      configured = true;
    }
    configChecked = true;
  }
  return configured;
}

export async function sendPushNotification(
  subscription: PushSubscriptionKeys,
  payload: PushNotificationPayload
): Promise<PushSendResult> {
  if (!isPushConfigured()) {
    return { sent: false, reason: "Push provider is not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT missing)." };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload)
    );
    return { sent: true };
  } catch (error) {
    const statusCode = error && typeof error === "object" && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : undefined;
    const reason = error instanceof Error ? error.message : "Unknown push delivery error.";
    if (statusCode === 404 || statusCode === 410) {
      return { sent: false, expired: true, reason };
    }
    console.error("[push:notification] Failed to send:", reason);
    return { sent: false, reason };
  }
}
