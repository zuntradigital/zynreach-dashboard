import { prisma } from "@/lib/db";
import type { AuditResult, Prisma } from "@prisma/client";

/**
 * SRS §25: every state-changing action generates an immutable AuditLog
 * record with, at minimum, "Actor, Action, Resource, Resource ID,
 * Timestamp, Before, After, Result, and IP/session metadata where
 * applicable to the action's security sensitivity." This is the only
 * function in the codebase that writes an AuditLog row — no update/
 * delete function exists for this model anywhere (§25: "no UI or API
 * path exists to edit or delete an Audit Log record... enforced at the
 * API layer, not just the UI layer").
 *
 * Deliberately isolated from every business module (auth, RBAC, leads)
 * rather than importing this from a "core" module those import —
 * business modules call *into* audit, audit never calls back into them,
 * so future modules (CMS, Pricing, ...) reuse this identical function
 * without any coupling to Phase 1's other pieces.
 */
export interface RecordAuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  result: AuditResult;
  ipAddress?: string | null;
  sessionId?: string | null;
}

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      result: input.result,
      ipAddress: input.ipAddress ?? null,
      sessionId: input.sessionId ?? null,
    },
  });
}
