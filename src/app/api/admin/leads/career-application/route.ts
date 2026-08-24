import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp, hashIp } from "@/lib/request-meta";
import { careerApplicationFieldsSchema } from "@/lib/validation";
import { savePrivateFile } from "@/lib/media/storage";

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ACCEPTED_RESUME_TYPES = [".pdf", ".doc", ".docx"];

/**
 * SRS §20.1/§20.2 Career Application ingest — a sibling of
 * /api/admin/leads/ingest specifically for this one form, because it's the
 * only one of the nine standard forms that arrives as multipart/form-data
 * (a resume file) rather than JSON. Produces the same Submission+Lead pair
 * the generic ingest route creates (`formId: "career-application"`, so the
 * existing Leads Inbox keeps working unchanged) *and* a proper
 * JobApplication row with a real `jobListingId` foreign key — the
 * Dashboard's Careers → Applications screen reads from that relation, not
 * from the Lead's arbitrary `campaign` string. `jobId` here is System A's
 * public job identifier, which is actually the JobListing's `slug` (see
 * src/app/api/public/careers/route.ts's `id: l.slug`) — resolved to the
 * real JobListing.id below. If the slug doesn't resolve (job renamed,
 * deleted, or a stale/tampered client), the application still saves with
 * jobListingId: null rather than being dropped — never lose a real
 * candidate submission over a lookup miss.
 *
 * Resume storage uses the private-file half of src/lib/media/storage.ts
 * (savePrivateFile), not the Media Library's public saveMediaFile — resumes
 * are PII and are never written under public/uploads. The stored
 * `resumeUrl` field (despite its name, kept for backward compatibility
 * with existing rows/JSON payloads) holds only the opaque private
 * storageKey, not a fetchable path; the sole way to retrieve the bytes is
 * the authenticated GET /api/admin/careers/applications/[id]/resume route,
 * which resolves that key from this row itself, not from client input.
 */
export async function POST(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  if (isRateLimited(`leads:career-application:${auth.context.tokenIdentity}`, 60)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const fieldsResult = careerApplicationFieldsSchema.safeParse({
    jobId: formData.get("jobId"),
    jobTitle: formData.get("jobTitle"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    portfolioUrl: formData.get("portfolioUrl") || undefined,
    gender: formData.get("gender") || undefined,
    veteranStatus: formData.get("veteranStatus") || undefined,
  });
  if (!fieldsResult.success) {
    await recordAudit({ action: "leads.career_application_ingest", result: "ERROR", ipAddress, after: { reason: "validation_failed" } });
    return NextResponse.json({ error: "Invalid submission payload.", issues: fieldsResult.error.flatten() }, { status: 400 });
  }

  const resume = formData.get("resume");
  if (!(resume instanceof File) || resume.size === 0) {
    return NextResponse.json({ error: "Attach a resume." }, { status: 400 });
  }
  if (resume.size > MAX_RESUME_BYTES) {
    return NextResponse.json({ error: "Resume must be smaller than 5MB." }, { status: 400 });
  }
  if (!ACCEPTED_RESUME_TYPES.some((ext) => resume.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json({ error: "Resume must be a PDF, DOC, or DOCX file." }, { status: 400 });
  }

  const stored = await savePrivateFile(resume);

  const { jobId, jobTitle, fullName, email, portfolioUrl, gender, veteranStatus } = fieldsResult.data;
  const ipHash = ipAddress ? hashIp(ipAddress) : null;

  const matchedListing = await prisma.jobListing.findUnique({ where: { slug: jobId }, select: { id: true } });

  const [submission, application] = await prisma.$transaction([
    prisma.submission.create({
      data: {
        formId: "career-application",
        payload: {
          jobId,
          jobTitle,
          fullName,
          email,
          portfolioUrl: portfolioUrl ?? null,
          gender: gender ?? null,
          veteranStatus: veteranStatus ?? null,
          resumeUrl: stored.storageKey,
          resumeFilename: resume.name,
          resumeFileType: resume.type,
          resumeFileSize: resume.size,
        } as Prisma.InputJsonValue,
        ipHash,
      },
    }),
    prisma.jobApplication.create({
      data: {
        jobListingId: matchedListing?.id ?? null,
        jobTitleSnapshot: jobTitle,
        fullName,
        email,
        portfolioUrl: portfolioUrl ?? null,
        gender: gender ?? null,
        veteranStatus: veteranStatus ?? null,
        resumeUrl: stored.storageKey,
        resumeFilename: resume.name,
        resumeFileType: resume.type,
        resumeFileSize: resume.size,
        ipHash,
      },
    }),
  ]);

  const lead = await prisma.lead.create({
    data: { submissionId: submission.id, status: "NEW", source: "careers", campaign: jobId },
  });

  await recordAudit({
    action: "leads.career_application_ingest",
    resourceType: "Lead",
    resourceId: lead.id,
    result: "SUCCESS",
    ipAddress,
    after: { leadId: lead.id, submissionId: submission.id, applicationId: application.id, jobId, jobListingId: matchedListing?.id ?? null },
  });

  return NextResponse.json({ status: "success", leadId: lead.id, applicationId: application.id }, { status: 201 });
}
