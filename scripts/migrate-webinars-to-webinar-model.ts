/**
 * One-time data migration: moves existing `Resource` rows with
 * `resourceFormat: "WEBINAR"` into the new dedicated `Webinar`/
 * `WebinarVersion` models, then deletes the old rows — run once, after
 * the additive migration that created the Webinar tables and before the
 * follow-up migration that drops `ResourceVersion.eventDate` and removes
 * `WEBINAR` from `ResourceFormat` (see both fields' TEMPORARY comments in
 * schema.prisma). Preserves original ids, timestamps, and content exactly
 * — this is a schema-shape change, not new/lost data.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows: {
    resourceId: string;
    slug: string;
    status: string;
    gated: number;
    createdAt: Date;
    updatedAt: Date;
    createdByUserId: string | null;
    submittedByUserId: string | null;
    versionId: string;
    versionNumber: number;
    eventDate: Date | null;
    translations: unknown;
    publishedAt: Date | null;
    publishedByUserId: string | null;
    versionCreatedByUserId: string | null;
    versionCreatedAt: Date;
  }[] = await prisma.$queryRaw`
    SELECT r.id as resourceId, r.slug, r.status, r.gated, r.createdAt, r.updatedAt, r.createdByUserId, r.submittedByUserId,
           rv.id as versionId, rv.versionNumber, rv.eventDate, rv.translations, rv.publishedAt, rv.publishedByUserId, rv.createdByUserId as versionCreatedByUserId, rv.createdAt as versionCreatedAt
    FROM resource r
    LEFT JOIN resourceversion rv ON rv.resourceId = r.id
    WHERE r.resourceFormat = 'WEBINAR'
    ORDER BY r.id, rv.versionNumber
  `;

  console.log(`Found ${rows.length} WEBINAR resource-version rows to migrate.`);

  const byResource = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byResource.get(row.resourceId) ?? [];
    list.push(row);
    byResource.set(row.resourceId, list);
  }

  for (const [resourceId, versions] of byResource) {
    const first = versions[0];
    await prisma.$transaction(async (tx) => {
      await tx.webinar.create({
        data: {
          id: resourceId,
          slug: first.slug,
          gated: first.gated === 1,
          featured: false,
          status: first.status as never,
          createdByUserId: first.createdByUserId,
          submittedByUserId: first.submittedByUserId,
          createdAt: first.createdAt,
          updatedAt: first.updatedAt,
        },
      });

      let currentVersionId: string | null = null;
      for (const v of versions) {
        const t = v.translations as { en?: { title?: string; description?: string; speaker?: string }; ar?: { title?: string; description?: string; speaker?: string } };
        const translations = {
          en: { title: t.en?.title ?? "", description: t.en?.description ?? "", speakerName: t.en?.speaker ?? "", speakerTitle: "", speakerCompany: "" },
          ar: { title: t.ar?.title ?? "", description: t.ar?.description ?? "", speakerName: t.ar?.speaker ?? "", speakerTitle: "", speakerCompany: "" },
        };
        await tx.webinarVersion.create({
          data: {
            id: v.versionId,
            webinarId: resourceId,
            versionNumber: v.versionNumber,
            scheduledAt: v.eventDate,
            isOnDemand: v.eventDate ? v.eventDate.getTime() < Date.now() : false,
            translations: translations as unknown as Prisma.InputJsonValue,
            publishedAt: v.publishedAt,
            publishedByUserId: v.publishedByUserId,
            createdByUserId: v.versionCreatedByUserId,
            createdAt: v.versionCreatedAt,
          },
        });
        currentVersionId = v.versionId;
      }

      if (currentVersionId) {
        await tx.webinar.update({ where: { id: resourceId }, data: { currentVersionId } });
      }

      await tx.resourceVersion.deleteMany({ where: { resourceId } });
      await tx.resource.delete({ where: { id: resourceId } });
    });
    console.log(`Migrated Resource ${resourceId} (${first.slug}) -> Webinar with ${versions.length} version(s).`);
  }

  const remaining = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) as c FROM resource WHERE resourceFormat = 'WEBINAR'`;
  console.log(`Remaining WEBINAR resource rows: ${Number(remaining[0].c)} (should be 0).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
