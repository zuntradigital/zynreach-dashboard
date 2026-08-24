import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { readPrivateFile } from "@/lib/media/storage";

/**
 * The only path that ever returns a career-application resume's bytes.
 * Resumes are stored under private-uploads/ (outside public/ — see
 * src/lib/media/storage.ts's savePrivateFile), so there is no public URL
 * for them at all; this route is authenticated the same way the
 * Applications list/detail views already are (careers:view), resolves the
 * storage key only from the JobApplication row this `id` maps to — never
 * from anything the client supplies directly — and readPrivateFile refuses
 * any key that isn't shaped like the ones this app itself generates,
 * closing off path traversal even if a row's stored key were ever
 * corrupted or tampered with.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "careers", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const application = await prisma.jobApplication.findUnique({
    where: { id },
    select: { resumeUrl: true, resumeFilename: true, resumeFileType: true },
  });
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const buffer = await readPrivateFile(application.resumeUrl);
  if (!buffer) {
    return NextResponse.json({ error: "Resume file not found." }, { status: 404 });
  }

  // Strip characters that could break out of the quoted filename in the
  // Content-Disposition header — the filename itself is applicant-supplied
  // (the original upload's file.name), so it's never trusted verbatim here.
  const safeFilename = application.resumeFilename.replace(/[\r\n"]/g, "");

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": application.resumeFileType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
