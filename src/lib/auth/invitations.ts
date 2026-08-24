import { prisma } from "@/lib/db";
import { generateToken, hashToken } from "./tokens";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreatedInvitation {
  rawToken: string;
  invitationId: string;
  expiresAt: Date;
}

/**
 * Issues a fresh invitation for an AdminUser created as PENDING. The raw
 * token is returned once — callers use it to build the emailed link and
 * must never persist it themselves; only its hash lives in the DB.
 *
 * The account lifecycle this token drives has four distinguishable,
 * persisted states, not two:
 *   1. Invited / Pending      — AdminUser.status === "PENDING", acceptedAt null
 *   2. Invitation Accepted    — acceptedAt set, AdminUser still PENDING
 *      (the user clicked "Accept Invitation" but hasn't set a password yet)
 *   3. Password Setup Completed / Active — AdminUser.status flips to
 *      "ACTIVE" the instant a password is set; there is no separate
 *      column for this because AdminUser.status *is* that record.
 * Step 2 and step 3 are deliberately two separate requests/DB writes,
 * not one atomic action — see acceptInvitation() vs
 * resolveInvitationForCompletion() below.
 */
export async function createInvitation(adminUserId: string): Promise<CreatedInvitation> {
  const rawToken = generateToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const invitation = await prisma.adminUserInvitation.create({
    data: { tokenHash: hashToken(rawToken), adminUserId, expiresAt },
  });
  return { rawToken, invitationId: invitation.id, expiresAt };
}

/** Deletes every invitation row for a user (accepted-but-incomplete or
 * untouched) — used before issuing a resend, so an old emailed link
 * stops working the moment a newer one is sent, regardless of how far
 * the old one had gotten, matching how every real invite system behaves. */
export async function invalidateInvitationsForUser(adminUserId: string): Promise<void> {
  await prisma.adminUserInvitation.deleteMany({ where: { adminUserId } });
}

export interface InvitationPreview {
  adminUserId: string;
  /// Null until the invited person completes first-time setup — the
  /// Admin never supplies a name at invite time (see AdminUser.name in
  /// schema.prisma).
  name: string | null;
  email: string;
  alreadyAccepted: boolean;
}

/**
 * Non-consuming lookup for the accept-invite page's initial load (a plain
 * GET). Deliberately does NOT delete or mark the row on read — a page
 * view (including a mail client's link-preview crawler) must not
 * advance the invitation's state before the invited person has actually
 * clicked "Accept."  `alreadyAccepted` lets the page skip straight to
 * the password form on a reload after accepting but before finishing.
 */
export async function previewInvitation(rawToken: string): Promise<InvitationPreview | null> {
  const invitation = await prisma.adminUserInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { adminUser: { select: { id: true, name: true, email: true, status: true } } },
  });
  if (!invitation) return null;
  if (Date.now() > invitation.expiresAt.getTime()) return null;
  if (invitation.adminUser.status !== "PENDING") return null;

  return {
    adminUserId: invitation.adminUser.id,
    name: invitation.adminUser.name,
    email: invitation.adminUser.email,
    alreadyAccepted: invitation.acceptedAt !== null,
  };
}

export interface ResolvedInvitation {
  invitationId: string;
  adminUserId: string;
}

/**
 * Step 2: records that the invited person explicitly clicked "Accept
 * Invitation" — persisted as AdminUserInvitation.acceptedAt, independent
 * of and prior to setting a password. Rejects an already-accepted token
 * (accepting twice isn't itself dangerous, but it's not idempotent by
 * design — resolveInvitationForCompletion below is what actually gates
 * re-use).
 */
export async function acceptInvitation(rawToken: string): Promise<ResolvedInvitation | null> {
  const invitation = await prisma.adminUserInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { adminUser: { select: { status: true } } },
  });
  if (!invitation) return null;
  if (invitation.acceptedAt) return null;
  if (Date.now() > invitation.expiresAt.getTime()) return null;
  if (invitation.adminUser.status !== "PENDING") return null;

  await prisma.adminUserInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  return { invitationId: invitation.id, adminUserId: invitation.adminUserId };
}

/**
 * Step 3: validates a token for the final "create your password" step,
 * without mutating anything — the caller sets AdminUser.passwordHash and
 * flips status to ACTIVE itself, which is what actually marks the
 * invitation as fully consumed (a PENDING-only precondition here means a
 * completed invitation can never be replayed). Requires the invitation
 * to have already gone through acceptInvitation() — a password can't be
 * set for a token nobody has explicitly accepted yet.
 */
export async function resolveInvitationForCompletion(rawToken: string): Promise<ResolvedInvitation | null> {
  const invitation = await prisma.adminUserInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { adminUser: { select: { status: true } } },
  });
  if (!invitation) return null;
  if (!invitation.acceptedAt) return null;
  if (Date.now() > invitation.expiresAt.getTime()) return null;
  if (invitation.adminUser.status !== "PENDING") return null;

  return { invitationId: invitation.id, adminUserId: invitation.adminUserId };
}
