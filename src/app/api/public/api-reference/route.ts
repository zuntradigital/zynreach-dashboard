import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";

interface ApiResourceGroupLocaleText {
  name: string;
  description: string;
}

interface ApiEndpointLocaleText {
  description: string;
  pathParameters: string;
  queryParameters: string;
  requestHeaders: string;
  requestBodySchema: string;
  responseSchema: string;
  statusCodes: string;
  errorResponses: string;
  requestExample: string;
  responseExample: string;
}

/**
 * Knowledge Center §13.3/§13.4 Public Read: Published ApiResourceGroup +
 * ApiEndpoint set, grouped for the API Reference nav. Direct-save (see the
 * admin PATCH handler's docstring): ApiEndpoint.status is the definitive,
 * immediate live/offline decision, so this reads status directly rather
 * than "ever published."
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  const [groups, endpoints] = await Promise.all([
    prisma.apiResourceGroup.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    prisma.apiEndpoint.findMany({ where: { status: "PUBLISHED" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
  ]);

  function endpointsFor(resourceGroupId: string | null) {
    return endpoints
      .filter((e) => e.resourceGroupId === resourceGroupId)
      .map((endpoint) => {
        const text = (endpoint.translations as unknown as Record<"en" | "ar", ApiEndpointLocaleText>)[locale];
        return {
          slug: endpoint.slug,
          method: endpoint.method,
          path: endpoint.path,
          authRequired: endpoint.authRequired,
          version: endpoint.version,
          order: endpoint.order,
          description: text.description,
        };
      });
  }

  const responseGroups = groups.map((group) => {
    const text = (group.translations as unknown as Record<"en" | "ar", ApiResourceGroupLocaleText>)[locale];
    return {
      slug: group.slug,
      name: text.name,
      description: text.description,
      order: group.order,
      endpoints: endpointsFor(group.id),
    };
  });

  return NextResponse.json({ groups: responseGroups, uncategorized: endpointsFor(null) });
}
