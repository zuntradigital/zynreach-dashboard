import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { executeDueScheduledPublications } from "@/lib/content/scheduler";
import { getBlockTypeDef } from "@/lib/content/block-types";

interface StoredBlock {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown>;
}

/**
 * A `type: "media"` block prop only ever stores a MediaAsset id (see
 * block-types.ts) — never a URL. System A has no session/credentials to
 * look that up itself, so this resolves every referenced id to its
 * {url, altText} here, once, and hands System A a small lookup map
 * alongside the blocks rather than a second round-trip per image.
 *
 * `origin` turns the locally-stored asset's relative `/uploads/...` path
 * (see src/lib/media/storage.ts) into an absolute URL — System A renders
 * this in its own browser context, on its own origin, so a relative path
 * would resolve against *System A's* origin and 404. Built from the
 * incoming request rather than a hardcoded env var so this keeps working
 * whatever host/port System B is actually reachable on.
 */
async function resolveMediaReferences(blocks: unknown, origin: string): Promise<Record<string, { url: string; altText: string }>> {
  const stored = Array.isArray(blocks) ? (blocks as StoredBlock[]) : [];
  const ids = new Set<string>();
  for (const block of stored) {
    if (typeof block.type !== "string" || !block.props) continue;
    for (const field of getBlockTypeDef(block.type)?.fields ?? []) {
      if (field.type === "media") {
        const value = block.props[field.key];
        if (typeof value === "string" && value) ids.add(value);
      }
    }
  }
  if (ids.size === 0) return {};

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: Array.from(ids) } },
    select: { id: true, url: true, altText: true },
  });
  return Object.fromEntries(
    assets.map((asset) => [asset.id, { url: asset.url.startsWith("http") ? asset.url : `${origin}${asset.url}`, altText: asset.altText }])
  );
}

/**
 * System A's read path for CMS-authored Pages — the System B → System A
 * integration this module exists to prove out. Service-token
 * authenticated (SRS §29: "All System B APIs are authenticated (session
 * or service token)"), reusing the exact same guard and shared secret
 * the leads-ingest endpoint already established, rather than opening a
 * genuinely anonymous endpoint — the content is public once Published,
 * but the API itself still isn't handed out to arbitrary callers.
 *
 * Pages is direct-save (see the admin PATCH handler's docstring): the
 * admin's chosen status is the definitive, immediate live/offline
 * decision, so this reads Page.status/currentVersion directly rather
 * than "last published version" — a page the admin just set to Draft or
 * Archived must disappear now, not keep showing an older Published copy,
 * and an edit to an already-Published page must go live immediately.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  await executeDueScheduledPublications();

  const { slug } = await context.params;
  const page = await prisma.page.findUnique({
    where: { slug },
    include: { currentVersion: true },
  });

  if (!page || page.status !== "PUBLISHED" || !page.currentVersion) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const version = page.currentVersion;

  const media = await resolveMediaReferences(version.componentBlocks, new URL(request.url).origin);

  return NextResponse.json({
    slug: page.slug,
    title: version.title,
    templateType: page.templateType,
    componentBlocks: version.componentBlocks,
    media,
    publishedAt: version.publishedAt,
  });
}
