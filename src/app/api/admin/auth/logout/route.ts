import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/auth/guards";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { resolveSession, invalidateSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";

export async function POST(request: Request) {
  const rawToken = await getSessionToken();
  if (rawToken) {
    const resolved = await resolveSession(rawToken);
    if (resolved) {
      await invalidateSession(resolved.session.id);
      await recordAudit({
        actorId: resolved.adminUser.id,
        actorEmail: resolved.adminUser.email,
        action: "auth.logout",
        result: "SUCCESS",
        ipAddress: getClientIp(request),
        sessionId: resolved.session.id,
      });
    }
  }
  await clearSessionCookie();
  return NextResponse.json({ status: "success" });
}
