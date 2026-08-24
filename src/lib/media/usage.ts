import { prisma } from "@/lib/db";

/**
 * SRS §18 "Usage Tracking — every Page, Blog Post, and Customer Story
 * component referencing the asset is listed on the asset's detail screen
 * (SCR-026), satisfying FR-ADM-011." Blog Post and Customer Story don't
 * exist yet (§16's remaining Content Management types), so this scans
 * Page only — extending it is additive once those types ship, not a
 * redesign.
 *
 * Deliberately computed, not stored: a `usageCount` column would go
 * stale the moment an editor removes an image from a page without this
 * module knowing. Scans each Page's *current* version only — "usage"
 * means live/active reference, not "ever referenced in any historical
 * version," matching FR-ADM-011's "currently referencing."
 */

export interface MediaUsageRef {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  blockId: string;
  blockType: string;
}

interface StoredBlock {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown>;
}

function blockReferencesAsset(block: StoredBlock, mediaAssetId: string): boolean {
  if (!block.props) return false;
  return Object.values(block.props).some((value) => value === mediaAssetId);
}

export async function findMediaAssetUsage(mediaAssetId: string): Promise<MediaUsageRef[]> {
  const pages = await prisma.page.findMany({
    where: { currentVersion: { isNot: null } },
    select: {
      id: true,
      slug: true,
      title: true,
      currentVersion: { select: { componentBlocks: true } },
    },
  });

  const refs: MediaUsageRef[] = [];
  for (const page of pages) {
    const blocks = Array.isArray(page.currentVersion?.componentBlocks) ? (page.currentVersion.componentBlocks as StoredBlock[]) : [];
    for (const block of blocks) {
      if (blockReferencesAsset(block, mediaAssetId)) {
        refs.push({
          pageId: page.id,
          pageTitle: page.title,
          pageSlug: page.slug,
          blockId: typeof block.id === "string" ? block.id : "",
          blockType: typeof block.type === "string" ? block.type : "",
        });
      }
    }
  }
  return refs;
}
