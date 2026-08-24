import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

/**
 * SRS FR-ADM-004 / §28.2 ScheduledPublication: "automatic transition to
 * Published at that time." There is no background job runner in this
 * environment, so due publications are executed lazily — checked and
 * applied whenever a Pages list or the public read API is queried, which
 * are exactly the two places whose correctness depends on the schedule
 * having actually fired. This is a disclosed simplification (a real
 * deploy would run this off a cron/queue instead of on-read), not a
 * fake/stubbed scheduler — the transition it performs is the real one.
 */
export async function executeDueScheduledPublications(): Promise<void> {
  const due = await prisma.scheduledPublication.findMany({
    where: { resourceType: "Page", executedAt: null, scheduledFor: { lte: new Date() } },
  });
  if (due.length === 0) return;

  // No DB-level relation to walk (resourceType/resourceId isn't a real FK —
  // see Approval's schema comment), so each due publication's Page is
  // fetched individually; due-publication volume is inherently small.
  const pages = await prisma.page.findMany({ where: { id: { in: due.map((d) => d.resourceId) } } });
  const pageById = new Map(pages.map((p) => [p.id, p]));

  for (const publication of due) {
    const page = pageById.get(publication.resourceId);
    if (!page || page.status !== "SCHEDULED" || !page.currentVersionId) continue;

    const now = new Date();
    await prisma.$transaction([
      prisma.pageVersion.update({
        where: { id: page.currentVersionId },
        data: { publishedAt: now, publishedByUserId: publication.createdByUserId },
      }),
      prisma.page.update({ where: { id: page.id }, data: { status: "PUBLISHED" } }),
      prisma.scheduledPublication.update({ where: { id: publication.id }, data: { executedAt: now } }),
    ]);

    await recordAudit({
      actorId: publication.createdByUserId,
      action: "page.publish_scheduled",
      resourceType: "Page",
      resourceId: page.id,
      before: { status: "SCHEDULED" },
      after: { status: "PUBLISHED", versionId: page.currentVersionId },
      result: "SUCCESS",
    });
  }
}

/** Pricing's counterpart to executeDueScheduledPublications — same lazy,
 * on-read execution model (§15.2's lifecycle shares the Scheduled state
 * with Standard content, FR-ADM-004), against PricingPlan/PricingVersion
 * instead of Page/PageVersion since the version-linking column differs. */
export async function executeDuePricingPublications(): Promise<void> {
  const due = await prisma.scheduledPublication.findMany({
    where: { resourceType: "PricingPlan", executedAt: null, scheduledFor: { lte: new Date() } },
  });
  if (due.length === 0) return;

  const plans = await prisma.pricingPlan.findMany({ where: { id: { in: due.map((d) => d.resourceId) } } });
  const planById = new Map(plans.map((p) => [p.id, p]));

  for (const publication of due) {
    const plan = planById.get(publication.resourceId);
    if (!plan || plan.status !== "SCHEDULED" || !plan.currentVersionId) continue;

    const now = new Date();
    await prisma.$transaction([
      prisma.pricingVersion.update({
        where: { id: plan.currentVersionId },
        data: { publishedAt: now, publishedByUserId: publication.createdByUserId },
      }),
      prisma.pricingPlan.update({ where: { id: plan.id }, data: { status: "PUBLISHED" } }),
      prisma.scheduledPublication.update({ where: { id: publication.id }, data: { executedAt: now } }),
    ]);

    await recordAudit({
      actorId: publication.createdByUserId,
      action: "pricing.publish_scheduled",
      resourceType: "PricingPlan",
      resourceId: plan.id,
      before: { status: "SCHEDULED" },
      after: { status: "PUBLISHED", versionId: plan.currentVersionId },
      result: "SUCCESS",
    });
  }
}

/** Blog's counterpart to executeDueScheduledPublications/executeDuePricingPublications. */
export async function executeDueBlogPublications(): Promise<void> {
  const due = await prisma.scheduledPublication.findMany({
    where: { resourceType: "BlogPost", executedAt: null, scheduledFor: { lte: new Date() } },
  });
  if (due.length === 0) return;

  const posts = await prisma.blogPost.findMany({ where: { id: { in: due.map((d) => d.resourceId) } } });
  const postById = new Map(posts.map((p) => [p.id, p]));

  for (const publication of due) {
    const post = postById.get(publication.resourceId);
    if (!post || post.status !== "SCHEDULED" || !post.currentVersionId) continue;

    const now = new Date();
    await prisma.$transaction([
      prisma.blogPostVersion.update({
        where: { id: post.currentVersionId },
        data: { publishedAt: now, publishedByUserId: publication.createdByUserId },
      }),
      prisma.blogPost.update({ where: { id: post.id }, data: { status: "PUBLISHED" } }),
      prisma.scheduledPublication.update({ where: { id: publication.id }, data: { executedAt: now } }),
    ]);

    await recordAudit({
      actorId: publication.createdByUserId,
      action: "blog.publish_scheduled",
      resourceType: "BlogPost",
      resourceId: post.id,
      before: { status: "SCHEDULED" },
      after: { status: "PUBLISHED", versionId: post.currentVersionId },
      result: "SUCCESS",
    });
  }
}

/** Careers' counterpart to executeDueScheduledPublications/executeDuePricingPublications. */
export async function executeDueJobListingPublications(): Promise<void> {
  const due = await prisma.scheduledPublication.findMany({
    where: { resourceType: "JobListing", executedAt: null, scheduledFor: { lte: new Date() } },
  });
  if (due.length === 0) return;

  const listings = await prisma.jobListing.findMany({ where: { id: { in: due.map((d) => d.resourceId) } } });
  const listingById = new Map(listings.map((l) => [l.id, l]));

  for (const publication of due) {
    const listing = listingById.get(publication.resourceId);
    if (!listing || listing.status !== "SCHEDULED" || !listing.currentVersionId) continue;

    const now = new Date();
    await prisma.$transaction([
      prisma.jobListingVersion.update({
        where: { id: listing.currentVersionId },
        data: { publishedAt: now, publishedByUserId: publication.createdByUserId },
      }),
      prisma.jobListing.update({ where: { id: listing.id }, data: { status: "PUBLISHED" } }),
      prisma.scheduledPublication.update({ where: { id: publication.id }, data: { executedAt: now } }),
    ]);

    await recordAudit({
      actorId: publication.createdByUserId,
      action: "careers.publish_scheduled",
      resourceType: "JobListing",
      resourceId: listing.id,
      before: { status: "SCHEDULED" },
      after: { status: "PUBLISHED", versionId: listing.currentVersionId },
      result: "SUCCESS",
    });
  }
}

/** Customer Stories' counterpart to executeDueScheduledPublications/executeDuePricingPublications. */
export async function executeDueCustomerStoryPublications(): Promise<void> {
  const due = await prisma.scheduledPublication.findMany({
    where: { resourceType: "CustomerStory", executedAt: null, scheduledFor: { lte: new Date() } },
  });
  if (due.length === 0) return;

  const stories = await prisma.customerStory.findMany({ where: { id: { in: due.map((d) => d.resourceId) } } });
  const storyById = new Map(stories.map((s) => [s.id, s]));

  for (const publication of due) {
    const story = storyById.get(publication.resourceId);
    if (!story || story.status !== "SCHEDULED" || !story.currentVersionId) continue;

    const now = new Date();
    await prisma.$transaction([
      prisma.customerStoryVersion.update({
        where: { id: story.currentVersionId },
        data: { publishedAt: now, publishedByUserId: publication.createdByUserId },
      }),
      prisma.customerStory.update({ where: { id: story.id }, data: { status: "PUBLISHED" } }),
      prisma.scheduledPublication.update({ where: { id: publication.id }, data: { executedAt: now } }),
    ]);

    await recordAudit({
      actorId: publication.createdByUserId,
      action: "customerStories.publish_scheduled",
      resourceType: "CustomerStory",
      resourceId: story.id,
      before: { status: "SCHEDULED" },
      after: { status: "PUBLISHED", versionId: story.currentVersionId },
      result: "SUCCESS",
    });
  }
}

/** Resources' counterpart to executeDueScheduledPublications/executeDuePricingPublications. */
export async function executeDueResourcePublications(): Promise<void> {
  const due = await prisma.scheduledPublication.findMany({
    where: { resourceType: "Resource", executedAt: null, scheduledFor: { lte: new Date() } },
  });
  if (due.length === 0) return;

  const resources = await prisma.resource.findMany({ where: { id: { in: due.map((d) => d.resourceId) } } });
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  for (const publication of due) {
    const resource = resourceById.get(publication.resourceId);
    if (!resource || resource.status !== "SCHEDULED" || !resource.currentVersionId) continue;

    const now = new Date();
    await prisma.$transaction([
      prisma.resourceVersion.update({
        where: { id: resource.currentVersionId },
        data: { publishedAt: now, publishedByUserId: publication.createdByUserId },
      }),
      prisma.resource.update({ where: { id: resource.id }, data: { status: "PUBLISHED" } }),
      prisma.scheduledPublication.update({ where: { id: publication.id }, data: { executedAt: now } }),
    ]);

    await recordAudit({
      actorId: publication.createdByUserId,
      action: "resources.publish_scheduled",
      resourceType: "Resource",
      resourceId: resource.id,
      before: { status: "SCHEDULED" },
      after: { status: "PUBLISHED", versionId: resource.currentVersionId },
      result: "SUCCESS",
    });
  }
}

/** Webinars' counterpart to executeDueScheduledPublications/executeDuePricingPublications. */
export async function executeDueWebinarPublications(): Promise<void> {
  const due = await prisma.scheduledPublication.findMany({
    where: { resourceType: "Webinar", executedAt: null, scheduledFor: { lte: new Date() } },
  });
  if (due.length === 0) return;

  const webinars = await prisma.webinar.findMany({ where: { id: { in: due.map((d) => d.resourceId) } } });
  const webinarById = new Map(webinars.map((w) => [w.id, w]));

  for (const publication of due) {
    const webinar = webinarById.get(publication.resourceId);
    if (!webinar || webinar.status !== "SCHEDULED" || !webinar.currentVersionId) continue;

    const now = new Date();
    await prisma.$transaction([
      prisma.webinarVersion.update({
        where: { id: webinar.currentVersionId },
        data: { publishedAt: now, publishedByUserId: publication.createdByUserId },
      }),
      prisma.webinar.update({ where: { id: webinar.id }, data: { status: "PUBLISHED" } }),
      prisma.scheduledPublication.update({ where: { id: publication.id }, data: { executedAt: now } }),
    ]);

    await recordAudit({
      actorId: publication.createdByUserId,
      action: "webinars.publish_scheduled",
      resourceType: "Webinar",
      resourceId: webinar.id,
      before: { status: "SCHEDULED" },
      after: { status: "PUBLISHED", versionId: webinar.currentVersionId },
      result: "SUCCESS",
    });
  }
}
