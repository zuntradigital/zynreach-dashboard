import { prisma } from "@/lib/db";
import { sendNotificationEmail } from "@/lib/email/send";
import { sendPushNotification } from "./push";

/**
 * Notifications Center — "Event-based Notifications" fan-out. Called
 * (fire-and-forget, .catch(() => {})) from the Blog/Webinar publish
 * action routes right after their existing recordAudit() call. Reads
 * every NotificationSubscriber / PushSubscription row whose `categories`
 * (a JSON string[]) includes this event's category, and sends each
 * channel. Filtering happens in application code rather than a MySQL
 * JSON_CONTAINS query — this table is small (subscriber counts, not
 * content rows) and it keeps the category list's shape a plain TS type
 * instead of a query-specific JSON path.
 */
export type NotificationCategory = "BLOG" | "WEBINARS";

export interface NotificationEvent {
  category: NotificationCategory;
  title: string;
  /** Absolute URL on the website, e.g. https://www.zynreach.com/en/blog/my-post */
  url: string;
}

function buildUnsubscribeUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://www.zynreach.com";
  return `${base}/en/notifications/unsubscribe?token=${token}`;
}

export async function notifySubscribers(event: NotificationEvent): Promise<void> {
  const [emailSubscribers, pushSubscriptions] = await Promise.all([
    prisma.notificationSubscriber.findMany({ select: { email: true, categories: true, unsubscribeToken: true } }),
    prisma.pushSubscription.findMany({ select: { id: true, endpoint: true, p256dh: true, auth: true, categories: true } }),
  ]);

  const emailTargets = emailSubscribers.filter((s) => Array.isArray(s.categories) && (s.categories as unknown[]).includes(event.category));
  const pushTargets = pushSubscriptions.filter((s) => Array.isArray(s.categories) && (s.categories as unknown[]).includes(event.category));

  await Promise.all(
    emailTargets.map((subscriber) =>
      sendNotificationEmail({
        to: subscriber.email,
        title: event.title,
        url: event.url,
        unsubscribeUrl: buildUnsubscribeUrl(subscriber.unsubscribeToken),
      }).catch(() => undefined)
    )
  );

  const expiredIds: string[] = [];
  await Promise.all(
    pushTargets.map(async (subscription) => {
      const result = await sendPushNotification(
        { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
        { title: event.title, body: event.title, url: event.url }
      ).catch(() => undefined);
      if (result?.expired) expiredIds.push(subscription.id);
    })
  );

  if (expiredIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expiredIds } } }).catch(() => undefined);
  }
}
