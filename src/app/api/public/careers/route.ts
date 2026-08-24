import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { executeDueJobListingPublications } from "@/lib/content/scheduler";

interface LocaleText {
  title: string;
  team: string;
  location: string;
  employmentType: string;
  description: string;
  responsibilities: string[];
  qualifications: string[];
  preferredSkills: string[];
}

/**
 * SRS §16/FR-ADM-029 Public Read: Published JobListing set, shaped to
 * match System A's own JobListing interface (src/types/content.ts —
 * id/title/team/location/employmentType/datePosted/description/
 * responsibilities/qualifications/preferredSkills) exactly, same
 * shape-matching contract as every other public read route.
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  await executeDueJobListingPublications();

  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  // Careers is direct-save (see the admin PATCH handler's docstring): the
  // admin's chosen status is the definitive, immediate live/offline
  // decision, so this reads JobListing.status/currentVersion directly
  // rather than "last published version" — a listing the admin just set
  // to Draft must disappear now, not keep showing an older Published copy.
  const listings = await prisma.jobListing.findMany({
    where: { status: "PUBLISHED" },
    include: { currentVersion: true },
  });

  const jobListings = listings
    .filter((l) => l.currentVersion !== null)
    .map((l) => {
      const version = l.currentVersion!;
      const text = (version.translations as unknown as Record<"en" | "ar", LocaleText>)[locale];
      return {
        id: l.slug,
        title: text.title,
        team: text.team,
        location: text.location,
        employmentType: text.employmentType,
        datePosted: (version.datePosted ?? version.publishedAt ?? l.createdAt).toISOString().slice(0, 10),
        description: text.description,
        responsibilities: text.responsibilities,
        qualifications: text.qualifications,
        preferredSkills: text.preferredSkills,
      };
    });

  return NextResponse.json({ jobListings });
}
