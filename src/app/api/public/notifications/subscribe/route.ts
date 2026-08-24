import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { recordAudit } from "@/lib/audit";
import { generateToken } from "@/lib/auth/tokens";
import { subscribeNotificationsSchema } from "@/lib/validation";

/**
 * Notifications Center — "Notification Preferences" write side. Called
 * by the website's category-subscribe form. Upserts by email: a repeat
 * submission from the same address just replaces its category list
 * rather than creating a duplicate subscriber, so the form doubles as
 * the "manage preferences" entry point too.
 */
export async function POST(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);
  if (isRateLimited(`notifications:subscribe:${auth.context.tokenIdentity}`, 30)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = subscribeNotificationsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid submission.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { email, categories } = parsed.data;

  const existing = await prisma.notificationSubscriber.findUnique({ where: { email } });
  const subscriber = existing
    ? await prisma.notificationSubscriber.update({ where: { email }, data: { categories } })
    : await prisma.notificationSubscriber.create({ data: { email, categories, unsubscribeToken: generateToken() } });

  await recordAudit({
    action: "notifications.subscribe",
    resourceType: "NotificationSubscriber",
    resourceId: subscriber.id,
    result: "SUCCESS",
    ipAddress,
    after: { email, categories },
  });

  return NextResponse.json({ status: "success", unsubscribeToken: subscriber.unsubscribeToken }, { status: existing ? 200 : 201 });
}
