import type { ContentStatus, PageClassification } from "@prisma/client";

/**
 * SRS §13.1 / §33.1's standard content workflow, encoded as pure
 * transition guards — no DB access here, just "given the current state
 * and who's acting, is this transition legal." Route handlers
 * (src/app/api/admin/pages/**) fetch the Page, call the relevant guard,
 * and only then touch Prisma, matching the existing separation between
 * lib/auth/guards.ts (permission checks) and route bodies (data access).
 *
 * `{ Changes Requested → Draft | Approved }` in the SRS's own diagram is
 * two different kinds of node: Approved is a resting state; Changes
 * Requested is drawn as an immediate arrow back to Draft, not something
 * that sits still. Here CHANGES_REQUESTED *is* kept as a real resting
 * status (not collapsed into DRAFT) so the Pages list can distinguish
 * "never submitted" from "sent back with feedback" — but it behaves
 * exactly like DRAFT for editing/resubmission purposes (see
 * `canSubmitForReview`), which reconciles the two readings without an
 * extra "acknowledge feedback" action the SRS never defines a screen for.
 *
 * A single Workflow DB entity (SRS §28.1) isn't built yet — see the
 * Approval model's schema comment for why that's deferred, not omitted.
 */

export interface WorkflowGuardResult {
  ok: boolean;
  error?: string;
}

const ok: WorkflowGuardResult = { ok: true };
function fail(error: string): WorkflowGuardResult {
  return { ok: false, error };
}

/** SRS §13.1: "Locked from further Author edits until Reviewer acts." */
export function canEditDraft(status: ContentStatus): WorkflowGuardResult {
  if (status === "DRAFT" || status === "CHANGES_REQUESTED") return ok;
  return fail("This item is locked while it's submitted, in review, approved, scheduled, or published.");
}

/** SRS SCR-003 validation: "at least one Component Block required before Submit for Review." */
export function canSubmitForReview(status: ContentStatus, blockCount: number): WorkflowGuardResult {
  if (status !== "DRAFT" && status !== "CHANGES_REQUESTED") {
    return fail("Only a Draft or an item returned for changes can be submitted for review.");
  }
  if (blockCount < 1) {
    return fail("Add at least one content block before submitting for review.");
  }
  return ok;
}

/**
 * SRS §28.2 Approval note: "Distinct actor from submitter enforced at the
 * API layer" — applied to every classification, not only Pricing/Legal/
 * Security (that stricter carve-out in §23 is a floor, not a ceiling;
 * this field-level note on Approval itself is unscoped).
 */
export function canDecideReview(
  status: ContentStatus,
  submittedByUserId: string | null,
  actorId: string
): WorkflowGuardResult {
  if (status !== "SUBMITTED" && status !== "IN_REVIEW") {
    return fail("This item is not awaiting review.");
  }
  if (submittedByUserId && submittedByUserId === actorId) {
    return fail("You cannot review an item you submitted yourself.");
  }
  return ok;
}

/**
 * SRS §13.3: LEGAL/SECURITY classified content requires the mandatory
 * Legal & Compliance Reviewer gate (content:reviewLegal) specifically —
 * an ordinary Reviewer's content:approve/content:requestChanges
 * permission does not satisfy it, for either decision. For STANDARD/
 * PRICING pages, Approve and Request Changes are independently
 * grantable actions (content:approve, content:requestChanges) — neither
 * implies the other.
 */
export function requiredReviewPermissionAction(
  classification: PageClassification,
  decisionAction: "approve" | "requestChanges"
): "approve" | "requestChanges" | "reviewLegal" {
  return classification === "LEGAL" || classification === "SECURITY" ? "reviewLegal" : decisionAction;
}

export function canSchedule(status: ContentStatus, scheduledFor: Date): WorkflowGuardResult {
  if (status !== "APPROVED") return fail("Only an Approved item can be scheduled.");
  if (scheduledFor.getTime() <= Date.now()) return fail("Scheduled time must be in the future.");
  return ok;
}

export function canPublishNow(status: ContentStatus): WorkflowGuardResult {
  if (status !== "APPROVED" && status !== "SCHEDULED") {
    return fail("Only an Approved or Scheduled item can be published.");
  }
  return ok;
}

export function canArchive(status: ContentStatus): WorkflowGuardResult {
  if (status !== "PUBLISHED") return fail("Only a Published item can be archived.");
  return ok;
}

/** SRS §13.1: "Archived... distinct from Deleted, which is disabled for
 * any content that has ever been Published." */
export function canDelete(status: ContentStatus, everPublished: boolean): WorkflowGuardResult {
  if (everPublished) return fail("An item that has ever been Published can only be Archived, not deleted.");
  if (status === "PUBLISHED" || status === "SCHEDULED") return fail("Unschedule or unpublish before deleting.");
  return ok;
}

/** SRS §13.5 Rollback: available on any content item with ≥1 prior
 * Published version; "still requires Approval before it goes live" —
 * this guard only creates the new Draft, it never skips the workflow. */
export function canRollback(hasPublishedVersion: boolean): WorkflowGuardResult {
  if (!hasPublishedVersion) return fail("This item has no published version to roll back to.");
  return ok;
}
