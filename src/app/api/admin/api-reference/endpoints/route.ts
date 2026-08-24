import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createApiEndpointSchema, apiEndpointsQuerySchema } from "@/lib/validation";

const EMPTY_LOCALE_TEXT = {
  description: "",
  pathParameters: "",
  queryParameters: "",
  requestHeaders: "",
  requestBodySchema: "",
  responseSchema: "",
  statusCodes: "",
  errorResponses: "",
  requestExample: "",
  responseExample: "",
};

/** Knowledge Center §13.3/§13.4 API Reference endpoint list. api:view permission. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "api", "view");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const parsed = apiEndpointsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { resourceGroupId, status, method, page, take } = parsed.data;

  const where: Prisma.ApiEndpointWhereInput = {
    ...(resourceGroupId ? { resourceGroupId } : {}),
    ...(status ? { status } : {}),
    ...(method ? { method } : {}),
  };

  const [endpoints, total] = await Promise.all([
    prisma.apiEndpoint.findMany({
      where,
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * take,
      take,
      include: { resourceGroup: { select: { slug: true, translations: true } } },
    }),
    prisma.apiEndpoint.count({ where }),
  ]);

  return NextResponse.json({ endpoints, total, page, take });
}

/**
 * "New Endpoint" — creates the ApiEndpoint directly, no version snapshot
 * (§13.2: explicitly not treated as a Blog/Documentation article) —
 * everything lives on the one row.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "api", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createApiEndpointSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid endpoint values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, resourceGroupId, method, path } = parsed.data;

  const existing = await prisma.apiEndpoint.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  if (resourceGroupId) {
    const groupExists = await prisma.apiResourceGroup.findUnique({ where: { id: resourceGroupId }, select: { id: true } });
    if (!groupExists) return NextResponse.json({ error: "Resource group does not exist." }, { status: 400 });
  }

  const endpoint = await prisma.apiEndpoint.create({
    data: {
      slug,
      resourceGroupId,
      method,
      path,
      status: "DRAFT",
      translations: { en: EMPTY_LOCALE_TEXT, ar: EMPTY_LOCALE_TEXT } as unknown as Prisma.InputJsonValue,
      createdByUserId: auth.context.adminUser.id,
    },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "api.endpoint.create",
    resourceType: "ApiEndpoint",
    resourceId: endpoint.id,
    after: { slug, resourceGroupId, method, path },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", endpoint }, { status: 201 });
}
