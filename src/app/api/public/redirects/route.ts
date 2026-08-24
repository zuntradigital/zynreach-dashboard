import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";

/**
 * CMS General "Redirects", public read side. Same service-token contract
 * as /api/public/settings — the website's proxy.ts fetches this on a
 * cached, fail-open basis (identical pattern to its existing Maintenance
 * Mode check) and issues the redirect itself before falling through to
 * the static rules in next.config.ts.
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const redirects = await prisma.redirect.findMany({
    select: { from: true, to: true, permanent: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ redirects });
}
