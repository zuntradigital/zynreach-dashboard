import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { recordAudit } from "@/lib/audit";
import { pushUnsubscribeSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);
  if (isRateLimited(`notifications:push-unsubscribe:${auth.context.tokenIdentity}`, 30)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = pushUnsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const existing = await prisma.pushSubscription.findFirst({ where: { endpoint: parsed.data.endpoint } });
  if (existing) {
    await prisma.pushSubscription.delete({ where: { id: existing.id } });
    await recordAudit({
      action: "notifications.push_unsubscribe",
      resourceType: "PushSubscription",
      resourceId: existing.id,
      result: "SUCCESS",
      ipAddress,
    });
  }

  return NextResponse.json({ status: "success" });
}
