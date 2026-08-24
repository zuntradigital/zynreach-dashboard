import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { recordAudit } from "@/lib/audit";
import { unsubscribeNotificationsSchema } from "@/lib/validation";

/** Notifications Center — one-click unsubscribe link target (token is the
 * lookup key, not a session credential — see NotificationSubscriber's
 * schema comment for why it's stored in plaintext). */
export async function POST(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);
  if (isRateLimited(`notifications:unsubscribe:${auth.context.tokenIdentity}`, 30)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = unsubscribeNotificationsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const subscriber = await prisma.notificationSubscriber.findUnique({ where: { unsubscribeToken: parsed.data.token } });
  if (!subscriber) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await prisma.notificationSubscriber.delete({ where: { id: subscriber.id } });

  await recordAudit({
    action: "notifications.unsubscribe",
    resourceType: "NotificationSubscriber",
    resourceId: subscriber.id,
    result: "SUCCESS",
    ipAddress,
    after: { email: subscriber.email },
  });

  return NextResponse.json({ status: "success" });
}
