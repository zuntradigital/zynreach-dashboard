import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { executeDueCustomerStoryPublications } from "@/lib/content/scheduler";

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
 * Knowledge Center §7 Public Read: Published CustomerStory set.
 * Service-token authenticated, same contract as Blog's public routes.
 * Customer Stories is direct-save (see the admin PATCH handler's
 * docstring): reads CustomerStory.status/currentVersion directly, not
 * "last published version".
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  await executeDueCustomerStoryPublications();

  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  const stories = await prisma.customerStory.findMany({
    where: { status: "PUBLISHED" },
    include: {
      customerLogo: true,
      currentVersion: { include: { testimonialPhoto: true } },
    },
    orderBy: [{ featured: "desc" }, { updatedAt: "desc" }],
  });

  const origin = new URL(request.url).origin;
  const resolveUrl = (url: string) => (url.startsWith("http") ? url : `${origin}${url}`);

  const responseStories = stories
    .filter((story) => story.currentVersion !== null)
    .map((story) => {
      const version = story.currentVersion!;
      const text = (version.translations as unknown as Record<"en" | "ar", LocaleText>)[locale];
      // JSON string array (MySQL/Prisma has no array scalar type — see
      // CustomerStoryVersion.relatedCapabilitySlugs' schema comment); this
      // application always writes it as a string[], so the cast is safe.
      const relatedCapabilitySlugs = version.relatedCapabilitySlugs as string[];

      return {
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
    });

  return NextResponse.json({ stories: responseStories });
}
