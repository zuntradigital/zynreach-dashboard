import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";

interface LocaleText {
  challenge: string;
  solution: string;
  results: string;
  metrics: { label: string; value: string }[];
  testimonialQuote: string;
  seoTitle?: string;
  seoDescription?: string;
}

/**
 * Knowledge Center §7 Public Read: a single Published CustomerStory, plus
 * resolved related-capability slugs for linking back to Platform pages.
 * Same service-token contract as the list route.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { slug } = await context.params;
  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  const story = await prisma.customerStory.findUnique({
    where: { slug },
    include: {
      customerLogo: true,
      currentVersion: { include: { testimonialPhoto: true } },
    },
  });
  if (!story || story.status !== "PUBLISHED" || !story.currentVersion) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const origin = new URL(request.url).origin;
  const resolveUrl = (url: string) => (url.startsWith("http") ? url : `${origin}${url}`);

  const version = story.currentVersion;
  const text = (version.translations as unknown as Record<"en" | "ar", LocaleText>)[locale];
  const relatedCapabilitySlugs = version.relatedCapabilitySlugs as string[];

  const responseStory = {
    slug: story.slug,
    customerName: story.customerName,
    customerLogo: story.customerLogo ? { url: resolveUrl(story.customerLogo.url), altText: story.customerLogo.altText } : null,
    industry: story.industry,
    companySize: story.companySize,
    country: story.country,
    featured: story.featured,
    challenge: text.challenge,
    solution: text.solution,
    results: text.results,
    metrics: text.metrics,
    testimonialQuote: text.testimonialQuote,
    testimonialName: version.testimonialName,
    testimonialTitle: version.testimonialTitle,
    testimonialCompany: version.testimonialCompany,
    testimonialPhoto: version.testimonialPhoto ? { url: resolveUrl(version.testimonialPhoto.url), altText: version.testimonialPhoto.altText } : null,
    relatedCapabilitySlugs,
    publishedDate: (version.publishedAt ?? story.createdAt).toISOString().slice(0, 10),
    seoTitle: text.seoTitle,
    seoDescription: text.seoDescription,
  };

  return NextResponse.json({ story: responseStory });
}
