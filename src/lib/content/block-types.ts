/**
 * SCR-004 Component Picker's starter palette — a small, safe set of
 * generic block types (Hero, Rich Text, CTA Band), not the full Reusable
 * Component Library from Website SRS §11 (Hero, "Who it's for" strip,
 * Feature Block, "How it works" sequence, Related Integrations, Related
 * Customer Story, Comparison, CTA Band, ...). Replicating that full,
 * template-scoped palette requires studying System A's actual component
 * source in depth; this ships the architecture end-to-end (typed blocks,
 * ordering, a real System A render path) with three block types, and new
 * types are additive — nothing about Page/PageVersion/the workflow
 * changes to add a fourth. Shared between the admin editor (this file)
 * and, by field-name convention, the block renderer in zynreach-website.
 */

export interface BlockFieldDef {
  key: string;
  labelKey: string;
  type: "text" | "textarea" | "url" | "media";
}

export interface BlockTypeDef {
  type: string;
  labelKey: string;
  fields: BlockFieldDef[];
}

/**
 * `type: "media"` fields store a `MediaAsset.id` (a plain string, same as
 * every other prop) rather than a raw file URL — SRS §18's Media Library
 * is the single source of truth for any image a block uses, matching the
 * requirement that replacing an asset ("Replace Asset") or archiving it
 * updates/affects every reference automatically. The Page Builder resolves
 * the id to a thumbnail via the Media Picker (src/components/MediaPicker.tsx);
 * usage tracking (src/lib/media/usage.ts) scans for this same id.
 */
export const BLOCK_TYPES: BlockTypeDef[] = [
  {
    type: "hero",
    labelKey: "hero",
    fields: [
      { key: "title", labelKey: "heroTitle", type: "text" },
      { key: "subtitle", labelKey: "heroSubtitle", type: "textarea" },
      { key: "imageMediaAssetId", labelKey: "heroImage", type: "media" },
      { key: "ctaLabel", labelKey: "ctaLabel", type: "text" },
      { key: "ctaHref", labelKey: "ctaHref", type: "url" },
    ],
  },
  {
    type: "richText",
    labelKey: "richText",
    fields: [{ key: "body", labelKey: "richTextBody", type: "textarea" }],
  },
  {
    type: "ctaBand",
    labelKey: "ctaBand",
    fields: [
      { key: "title", labelKey: "ctaBandTitle", type: "text" },
      { key: "ctaLabel", labelKey: "ctaLabel", type: "text" },
      { key: "ctaHref", labelKey: "ctaHref", type: "url" },
    ],
  },
];

export function getBlockTypeDef(type: string): BlockTypeDef | undefined {
  return BLOCK_TYPES.find((b) => b.type === type);
}
