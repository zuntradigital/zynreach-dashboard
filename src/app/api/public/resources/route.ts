import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { executeDueResourcePublications } from "@/lib/content/scheduler";

interface GuideLocaleText {
  title: string;
  description: string;
}

interface WebinarLocaleText {
  title: string;
  description: string;
  speakerName: string;
}

const FORMAT_LABEL: Record<string, "Guide" | "Template" | "Whitepaper" | "Checklist" | "Playbook"> = {
  GUIDE: "Guide",
  TEMPLATE: "Template",
  WHITEPAPER: "Whitepaper",
  CHECKLIST: "Checklist",
  PLAYBOOK: "Playbook",
};

/**
 * SRS §29 Public Read: Published Resource set (Guide/Template/Whitepaper)
 * plus Published Webinar set, returned as System A's separate `guides`/
 * `webinars` arrays (src/types/content.ts's Guide/Webinar shapes) — the two
 * content types live in separate models (see schema.prisma's Webinar/
 * WebinarVersion comment) but the website's consumption shape is unchanged.
 *
 * Both are direct-save (see the admin PATCH handlers' docstrings): the
 * admin's chosen status is the definitive, immediate live/offline decision,
 * so this reads status/currentVersion directly rather than "ever
 * published" — a row the admin just set to Draft or Archived must
 * disappear now, not keep showing an older Published copy, and an edit to
 * an already-Published row must go live immediately.
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  await executeDueResourcePublications();

  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  const [resources, webinarRows] = await Promise.all([
    prisma.resource.findMany({ where: { status: "PUBLISHED" }, include: { currentVersion: true, downloadFile: true } }),
    prisma.webinar.findMany({ where: { status: "PUBLISHED" }, include: { currentVersion: true } }),
  ]);

  const origin = new URL(request.url).origin;
  const guides = resources
    .filter((r) => r.currentVersion)
    .map((r) => {
      const version = r.currentVersion!;
      const text = (version.translations as unknown as Record<"en" | "ar", GuideLocaleText>)[locale];
      return {
        slug: r.slug,
        title: text.title,
        description: text.description,
        format: FORMAT_LABEL[r.resourceFormat],
        gated: r.gated,
        downloadUrl: r.downloadFile ? (r.downloadFile.url.startsWith("http") ? r.downloadFile.url : `${origin}${r.downloadFile.url}`) : undefined,
        category: version.category ?? undefined,
        targetAudience: version.targetAudience ?? undefined,
        difficultyLevel: version.difficultyLevel ?? undefined,
        relatedSlugs: (version.relatedResourceSlugs as unknown as string[] | null) ?? [],
      };
    });

  const webinars = webinarRows
    .filter((w) => w.currentVersion)
    .map((w) => {
      const version = w.currentVersion!;
      const text = (version.translations as unknown as Record<"en" | "ar", WebinarLocaleText>)[locale];
      return {
        slug: w.slug,
        title: text.title,
        description: text.description,
        date: (version.scheduledAt ?? version.publishedAt ?? w.createdAt).toISOString().slice(0, 10),
        speaker: text.speakerName ?? "",
        gated: w.gated,
        featured: w.featured,
        isOnDemand: version.isOnDemand,
        category: version.category ?? undefined,
      };
    });

  return NextResponse.json({ guides, webinars });
}
