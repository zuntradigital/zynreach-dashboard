import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, requireFreshSensitiveVerification } from "@/lib/auth/guards";
import { createInvitation } from "@/lib/auth/invitations";
import { sendInvitationEmail } from "@/lib/email/send";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createAdminUserSchema } from "@/lib/validation";

/**
 * SCR-048 (User List, "Primary Role: Super Administrator") — read side of
 * the same resource PUT /api/admin/admin-users/[id]/roles already writes.
 * Same rbac:manage gate, since SCR-048/049/050 all restrict this area to
 * Super Administrator only (SRS §12.1).
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "rbac", "manage");
  if (!auth.ok) return auth.response;

  const users = await prisma.adminUser.findMany({
    orderBy: { createdAt: "asc" },
    include: { roles: { include: { role: true } } },
  });

  return NextResponse.json({
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt,
      roles: user.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
    })),
  });
}

function buildInviteUrl(rawToken: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  return `${base}/en/accept-invite?token=${rawToken}`;
}

/**
 * SRS §23 account creation ("invite → pending → active"), FR-ADM-020,
 * §29 (`POST /api/admin/users` — `Session + Users:Create`). Admin-
 * initiated only: there is no public self-registration path anywhere in
 * the SRS (§7 Actors defines a single human actor — internal staff — and
 * every account in this system is provisioned by a Super Administrator).
 *
 * The Admin supplies only an email and role(s) — no name, no password.
 * The account is created PENDING with both `name` and `passwordHash`
 * null; the invited person chooses both themselves, together, via
 * /api/admin/auth/accept-invite, which is the only thing that ever
 * flips status to ACTIVE. An AdminUserInvitation token is issued and
 * emailed through the configured provider (lib/email/send.ts) — real
 * delivery, not a manual-link fallback; the link is still included in
 * this response too, purely so the Dashboard can show it as a backup if
 * delivery fails for some reason (spam filter, wrong address, provider
 * outage), never as the primary path.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "rbac", "manage");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createAdminUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and at least one role.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { email, roleIds } = parsed.data;

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const uniqueRoleIds = Array.from(new Set(roleIds));
  const validRoles = await prisma.role.findMany({ where: { id: { in: uniqueRoleIds } } });
  if (validRoles.length !== uniqueRoleIds.length) {
    return NextResponse.json({ error: "One or more role IDs do not exist." }, { status: 400 });
  }

  // Creating a user directly into Super Administrator requires fresh
  // re-authentication, same requireFreshSensitiveVerification gate the
  // Role & Permission Matrix Editor already uses — a normal active
  // session is not enough by itself for this highest-privilege action.
  if (validRoles.some((role) => role.name === "Super Administrator")) {
    const reauth = requireFreshSensitiveVerification(auth.context);
    if (!reauth.ok) return reauth.response;
  }

  const user = await prisma.adminUser.create({
    data: {
      email,
      status: "PENDING",
      roles: { create: uniqueRoleIds.map((roleId) => ({ roleId })) },
    },
  });

  const { rawToken, expiresAt } = await createInvitation(user.id);
  const inviteUrl = buildInviteUrl(rawToken);
  const emailResult = await sendInvitationEmail({ to: email, inviteUrl, expiresAt });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "admin_user.invite",
    resourceType: "AdminUser",
    resourceId: user.id,
    after: { email, roleNames: validRoles.map((r) => r.name), emailSent: emailResult.sent },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json(
    {
      status: "success",
      user: { id: user.id, name: user.name, email: user.email, roleNames: validRoles.map((r) => r.name) },
      invitation: { inviteUrl, expiresAt, emailSent: emailResult.sent, emailError: emailResult.reason ?? null },
    },
    { status: 201 }
  );
}
