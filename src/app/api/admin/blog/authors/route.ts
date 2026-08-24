import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveAuthorSchema } from "@/lib/validation";

/**
 * SRS §28.1 Author — shared taxonomy (byline identity), not itself
 * workflow-governed, same reasoning as PricingFeature: plain CRUD gated by
 * the owning module's view/edit permissions.
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "blog", "view");
  if (!auth.ok) return auth.response;

  const authors = await prisma.author.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ authors });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "blog", "edit");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveAuthorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid author values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const author = await prisma.author.create({
    data: { translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.author.create",
    resourceType: "Author",
    resourceId: author.id,
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", author }, { status: 201 });
}
