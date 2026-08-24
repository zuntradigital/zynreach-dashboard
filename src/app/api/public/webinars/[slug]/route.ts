import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";

interface WebinarLocaleText {
  title: string;
  description: string;
  speakerName: string;
  speakerTitle: string;
  speakerCompany: string;
  agenda?: string;
  whatYouWillLearn?: string;
  keyTakeaways?: string;
  seoTitle?: string;
  seoDescription?: string;
}

/**
 * Knowledge Center §9 Public Read: a single Published Webinar's full
 * detail — everything the website's own webinar detail page needs
 * beyond the list-shape `webinars` array src/app/api/public/resources/
 * route.ts already serves (see that file's own comment for why the two
 * are separate: this route is the fuller per-webinar detail page,
 * that one is the Resources library's listing). Same service-token
 * contract as every other public read route.
 *
 * Webinars are direct-save (see the admin PATCH handler's docstring):
 * Webinar.status/currentVersion is the definitive live state, not "last
 * published version" — a webinar the admin just set to Draft or
 * Archived must disappear now, not keep showing an older Published copy.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { slug } = await context.params;
  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  const webinar = await prisma.webinar.findUnique({
    where: { slug },
    include: { currentVersion: { include: { speakerPhoto: true } } },
  });
  if (!webinar || webinar.status !== "PUBLISHED" || !webinar.currentVersion) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const origin = new URL(request.url).origin;
  const version = webinar.currentVersion;
  const text = (version.translations as unknown as Record<"en" | "ar", WebinarLocaleText>)[locale];

  const responseWebinar = {
    slug: webinar.slug,
    gated: webinar.gated,
    featured: webinar.featured,
    scheduledAt: version.scheduledAt ? version.scheduledAt.toISOString() : null,
    durationMinutes: version.durationMinutes,
    isOnDemand: version.isOnDemand,
    videoUrl: version.videoUrl,
    category: version.category,
    speakerPhoto: version.speakerPhoto
      ? {
          url: version.speakerPhoto.url.startsWith("http") ? version.speakerPhoto.url : `${origin}${version.speakerPhoto.url}`,
          altText: version.speakerPhoto.altText,
        }
      : null,
    title: text.title,
    description: text.description,
    speakerName: text.speakerName,
    speakerTitle: text.speakerTitle,
    speakerCompany: text.speakerCompany,
    agenda: text.agenda,
    whatYouWillLearn: text.whatYouWillLearn,
    keyTakeaways: text.keyTakeaways,
    seoTitle: text.seoTitle,
    seoDescription: text.seoDescription,
  };

  return NextResponse.json({ webinar: responseWebinar });
}
