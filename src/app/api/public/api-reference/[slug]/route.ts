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
 * Knowledge Center §13.3/§13.4 Public Read: a single Published ApiEndpoint
 * with its full field set (parameters/schemas/examples), plus its resolved
 * resource group. Same service-token contract and direct-save status
 * semantics as the list route.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { slug } = await context.params;
  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  const endpoint = await prisma.apiEndpoint.findUnique({ where: { slug }, include: { resourceGroup: true } });
  if (!endpoint || endpoint.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const text = (endpoint.translations as unknown as Record<"en" | "ar", ApiEndpointLocaleText>)[locale];
  const resourceGroup = endpoint.resourceGroup
    ? (() => {
        const groupText = (endpoint.resourceGroup!.translations as unknown as Record<"en" | "ar", ApiResourceGroupLocaleText>)[locale];
        return { slug: endpoint.resourceGroup!.slug, name: groupText.name, description: groupText.description };
      })()
    : null;

  return NextResponse.json({
    endpoint: {
      slug: endpoint.slug,
      method: endpoint.method,
      path: endpoint.path,
      authRequired: endpoint.authRequired,
      version: endpoint.version,
      order: endpoint.order,
      resourceGroup,
      description: text.description,
      pathParameters: text.pathParameters,
      queryParameters: text.queryParameters,
      requestHeaders: text.requestHeaders,
      requestBodySchema: text.requestBodySchema,
      responseSchema: text.responseSchema,
      statusCodes: text.statusCodes,
      errorResponses: text.errorResponses,
      requestExample: text.requestExample,
      responseExample: text.responseExample,
    },
  });
}
