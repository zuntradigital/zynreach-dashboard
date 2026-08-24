import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp, hashIp } from "@/lib/request-meta";
import { leadIngestSchema } from "@/lib/validation";

/**
 * Phase 1's leads-ingestion vertical slice (SRS §20.2, FR-WEB-009).
 *
 * Called server-to-server by zynreach-website's existing form-handler
 * services (lead-router.ts, trial-provisioning.ts,
 * career-application.ts) once those are updated to call this instead of
 * console.info — that website-side change is documented as future
 * integration work, not part of Phase 1 itself (Phase 1 only builds the
 * receiving endpoint).
 *
 * Service-token authenticated, not session authenticated — this is a
 * system actor calling in, not an interactively logged-in AdminUser
 * (SRS §29: "authenticated (session or service token)").
 */
export async function POST(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  if (isRateLimited(`leads:ingest:${auth.context.tokenIdentity}`, 60)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = leadIngestSchema.safeParse(body);
  if (!parsed.success) {
    await recordAudit({
      action: "leads.ingest",
      result: "ERROR",
      ipAddress,
      after: { reason: "validation_failed" },
    });
    return NextResponse.json({ error: "Invalid submission payload.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { formId, payload, utm, source, campaign, visitorIp } = parsed.data;

  const submission = await prisma.submission.create({
    data: {
      formId,
      // The Zod record validates the incoming JSON as Record<string, unknown>;
      // it has already round-tripped through request.json(), so it is
      // necessarily JSON-serializable. Prisma's InputJsonValue type just
      // doesn't structurally accept an `unknown`-valued record.
      payload: payload as Prisma.InputJsonValue,
      utm: utm as Prisma.InputJsonValue | undefined,
      ipHash: visitorIp ? hashIp(visitorIp) : null,
    },
  });

  const lead = await prisma.lead.create({
    data: {
      submissionId: submission.id,
      status: "NEW",
      source,
      campaign,
    },
  });

  await recordAudit({
    action: "leads.ingest",
    resourceType: "Lead",
    resourceId: lead.id,
    result: "SUCCESS",
    ipAddress,
    after: { formId, leadId: lead.id, submissionId: submission.id },
  });

  return NextResponse.json({ status: "success", leadId: lead.id }, { status: 201 });
}
