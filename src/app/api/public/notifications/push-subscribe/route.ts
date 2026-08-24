import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { recordAudit } from "@/lib/audit";
import { pushSubscribeSchema } from "@/lib/validation";

/**
 * Notifications Center — Web Push registration. `endpoint` isn't a
 * database-unique column (MySQL text-index length limit — see the
 * PushSubscription schema comment), so dedup happens here: look the row
 * up by endpoint first, update its keys/categories if found, otherwise
 * create it.
 */
export async function POST(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);
  if (isRateLimited(`notifications:push-subscribe:${auth.context.tokenIdentity}`, 30)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = pushSubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid submission.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { endpoint, keys, categories } = parsed.data;

  const existing = await prisma.pushSubscription.findFirst({ where: { endpoint } });
  const subscription = existing
    ? await prisma.pushSubscription.update({ where: { id: existing.id }, data: { p256dh: keys.p256dh, auth: keys.auth, categories } })
    : await prisma.pushSubscription.create({ data: { endpoint, p256dh: keys.p256dh, auth: keys.auth, categories } });

  await recordAudit({
    action: "notifications.push_subscribe",
    resourceType: "PushSubscription",
    resourceId: subscription.id,
    result: "SUCCESS",
    ipAddress,
    after: { categories },
  });

  return NextResponse.json({ status: "success" }, { status: existing ? 200 : 201 });
}
