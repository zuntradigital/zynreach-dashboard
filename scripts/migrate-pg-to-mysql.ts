/**
 * One-time data migration: copies every row from the source PostgreSQL
 * database (LEGACY_POSTGRES_DATABASE_URL, read via a separate Prisma
 * Client generated from prisma/schema.postgres-source.prisma) into the
 * target MySQL database (DATABASE_URL, the app's normal Prisma Client).
 *
 * Every record keeps its original id, so all foreign keys resolve
 * unchanged — this app already used app-generated cuid() string ids
 * rather than DB-generated serials, which is what makes a straight
 * cross-engine copy like this possible without an id-remapping pass.
 *
 * Tables are copied in FK-dependency order. Five tables (Page,
 * PricingPlan, BlogPost, Resource, JobListing) have a circular
 * self-reference to their own "current version" row, so each is created
 * twice: once without currentVersionId, then patched with it after the
 * corresponding *Version table has been copied.
 *
 * The two Postgres-only `String[]` columns (MediaAsset.tags,
 * BlogPostVersion.relatedPostSlugs) are now `Json` on the MySQL side
 * (see schema.prisma's own comment) — the array value copies straight
 * across since a JS array is valid JSON either way.
 *
 * Idempotent-ish: uses createMany with skipDuplicates, so re-running
 * after a partial failure only inserts what's still missing rather than
 * erroring on already-migrated rows.
 */
import { PrismaClient as SourcePrismaClient } from "../node_modules/.prisma/client-pg-source";
import { PrismaClient as TargetPrismaClient } from "@prisma/client";

const source = new SourcePrismaClient();
const target = new TargetPrismaClient();

async function copy<T extends Record<string, unknown>>(label: string, rows: T[], write: (rows: T[]) => Promise<{ count: number }>) {
  if (rows.length === 0) {
    console.log(`  ${label}: 0 rows (nothing to copy)`);
    return;
  }
  const result = await write(rows);
  console.log(`  ${label}: ${result.count}/${rows.length} rows inserted`);
}

async function main() {
  console.log("== Phase 1: independent tables ==");
  await copy("AdminUser", await source.adminUser.findMany(), (rows) => target.adminUser.createMany({ data: rows, skipDuplicates: true }));
  await copy("Role", await source.role.findMany(), (rows) => target.role.createMany({ data: rows, skipDuplicates: true }));
  await copy("Permission", await source.permission.findMany(), (rows) => target.permission.createMany({ data: rows, skipDuplicates: true }));
  await copy("Author", await source.author.findMany(), (rows) => target.author.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("Category", await source.category.findMany(), (rows) => target.category.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("Tag", await source.tag.findMany(), (rows) => target.tag.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("PricingFeature", await source.pricingFeature.findMany(), (rows) => target.pricingFeature.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("ChatConversation", await source.chatConversation.findMany(), (rows) => target.chatConversation.createMany({ data: rows, skipDuplicates: true }));

  console.log("== Phase 2: depend only on phase 1 ==");
  await copy("AdminUserRole", await source.adminUserRole.findMany(), (rows) => target.adminUserRole.createMany({ data: rows, skipDuplicates: true }));
  await copy("RolePermission", await source.rolePermission.findMany(), (rows) => target.rolePermission.createMany({ data: rows, skipDuplicates: true }));
  await copy("Session", await source.session.findMany(), (rows) => target.session.createMany({ data: rows, skipDuplicates: true }));
  await copy("MfaChallenge", await source.mfaChallenge.findMany(), (rows) => target.mfaChallenge.createMany({ data: rows, skipDuplicates: true }));
  await copy("AdminUserInvitation", await source.adminUserInvitation.findMany(), (rows) => target.adminUserInvitation.createMany({ data: rows, skipDuplicates: true }));
  await copy("AuditLog", await source.auditLog.findMany(), (rows) => target.auditLog.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("Submission", await source.submission.findMany(), (rows) => target.submission.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("SiteSetting", await source.siteSetting.findMany(), (rows) => target.siteSetting.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("AnnouncementBanner", await source.announcementBanner.findMany(), (rows) => target.announcementBanner.createMany({ data: rows, skipDuplicates: true }));
  const mediaAssets = await source.mediaAsset.findMany();
  await copy(
    "MediaAsset",
    mediaAssets,
    (rows) => target.mediaAsset.createMany({ data: rows.map((r) => ({ ...r, tags: r.tags as unknown as object })) as never, skipDuplicates: true })
  );
  await copy("ChatMessage", await source.chatMessage.findMany(), (rows) => target.chatMessage.createMany({ data: rows as never, skipDuplicates: true }));

  console.log("== Phase 3: depend on phase 1+2 ==");
  await copy("Lead", await source.lead.findMany(), (rows) => target.lead.createMany({ data: rows as never, skipDuplicates: true }));

  console.log("== Phase 4: governed content parents (currentVersionId deferred) ==");
  const pages = await source.page.findMany();
  await copy("Page", pages, (rows) => target.page.createMany({ data: rows.map((r) => ({ ...r, currentVersionId: null })), skipDuplicates: true }));

  const pricingPlans = await source.pricingPlan.findMany();
  await copy("PricingPlan", pricingPlans, (rows) => target.pricingPlan.createMany({ data: rows.map((r) => ({ ...r, currentVersionId: null })), skipDuplicates: true }));

  const blogPosts = await source.blogPost.findMany();
  await copy("BlogPost", blogPosts, (rows) => target.blogPost.createMany({ data: rows.map((r) => ({ ...r, currentVersionId: null })), skipDuplicates: true }));

  const resources = await source.resource.findMany();
  await copy("Resource", resources, (rows) => target.resource.createMany({ data: rows.map((r) => ({ ...r, currentVersionId: null })), skipDuplicates: true }));

  const jobListings = await source.jobListing.findMany();
  await copy("JobListing", jobListings, (rows) => target.jobListing.createMany({ data: rows.map((r) => ({ ...r, currentVersionId: null })), skipDuplicates: true }));

  console.log("== Phase 5: version tables ==");
  await copy("PageVersion", await source.pageVersion.findMany(), (rows) => target.pageVersion.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("PricingVersion", await source.pricingVersion.findMany(), (rows) => target.pricingVersion.createMany({ data: rows as never, skipDuplicates: true }));
  const blogPostVersions = await source.blogPostVersion.findMany();
  await copy(
    "BlogPostVersion",
    blogPostVersions,
    (rows) =>
      target.blogPostVersion.createMany({
        data: rows.map((r) => ({ ...r, relatedPostSlugs: r.relatedPostSlugs as unknown as object })) as never,
        skipDuplicates: true,
      })
  );
  await copy("ResourceVersion", await source.resourceVersion.findMany(), (rows) => target.resourceVersion.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("JobListingVersion", await source.jobListingVersion.findMany(), (rows) => target.jobListingVersion.createMany({ data: rows as never, skipDuplicates: true }));

  console.log("== Phase 6: everything else that depends on phase 5 ==");
  await copy("Approval", await source.approval.findMany(), (rows) => target.approval.createMany({ data: rows, skipDuplicates: true }));
  await copy("ScheduledPublication", await source.scheduledPublication.findMany(), (rows) => target.scheduledPublication.createMany({ data: rows, skipDuplicates: true }));
  await copy("JobApplication", await source.jobApplication.findMany(), (rows) => target.jobApplication.createMany({ data: rows, skipDuplicates: true }));
  await copy("Promotion", await source.promotion.findMany(), (rows) => target.promotion.createMany({ data: rows as never, skipDuplicates: true }));
  await copy("PromotionPlan", await source.promotionPlan.findMany(), (rows) => target.promotionPlan.createMany({ data: rows, skipDuplicates: true }));
  await copy("PricingVersionFeature", await source.pricingVersionFeature.findMany(), (rows) => target.pricingVersionFeature.createMany({ data: rows, skipDuplicates: true }));
  await copy("BlogPostVersionCategory", await source.blogPostVersionCategory.findMany(), (rows) => target.blogPostVersionCategory.createMany({ data: rows, skipDuplicates: true }));
  await copy("BlogPostVersionTag", await source.blogPostVersionTag.findMany(), (rows) => target.blogPostVersionTag.createMany({ data: rows, skipDuplicates: true }));

  console.log("== Phase 7: patch back currentVersionId on the five self-referencing tables ==");
  let patched = 0;
  for (const p of pages) {
    if (p.currentVersionId) {
      await target.page.update({ where: { id: p.id }, data: { currentVersionId: p.currentVersionId } });
      patched++;
    }
  }
  console.log(`  Page.currentVersionId: ${patched} patched`);

  patched = 0;
  for (const p of pricingPlans) {
    if (p.currentVersionId) {
      await target.pricingPlan.update({ where: { id: p.id }, data: { currentVersionId: p.currentVersionId } });
      patched++;
    }
  }
  console.log(`  PricingPlan.currentVersionId: ${patched} patched`);

  patched = 0;
  for (const p of blogPosts) {
    if (p.currentVersionId) {
      await target.blogPost.update({ where: { id: p.id }, data: { currentVersionId: p.currentVersionId } });
      patched++;
    }
  }
  console.log(`  BlogPost.currentVersionId: ${patched} patched`);

  patched = 0;
  for (const p of resources) {
    if (p.currentVersionId) {
      await target.resource.update({ where: { id: p.id }, data: { currentVersionId: p.currentVersionId } });
      patched++;
    }
  }
  console.log(`  Resource.currentVersionId: ${patched} patched`);

  patched = 0;
  for (const p of jobListings) {
    if (p.currentVersionId) {
      await target.jobListing.update({ where: { id: p.id }, data: { currentVersionId: p.currentVersionId } });
      patched++;
    }
  }
  console.log(`  JobListing.currentVersionId: ${patched} patched`);

  console.log("\n== Migration complete ==");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.$disconnect();
    await target.$disconnect();
  });
