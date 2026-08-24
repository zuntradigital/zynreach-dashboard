import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveApiEndpointSchema } from "@/lib/validation";

/** API Reference Endpoint Editor load. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "api", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const endpoint = await prisma.apiEndpoint.findUnique({
    where: { id },
    include: { resourceGroup: { select: { id: true, slug: true, translations: true } } },
  });
  if (!endpoint) return NextResponse.json({ error: "Endpoint not found." }, { status: 404 });

  return NextResponse.json({ endpoint });
}

/**
 * API Reference Endpoint Save — direct-save, matching Resources/DocArticle
 * (see their PATCH handlers' docstrings). No versioning and no
 * Submit -> Approve -> Publish workflow: the admin picks the endpoint's
 * live status on every save and it takes effect immediately, updating the
 * one ApiEndpoint row in place.
 *
 * api:publish gate — same silent-coercion pattern as Blog/DocArticle: an
 * actor who only holds api:edit can still create/edit/save an endpoint,
 * but a PUBLISHED choice from them is silently coerced to DRAFT. An actor
 * who *does* hold api:publish still can't publish unless both locales
 * have a description — a hard 400 naming what's missing.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "api", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const endpoint = await prisma.apiEndpoint.findUnique({ where: { id } });
  if (!endpoint) return NextResponse.json({ error: "Endpoint not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveApiEndpointSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid endpoint values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { status: requestedStatus, resourceGroupId, method, path, authRequired, version, order, translations } = parsed.data;

  if (resourceGroupId) {
    const groupExists = await prisma.apiResourceGroup.findUnique({ where: { id: resourceGroupId }, select: { id: true } });
    if (!groupExists) return NextResponse.json({ error: "Resource group does not exist." }, { status: 400 });
  }
  if (path !== endpoint.path) {
    const clash = await prisma.apiEndpoint.findFirst({ where: { path, method, id: { not: id } }, select: { id: true } });
    if (clash) return NextResponse.json({ error: "An endpoint with this method and path already exists." }, { status: 409 });
  }

  const canPublish = hasPermission(auth.context.effective, "api", "publish");
  const canArchive = hasPermission(auth.context.effective, "api", "archive");

  let status = requestedStatus;
  if (requestedStatus === "PUBLISHED") {
    if (!canPublish) {
      status = "DRAFT";
    } else {
      const missing: ("en" | "ar")[] = [];
      if (!translations.en.description.trim()) missing.push("en");
      if (!translations.ar.description.trim()) missing.push("ar");
      if (missing.length > 0) {
        return NextResponse.json({ error: "Cannot publish — required content is missing.", missing }, { status: 400 });
      }
    }
  } else if (requestedStatus === "ARCHIVED" && !canArchive) {
    status = "DRAFT";
  }

  const updated = await prisma.apiEndpoint.update({
    where: { id },
    data: {
      status,
      resourceGroupId,
      method,
      path,
      authRequired,
      version,
      order,
      translations: translations as unknown as Prisma.InputJsonValue,
    },
    include: { resourceGroup: { select: { id: true, slug: true, translations: true } } },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "api.endpoint.save",
    resourceType: "ApiEndpoint",
    resourceId: endpoint.id,
    before: { status: endpoint.status },
    after: { status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", endpoint: updated });
}

/**
 * Delete — always available (no status/versioning gate, matching
 * Blog/Resources/DocArticle's "Delete" model). Nothing else has an FK
 * depending on an ApiEndpoint's identity, so a real hard delete is always
 * safe here.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "api", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const endpoint = await prisma.apiEndpoint.findUnique({ where: { id } });
  if (!endpoint) return NextResponse.json({ error: "Endpoint not found." }, { status: 404 });

  await prisma.apiEndpoint.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "api.endpoint.delete",
    resourceType: "ApiEndpoint",
    resourceId: id,
    before: { slug: endpoint.slug, status: endpoint.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
