import { NextResponse } from "next/server";
import { acceptInvitation } from "@/lib/auth/invitations";
import { recordAudit } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { confirmInvitationSchema } from "@/lib/validation";

/**
 * Step 2 of the invitation lifecycle: "Invitation Accepted," recorded
 * independently of and prior to password creation (see
 * lib/auth/invitations.ts's doc comment on the full four-state model).
 * Unauthenticated by nature — nobody has a session yet at this point.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = confirmInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing invitation token." }, { status: 400 });
  }
  const { token } = parsed.data;

  if (isRateLimited(`auth:accept-invite-confirm:${token}`, 10)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const ipAddress = getClientIp(request);

  const resolved = await acceptInvitation(token);
  if (!resolved) {
    return NextResponse.json({ error: "This invitation link is invalid or has expired." }, { status: 400 });
  }

  await recordAudit({
    actorId: resolved.adminUserId,
    action: "admin_user.invitation_accepted",
    resourceType: "AdminUser",
    resourceId: resolved.adminUserId,
    result: "SUCCESS",
    ipAddress,
  });

  return NextResponse.json({ status: "accepted" });
}
