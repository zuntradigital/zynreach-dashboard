import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveFaqItemSchema } from "@/lib/validation";

/** FAQ Editor load. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "faq", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const item = await prisma.faqItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "FAQ not found." }, { status: 404 });

  return NextResponse.json({ item });
}

/**
 * FAQ Save — direct-save, matching DocArticle: no versioning and no
 * Submit -> Approve -> Publish workflow. The admin picks the item's live
 * status on every save and it takes effect immediately.
 *
 * faq:publish gate — same silent-coercion pattern as Docs' own PATCH
 * handler: an actor who only holds faq:edit can still edit/save an item,
 * but a PUBLISHED choice from them is silently coerced to DRAFT rather
 * than rejected, so their other edits aren't lost. Both locales already
 * require question+answer at the schema level (unlike Docs' title, which
 * is optional until publish) since a FAQ item has no meaningful "started
 * but empty" draft state — it's two short text fields, not a rich body
 * built up over multiple autosaves.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "faq", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const item = await prisma.faqItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "FAQ not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveFaqItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid FAQ values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { status: requestedStatus, category, order, translations } = parsed.data;

  const canPublish = hasPermission(auth.context.effective, "faq", "publish");
  const canArchive = hasPermission(auth.context.effective, "faq", "archive");

  let status = requestedStatus;
  if (requestedStatus === "PUBLISHED" && !canPublish) {
    status = "DRAFT";
  } else if (requestedStatus === "ARCHIVED" && !canArchive) {
    status = "DRAFT";
  }

  const updated = await prisma.faqItem.update({
    where: { id },
    data: {
      status,
      category,
      order,
      translations: translations as unknown as Prisma.InputJsonValue,
    },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "faq.save",
    resourceType: "FaqItem",
    resourceId: item.id,
    before: { status: item.status, category: item.category },
    after: { status, category },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", item: updated });
}

/** Delete — always available (no status/versioning gate, matching DocArticle/Redirects). */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "faq", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const item = await prisma.faqItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "FAQ not found." }, { status: 404 });

  await prisma.faqItem.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "faq.delete",
    resourceType: "FaqItem",
    resourceId: id,
    before: { category: item.category, status: item.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
