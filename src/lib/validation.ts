import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const mfaVerifySchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

/**
 * No password-strength rule existed anywhere in this codebase before the
 * invitation flow — every prior password was server-generated (seed.ts's
 * bootstrap Super Administrator, admin-users POST's old temporary
 * password). This is the first user-chosen password, so it's the first
 * place a rule is needed. Length-only, per NIST 800-63B guidance, rather
 * than forced character-class complexity rules.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(200);

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
  /// The invited person's own display name, chosen here for the first
  /// time — the Admin never supplies one at creation (see AdminUser.name
  /// in schema.prisma).
  name: z.string().trim().min(1).max(200),
  password: passwordSchema,
});

/** Step 2 of the invitation flow (see lib/auth/invitations.ts) — just
 * confirming "yes, I accept this invitation," before any password
 * exists. */
export const confirmInvitationSchema = z.object({
  token: z.string().min(1),
});

/**
 * Matches Submission's shape (schema.prisma) — formId identifies which
 * of System A's existing form handlers produced this payload; the
 * payload/utm shape itself is intentionally open (Prisma Json column),
 * since Form/FormField's own configurable field definitions are a
 * later-phase concern (SRS Forms & Lead Management module) and Phase 1
 * must not presuppose their shape.
 */
export const leadIngestSchema = z.object({
  formId: z.string().trim().min(1),
  payload: z.record(z.string(), z.unknown()),
  utm: z.record(z.string(), z.unknown()).optional(),
  source: z.string().trim().optional(),
  campaign: z.string().trim().optional(),
  /// The original website visitor's IP, supplied by System A (which has
  /// direct access to the real request) — distinct from the HTTP-layer
  /// IP of this call itself, which is System A's own server, not the
  /// visitor's.
  visitorIp: z.string().trim().optional(),
});

/**
 * Website chatbot -> Dashboard integration. `conversationToken` is the
 * anonymous, unauthenticated visitor identity (server-generated on first
 * message, then held by the website in localStorage and echoed back on
 * every later message) — omitted entirely means "start a new
 * conversation," matching how a visitor's very first chat message has no
 * prior conversation to attach to yet.
 */
export const chatMessageIngestSchema = z.object({
  conversationToken: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).max(4000),
});

export const chatMessagePollSchema = z.object({
  conversationToken: z.string().trim().min(1),
  after: z.string().trim().datetime().optional(),
});

export const chatReplySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

/**
 * Full-replace role assignment for a target AdminUser (SRS §28.2's
 * AdminUser.roleIds[] shape) — the minimal mechanism needed to make
 * §30's "session invalidation on role/permission change" actually
 * reachable at runtime; see src/app/api/admin/admin-users/[id]/roles.
 */
export const roleAssignmentSchema = z.object({
  roleIds: z.array(z.string().min(1)),
});

/**
 * Full-replace permission grant set for a Role (SCR-050, SRS §23's
 * "Module × Action permission matrix... editable by Super
 * Administrator"). Same full-replace shape as roleAssignmentSchema for
 * consistency.
 */
export const rolePermissionsSchema = z.object({
  permissionIds: z.array(z.string().min(1)),
});

/** SRS §23: sensitive-action re-authentication (FR-ADM-001). */
export const reauthSchema = z.object({
  password: z.string().min(1),
});

/**
 * M8 Global Website Settings (§22, §29's `PATCH /api/admin/settings/
 * {group}`). Deliberately permissive on value shape — each group's
 * field set is defined once, client-side, in settings-groups.ts; the
 * server trusts the authenticated, permissioned caller for which keys
 * belong to a group, the same way the audit log trusts its `before`/
 * `after` Json payloads, rather than duplicating a per-field schema
 * server-side too.
 */
export const updateSettingsGroupSchema = z.object({
  values: z.record(
    z.string().min(1),
    z.union([z.string(), z.boolean(), z.number(), z.array(z.string()), z.null()])
  ),
});

/**
 * SRS §22 "Global Banners / Announcement Bars — Message, link, active
 * date range, dismissible flag, target zone" (SCR-044). Same
 * settings:manage permission as the rest of §22 — see the
 * AnnouncementBanner model's schema comment for why this is its own
 * table rather than a SiteSetting group.
 */
export const createBannerSchema = z.object({
  message: z.string().trim().min(1).max(500),
  link: z.string().trim().max(2000).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  dismissible: z.boolean().default(true),
  targetZone: z.string().trim().min(1).max(100).default("sitewide"),
});

/**
 * SRS §23 "invite → pending → active" account creation, FR-ADM-020,
 * §29's `POST /api/admin/users — Session + Users:Create`. Admin-
 * initiated only — there is no public self-registration path in the
 * SRS (§7 Actors defines exactly one human actor: internal staff).
 */
/// Admin-initiated invitation: email + role(s) only. Deliberately no
/// `name` field — the Admin never enters or knows the invited person's
/// name; they choose it themselves via acceptInvitationSchema above.
export const createAdminUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roleIds: z.array(z.string().min(1)).min(1, "Select at least one role."),
});

/** SRS §23: "invite → pending → active → deactivated. Deactivation is
 * soft." Only these two transitions are exposed — PENDING doesn't apply
 * here since accounts are created directly ACTIVE (see admin-users
 * POST's own doc comment on why). */
export const updateAdminUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "DEACTIVATED"]),
});

const PAGE_SIZE_MAX = 100;

/** SCR-051 filters: actor/action/resource/date range, per the SRS text. */
export const auditLogQuerySchema = z.object({
  action: z.string().trim().min(1).optional(),
  result: z.enum(["SUCCESS", "DENIED", "ERROR"]).optional(),
  actorEmail: z.string().trim().min(1).optional(),
  resourceType: z.string().trim().min(1).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(25),
  format: z.enum(["json", "csv"]).default("json"),
});

/**
 * SCR-035 Lead Detail edit — Reassign Owner (leads:edit) and Archive
 * (leads:archive, checked separately in the route since it's an
 * independent permission from Edit — see workflow.ts's own Delete-vs-
 * Archive note, which applies the same way here even though Leads has
 * no Draft/Published workflow of its own).
 */
export const updateLeadSchema = z.object({
  assignedOwnerId: z.string().trim().min(1).nullable().optional(),
  status: z.enum(["NEW", "ROUTED", "SYNCED", "SYNC_FAILED", "ARCHIVED"]).optional(),
});

/** SCR-034 filters: form type, status, source, campaign, date range. */
export const leadsQuerySchema = z.object({
  status: z.enum(["NEW", "ROUTED", "SYNCED", "SYNC_FAILED", "ARCHIVED"]).optional(),
  source: z.string().trim().min(1).optional(),
  formId: z.string().trim().min(1).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
  format: z.enum(["json", "csv"]).default("json"),
});

/**
 * SRS §16/§17/§28.2 Content Management (Pages, first content type).
 * `componentBlocks` mirrors the ContentBlock field set (type/order/props)
 * inline — see PageVersion's schema comment for why it's a JSON array
 * rather than a separate table. `type` stays a free string (matching
 * Permission.module/action's own extensibility reasoning) rather than a
 * closed enum of every component in Website SRS §11, since this
 * increment ships a small starter palette, not the full library.
 */
const contentBlockSchema = z.object({
  id: z.string().min(1),
  type: z.string().trim().min(1).max(100),
  order: z.number().int().min(0),
  props: z.record(z.string(), z.unknown()).default({}),
});

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be URL-safe lowercase (letters, numbers, hyphens).");

export const createPageSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  templateType: z.string().trim().min(1).max(100).default("standard"),
  classification: z.enum(["STANDARD", "PRICING", "LEGAL", "SECURITY"]).default("STANDARD"),
  componentBlocks: z.array(contentBlockSchema).default([]),
});

export const savePageDraftSchema = z.object({
  // Direct-save, matching Blog/Pricing/Careers (see the PATCH handler's
  // docstring): the admin picks the page's live status on every save
  // instead of going through Draft -> Submit -> Approve -> Publish.
  // ARCHIVED sits alongside DRAFT/PUBLISHED so archiving/restoring a page
  // is the same Save flow, not a separate workflow action.
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  title: z.string().trim().min(1).max(200),
  componentBlocks: z.array(contentBlockSchema),
});

export const pageActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit") }),
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("requestChanges"), comment: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("schedule"), scheduledFor: z.coerce.date() }),
  z.object({ action: z.literal("publish") }),
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("rollback"), versionId: z.string().min(1) }),
]);

export const pagesQuerySchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  classification: z.enum(["STANDARD", "PRICING", "LEGAL", "SECURITY"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type SavePageDraftInput = z.infer<typeof savePageDraftSchema>;
export type PageActionInput = z.infer<typeof pageActionSchema>;
export type PagesQuery = z.infer<typeof pagesQuerySchema>;

/**
 * SRS §15.1/§28.2 PricingVersion's per-locale display text. `featureList`
 * may be empty (a plan's headline feature bullets are optional copy,
 * distinct from the structured PricingFeature comparison-table rows,
 * which are validated separately in savePricingVersionSchema).
 */
const pricingLocaleTextSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).default(""),
  priceSuffix: z.string().trim().max(100).default(""),
  featureList: z.array(z.string().trim().min(1).max(300)).default([]),
  ctaLabel: z.string().trim().min(1).max(100),
  badgeLabel: z.string().trim().max(100).optional(),
});

const pricingTranslationsSchema = z.object({
  en: pricingLocaleTextSchema,
  ar: pricingLocaleTextSchema,
});

export const createPricingPlanSchema = z.object({
  slug: slugSchema,
  visibility: z.enum(["PUBLIC", "HIDDEN"]).default("PUBLIC"),
  featured: z.boolean().default(false),
  recommended: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
});

/**
 * SRS §32: "PricingVersion requires Monthly Price, Annual Price,
 * Currency, ≥1 Feature." Read as "priced at all, both required together"
 * rather than an absolute requirement — a null/null pair is the
 * deliberate "custom quote" case (Enterprise-style contact-sales tiers,
 * which the Website SRS's own pricing content has always included) and
 * is validated by the API route (both-or-neither), not this schema,
 * since Zod's per-field validation can't express that pairing cleanly.
 * ≥1 Feature is enforced the same place canSubmitForReview's block-count
 * check lives for Pages: in the submit-for-review action, not here —
 * a Draft may legitimately be incomplete mid-edit.
 */
export const savePricingVersionSchema = z.object({
  // Pricing direct-save: the admin explicitly picks the live status on
  // every save instead of Save always forcing PUBLISHED (see the PATCH
  // handler's docstring). ARCHIVED is included alongside DRAFT/PUBLISHED
  // so archiving/restoring a plan is the same Save flow, not a separate
  // workflow action.
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  monthlyPrice: z.number().min(0).nullable(),
  annualPrice: z.number().min(0).nullable(),
  currency: z.string().trim().length(3).default("USD"),
  trialPeriodDays: z.number().int().min(0).nullable().default(null),
  ctaTarget: z.string().trim().min(1).max(200).default("/trial"),
  effectiveDate: z.coerce.date().nullable().default(null),
  expirationDate: z.coerce.date().nullable().default(null),
  translations: pricingTranslationsSchema,
  features: z.array(z.object({ featureKey: z.string().trim().min(1), value: z.string().trim().min(1).max(100) })).default([]),
});

export const pricingActionSchema = pageActionSchema;

export const pricingPlansQuerySchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

const promotionLocaleTextSchema = z.object({ name: z.string().trim().min(1).max(200) });

export const savePromotionSchema = z.object({
  translations: z.object({ en: promotionLocaleTextSchema, ar: promotionLocaleTextSchema }),
  discountType: z.enum(["PERCENTAGE", "FIXED"]).default("PERCENTAGE"),
  discountValue: z.number().min(0),
  startDate: z.coerce.date().nullable().default(null),
  endDate: z.coerce.date().nullable().default(null),
  planIds: z.array(z.string().min(1)).default([]),
});

const pricingFeatureLocaleTextSchema = z.object({ category: z.string().trim().min(1).max(100), feature: z.string().trim().min(1).max(200) });

export const savePricingFeatureSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*$/, "Key must be alphanumeric (hyphens/underscores allowed)."),
  translations: z.object({ en: pricingFeatureLocaleTextSchema, ar: pricingFeatureLocaleTextSchema }),
  order: z.number().int().min(0).default(0),
});

export type CreatePricingPlanInput = z.infer<typeof createPricingPlanSchema>;
export type SavePricingVersionInput = z.infer<typeof savePricingVersionSchema>;
export type PricingActionInput = z.infer<typeof pricingActionSchema>;
export type PricingPlansQuery = z.infer<typeof pricingPlansQuerySchema>;
export type SavePromotionInput = z.infer<typeof savePromotionSchema>;
export type SavePricingFeatureInput = z.infer<typeof savePricingFeatureSchema>;

/**
 * SRS §16 BlogPost body — the §16 "rich-text fields within a component"
 * carve-out: contained, sanitized structured blocks, never freeform page
 * HTML. Matches System A's existing ArticleBlock union exactly (types
 * paragraph/heading/quote/list/image, each with an optional `content`/
 * `itemsContent` array of inline-formatted spans) so the public API's
 * shape needs no translation layer on the System A side — this is the
 * exact JSON the Blog editor's Tiptap toolbar (H1-H3/Bold/Italic/lists/
 * link/image) is converted to on save.
 */
const inlineSpanSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: z.string().trim().max(2000).optional(),
});

const articleBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().trim().min(1), content: z.array(inlineSpanSchema).optional() }),
  z.object({
    type: z.literal("heading"),
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    content: z.array(inlineSpanSchema).optional(),
  }),
  z.object({ type: z.literal("quote"), text: z.string().trim().min(1), content: z.array(inlineSpanSchema).optional() }),
  z.object({
    type: z.literal("list"),
    items: z.array(z.string().trim().min(1)).min(1),
    ordered: z.boolean().optional(),
    itemsContent: z.array(z.array(inlineSpanSchema)).optional(),
  }),
  z.object({ type: z.literal("image"), url: z.string().trim().min(1), alt: z.string().trim() }),
]);

const blogLocaleTextSchema = z.object({
  // Title/excerpt are NOT required here (only max-length is enforced) so a
  // Draft can autosave mid-edit before the admin has filled in every
  // field — the PATCH route's publish-completeness gate is what actually
  // requires them, and only when the requested status is PUBLISHED.
  title: z.string().trim().max(200).default(""),
  excerpt: z.string().trim().max(500).default(""),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(300).optional(),
  // SRS §19/§28.2 SEORecord fields, per-locale since each locale is its own
  // URL — ogImage deliberately reuses the article's own hero/cover image
  // (already the right social-share thumbnail) rather than a second
  // separate upload field.
  canonicalUrl: z.string().trim().max(500).optional(),
  noIndex: z.boolean().default(false),
  body: z.array(articleBlockSchema).default([]),
});

const blogTranslationsSchema = z.object({ en: blogLocaleTextSchema, ar: blogLocaleTextSchema });

export const createBlogPostSchema = z.object({
  slug: slugSchema,
  authorId: z.string().trim().min(1).nullable().default(null),
  featured: z.boolean().default(false),
});

/**
 * §16: "at least one Component Block required before Submit" maps here to
 * "at least one body block" — enforced in the submit action, same place
 * Pricing's ≥1-feature check lives, not here (a Draft may be incomplete).
 */
export const saveBlogPostVersionSchema = z.object({
  // Blog direct-save: the admin explicitly picks the live status on every
  // save instead of going through Draft -> Submit -> Approve -> Publish
  // (see the PATCH handler's docstring). ARCHIVED is included alongside
  // DRAFT/PUBLISHED so archiving/restoring a post is the same Save flow,
  // not a separate workflow action.
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  authorId: z.string().trim().min(1).nullable().default(null),
  featured: z.boolean().default(false),
  publishedDate: z.coerce.date().nullable().default(null),
  updatedDate: z.coerce.date().nullable().default(null),
  heroImageId: z.string().trim().min(1).nullable().default(null),
  relatedPostSlugs: z.array(z.string().trim().min(1)).default([]),
  categoryIds: z.array(z.string().trim().min(1)).default([]),
  tagIds: z.array(z.string().trim().min(1)).default([]),
  translations: blogTranslationsSchema,
});

export const blogActionSchema = pageActionSchema;

export const blogPostsQuerySchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  category: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

const authorLocaleTextSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(200),
  bio: z.string().trim().max(1000).default(""),
});
export const saveAuthorSchema = z.object({ translations: z.object({ en: authorLocaleTextSchema, ar: authorLocaleTextSchema }) });

const taxonomyLocaleTextSchema = z.object({ name: z.string().trim().min(1).max(200) });
export const saveCategorySchema = z.object({ slug: slugSchema, translations: z.object({ en: taxonomyLocaleTextSchema, ar: taxonomyLocaleTextSchema }) });
export const saveTagSchema = z.object({ slug: slugSchema, translations: z.object({ en: taxonomyLocaleTextSchema, ar: taxonomyLocaleTextSchema }) });

export type CreateBlogPostInput = z.infer<typeof createBlogPostSchema>;
export type SaveBlogPostVersionInput = z.infer<typeof saveBlogPostVersionSchema>;
export type BlogActionInput = z.infer<typeof blogActionSchema>;
export type BlogPostsQuery = z.infer<typeof blogPostsQuerySchema>;
export type SaveAuthorInput = z.infer<typeof saveAuthorSchema>;
export type SaveCategoryInput = z.infer<typeof saveCategorySchema>;
export type SaveTagInput = z.infer<typeof saveTagSchema>;

/**
 * SRS §16 Resources ("guides, templates, whitepapers"). Webinars moved to
 * their own Webinar/WebinarVersion models (see schema.prisma's comment) —
 * Resource now covers Guide/Template/Whitepaper only, each downloadable
 * rather than scheduled/live.
 */
const resourceLocaleTextSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000),
});
const resourceTranslationsSchema = z.object({ en: resourceLocaleTextSchema, ar: resourceLocaleTextSchema });

export const createResourceSchema = z.object({
  slug: slugSchema,
  resourceFormat: z.enum(["GUIDE", "TEMPLATE", "WHITEPAPER", "CHECKLIST", "PLAYBOOK"]),
  gated: z.boolean().default(true),
});

export const saveResourceVersionSchema = z.object({
  // Direct-save, matching Blog/Pricing/Careers (see the PATCH handler's
  // docstring): the admin picks the resource's live status on every save
  // instead of going through Draft -> Submit -> Approve -> Publish.
  // ARCHIVED sits alongside DRAFT/PUBLISHED so archiving/restoring a
  // resource is the same Save flow, not a separate workflow action.
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  // Knowledge Center §8.5/§8.6: the downloadable file and the gating
  // decision are both per-asset, admin-controlled facts on Resource
  // itself (not versioned) — same field split as Webinar's gated/
  // downloadFileId-equivalent speakerPhotoId.
  gated: z.boolean().default(true),
  downloadFileId: z.string().trim().min(1).nullable().default(null),
  // Knowledge Center §7 Content Page fields — category/target audience are
  // free-text (admin-authored taxonomy, not a fixed enum); difficulty is
  // optional ("when needed" per spec).
  category: z.string().trim().max(100).nullable().default(null),
  targetAudience: z.string().trim().max(150).nullable().default(null),
  difficultyLevel: z.enum(["Beginner", "Intermediate", "Advanced"]).nullable().default(null),
  relatedResourceSlugs: z.array(z.string().trim().min(1)).default([]),
  translations: resourceTranslationsSchema,
});

export const resourceActionSchema = pageActionSchema;

export const resourcesQuerySchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  resourceFormat: z.enum(["GUIDE", "TEMPLATE", "WHITEPAPER", "CHECKLIST", "PLAYBOOK"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

export type CreateResourceInput = z.infer<typeof createResourceSchema>;
export type SaveResourceVersionInput = z.infer<typeof saveResourceVersionSchema>;
export type ResourceActionInput = z.infer<typeof resourceActionSchema>;
export type ResourcesQuery = z.infer<typeof resourcesQuerySchema>;

const CONTENT_STATUS_VALUES = ["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

/**
 * Knowledge Center §12.3/§19 Documentation — DocCategory is a flat
 * taxonomy, same plain-CRUD shape as Blog's Category (see
 * saveCategorySchema above), just gated by its own `docs` permission
 * module instead of `blog`.
 */
const docCategoryLocaleTextSchema = z.object({ name: z.string().trim().min(1).max(200) });
export const saveDocCategorySchema = z.object({
  slug: slugSchema,
  order: z.number().int().min(0).default(0),
  translations: z.object({ en: docCategoryLocaleTextSchema, ar: docCategoryLocaleTextSchema }),
});
export type SaveDocCategoryInput = z.infer<typeof saveDocCategorySchema>;

/**
 * Knowledge Center §12.3/§19 DocArticle. No versioning and no
 * Submit -> Approve -> Publish workflow (unlike Blog/Resources) —
 * everything lives directly on the one row, direct-save like Resources'
 * PATCH handler, just without the ResourceVersion snapshot underneath it.
 * `content` reuses the exact same ArticleBlock[] shape as Blog's body
 * (articleBlockSchema, defined above) so DocArticle can share
 * BlogBodyEditor verbatim. Title is NOT required here (only max-length),
 * matching Blog's own "a Draft can autosave before every field is
 * filled in" reasoning — the PATCH route's docs:publish gate is what
 * enforces completeness, and only when the requested status is
 * PUBLISHED.
 */
const docArticleLocaleTextSchema = z.object({
  title: z.string().trim().max(200).default(""),
  content: z.array(articleBlockSchema).default([]),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(300).optional(),
});
const docArticleTranslationsSchema = z.object({ en: docArticleLocaleTextSchema, ar: docArticleLocaleTextSchema });

export const createDocArticleSchema = z.object({
  slug: slugSchema,
  // Seeds translations.en.title only — the create modal's one convenience
  // field so the list isn't full of bare slugs immediately after
  // creation; every other field (including the Arabic title) is filled
  // in the editor afterward, same "starts empty, filled in on Save" flow
  // as Blog/Resources.
  title: z.string().trim().max(200).default(""),
  categoryId: z.string().trim().min(1).nullable().default(null),
  parentArticleId: z.string().trim().min(1).nullable().default(null),
});

export const saveDocArticleSchema = z.object({
  // Direct-save, matching Resources (see that PATCH handler's docstring):
  // the admin picks the article's live status on every save. ARCHIVED
  // sits alongside DRAFT/PUBLISHED so archiving/restoring an article is
  // the same Save flow, not a separate workflow action.
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  categoryId: z.string().trim().min(1).nullable().default(null),
  parentArticleId: z.string().trim().min(1).nullable().default(null),
  order: z.number().int().min(0).default(0),
  version: z.string().trim().min(1).max(50).default("1.0"),
  relatedArticleSlugs: z.array(z.string().trim().min(1)).default([]),
  translations: docArticleTranslationsSchema,
});

export const docArticlesQuerySchema = z.object({
  categoryId: z.string().trim().min(1).optional(),
  status: z.enum(CONTENT_STATUS_VALUES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

export type CreateDocArticleInput = z.infer<typeof createDocArticleSchema>;
export type SaveDocArticleInput = z.infer<typeof saveDocArticleSchema>;
export type DocArticlesQuery = z.infer<typeof docArticlesQuerySchema>;

/**
 * Knowledge Center §13.3 API Reference — ApiResourceGroup is a flat
 * taxonomy grouping ApiEndpoints by Resource (Organizations, Users, ...),
 * same shape as DocCategory above, gated by the `api` permission module.
 */
const apiResourceGroupLocaleTextSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).default(""),
});
export const saveApiResourceGroupSchema = z.object({
  slug: slugSchema,
  order: z.number().int().min(0).default(0),
  translations: z.object({ en: apiResourceGroupLocaleTextSchema, ar: apiResourceGroupLocaleTextSchema }),
});
export type SaveApiResourceGroupInput = z.infer<typeof saveApiResourceGroupSchema>;

const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Knowledge Center §13.3/§13.4/§19 ApiEndpoint — explicitly NOT a
 * Blog/Documentation-style article (schema.prisma's own comment on this
 * model, §13.2): parameters/schemas/examples are free-text/JSON-ish
 * fields the admin edits as plain textareas, not a structured schema
 * editor — no attempt is made to parse or validate their contents as
 * real JSON here, matching the "treat as free-text" instruction. Direct
 * -save, same status semantics as DocArticle above.
 */
const apiEndpointLocaleTextSchema = z.object({
  description: z.string().trim().max(5000).default(""),
  pathParameters: z.string().trim().max(5000).default(""),
  queryParameters: z.string().trim().max(5000).default(""),
  requestHeaders: z.string().trim().max(5000).default(""),
  requestBodySchema: z.string().trim().max(10000).default(""),
  responseSchema: z.string().trim().max(10000).default(""),
  statusCodes: z.string().trim().max(5000).default(""),
  errorResponses: z.string().trim().max(5000).default(""),
  requestExample: z.string().trim().max(10000).default(""),
  responseExample: z.string().trim().max(10000).default(""),
});
const apiEndpointTranslationsSchema = z.object({ en: apiEndpointLocaleTextSchema, ar: apiEndpointLocaleTextSchema });

export const createApiEndpointSchema = z.object({
  slug: slugSchema,
  resourceGroupId: z.string().trim().min(1).nullable().default(null),
  method: httpMethodSchema,
  path: z.string().trim().min(1).max(500),
});

export const saveApiEndpointSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  resourceGroupId: z.string().trim().min(1).nullable().default(null),
  method: httpMethodSchema,
  path: z.string().trim().min(1).max(500),
  authRequired: z.boolean().default(true),
  version: z.string().trim().min(1).max(50).default("v1"),
  order: z.number().int().min(0).default(0),
  translations: apiEndpointTranslationsSchema,
});

export const apiEndpointsQuerySchema = z.object({
  resourceGroupId: z.string().trim().min(1).optional(),
  status: z.enum(CONTENT_STATUS_VALUES).optional(),
  method: httpMethodSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

export type CreateApiEndpointInput = z.infer<typeof createApiEndpointSchema>;
export type SaveApiEndpointInput = z.infer<typeof saveApiEndpointSchema>;
export type ApiEndpointsQuery = z.infer<typeof apiEndpointsQuerySchema>;

/**
 * Knowledge Center §9 Webinars — split out from Resource into its own
 * Webinar/WebinarVersion models (see schema.prisma's comment on both).
 * `speakerName`/`speakerTitle`/`speakerCompany` are required (mirroring
 * Blog's title/excerpt: only max-length enforced here, so a Draft can
 * autosave-free mid-edit before every field is filled in — the PATCH
 * route's publish-completeness gate is what actually requires them, and
 * only when the requested status is PUBLISHED). `agenda`/
 * `whatYouWillLearn`/`keyTakeaways` are optional free-text fields (§9.5),
 * same optionality convention as Blog's seoTitle/seoDescription.
 */
const webinarLocaleTextSchema = z.object({
  title: z.string().trim().max(200).default(""),
  description: z.string().trim().max(2000).default(""),
  speakerName: z.string().trim().max(200).default(""),
  speakerTitle: z.string().trim().max(200).default(""),
  speakerCompany: z.string().trim().max(200).default(""),
  agenda: z.string().trim().max(3000).optional(),
  whatYouWillLearn: z.string().trim().max(3000).optional(),
  keyTakeaways: z.string().trim().max(3000).optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(300).optional(),
});
const webinarTranslationsSchema = z.object({ en: webinarLocaleTextSchema, ar: webinarLocaleTextSchema });

export const createWebinarSchema = z.object({
  slug: slugSchema,
  // Optional initial title (English) so a freshly created webinar isn't
  // an anonymous blank row in the list until the admin opens the full
  // editor — same purpose as CustomerStory's customerName at create time.
  title: z.string().trim().max(200).default(""),
  gated: z.boolean().default(true),
  featured: z.boolean().default(false),
});

/**
 * §9.5-9.7: `scheduledAt`/`durationMinutes`/`isOnDemand`/`videoUrl` are
 * versioned WebinarVersion columns (see that model's own schema comment
 * for why), not Webinar columns — same split as PricingVersion's
 * effectiveDate. `gated`/`featured` live on Webinar itself and are saved
 * here the same way Blog's PATCH saves BlogPost.featured directly.
 */
export const saveWebinarVersionSchema = z.object({
  // Webinars direct-save, matching Blog/Resources (see the PATCH handler's
  // docstring): the admin picks the webinar's live status on every save
  // instead of going through Draft -> Submit -> Approve -> Publish.
  // ARCHIVED sits alongside DRAFT/PUBLISHED so archiving/restoring a
  // webinar is the same Save flow, not a separate workflow action.
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  gated: z.boolean().default(true),
  featured: z.boolean().default(false),
  scheduledAt: z.coerce.date().nullable().default(null),
  durationMinutes: z.coerce.number().int().positive().nullable().default(null),
  isOnDemand: z.boolean().default(false),
  videoUrl: z.string().trim().max(500).nullable().default(null),
  category: z.string().trim().max(100).nullable().default(null),
  speakerPhotoId: z.string().trim().min(1).nullable().default(null),
  translations: webinarTranslationsSchema,
});

export const webinarActionSchema = pageActionSchema;

export const webinarsQuerySchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

export type CreateWebinarInput = z.infer<typeof createWebinarSchema>;
export type SaveWebinarVersionInput = z.infer<typeof saveWebinarVersionSchema>;
export type WebinarActionInput = z.infer<typeof webinarActionSchema>;
export type WebinarsQuery = z.infer<typeof webinarsQuerySchema>;

/**
 * Knowledge Center §7.4 CustomerStory — testimonial-style case studies
 * shown on the public site, same direct-save shape as Blog/Resources/
 * Webinars (see CustomerStoryVersion's own schema comment for why
 * `metrics`/testimonial copy live inside `translations` while
 * `testimonialName`/`testimonialTitle`/`testimonialCompany`/
 * `testimonialPhotoId` stay flat). `challenge`/`solution`/`results`/
 * `testimonialQuote` are only max-length enforced here (not required) so
 * a Draft can autosave mid-edit before every field is filled in — the
 * PATCH route's publish-completeness gate is what actually requires them,
 * and only when the requested status is PUBLISHED. `relatedCapabilitySlugs`
 * follows the exact same JSON-string-array convention as
 * BlogPostVersion.relatedPostSlugs (see that field's own schema comment).
 */
const customerStoryMetricSchema = z.object({
  label: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(100),
});

const customerStoryLocaleTextSchema = z.object({
  challenge: z.string().trim().max(5000).default(""),
  solution: z.string().trim().max(5000).default(""),
  results: z.string().trim().max(5000).default(""),
  metrics: z.array(customerStoryMetricSchema).default([]),
  testimonialQuote: z.string().trim().max(2000).default(""),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(300).optional(),
});
const customerStoryTranslationsSchema = z.object({ en: customerStoryLocaleTextSchema, ar: customerStoryLocaleTextSchema });

export const createCustomerStorySchema = z.object({
  slug: slugSchema,
  customerName: z.string().trim().min(1).max(200),
  industry: z.string().trim().min(1).max(200),
  companySize: z.string().trim().max(100).nullable().default(null),
  country: z.string().trim().max(100).nullable().default(null),
  featured: z.boolean().default(false),
});

/**
 * Customer Stories direct-save, matching Blog/Resources/Webinars (see
 * their own PATCH handlers' docstrings): the admin picks the story's live
 * status on every save instead of going through Draft -> Submit -> Approve
 * -> Publish. `customerName`/`customerLogoId`/`industry`/`companySize`/
 * `country`/`featured` live on CustomerStory itself and are saved here the
 * same way Blog's PATCH saves BlogPost.author/featured directly; every
 * other field is versioned onto a new CustomerStoryVersion.
 */
export const saveCustomerStoryVersionSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  customerName: z.string().trim().min(1).max(200),
  customerLogoId: z.string().trim().min(1).nullable().default(null),
  industry: z.string().trim().min(1).max(200),
  companySize: z.string().trim().max(100).nullable().default(null),
  country: z.string().trim().max(100).nullable().default(null),
  featured: z.boolean().default(false),
  testimonialName: z.string().trim().max(200).nullable().default(null),
  testimonialTitle: z.string().trim().max(200).nullable().default(null),
  testimonialCompany: z.string().trim().max(200).nullable().default(null),
  testimonialPhotoId: z.string().trim().min(1).nullable().default(null),
  relatedCapabilitySlugs: z.array(z.string().trim().min(1)).default([]),
  translations: customerStoryTranslationsSchema,
});

export const customerStoryActionSchema = pageActionSchema;

export const customerStoriesQuerySchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  industry: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

export type CreateCustomerStoryInput = z.infer<typeof createCustomerStorySchema>;
export type SaveCustomerStoryVersionInput = z.infer<typeof saveCustomerStoryVersionSchema>;
export type CustomerStoryActionInput = z.infer<typeof customerStoryActionSchema>;
export type CustomerStoriesQuery = z.infer<typeof customerStoriesQuerySchema>;

/**
 * SRS §16 Careers override layer (FR-ADM-029) — see the JobListing model's
 * own schema comment for why this is built as a governed content type.
 * `team`/`location`/`employmentType` are per-locale display text (System
 * A's own messages/*.json translates "Full-time" → "دوام كامل"), same
 * reasoning as ResourceVersion.translations' `speaker` field.
 */
const jobListingLocaleTextSchema = z.object({
  title: z.string().trim().min(1).max(200),
  team: z.string().trim().min(1).max(100),
  location: z.string().trim().min(1).max(200),
  employmentType: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(3000),
  responsibilities: z.array(z.string().trim().min(1).max(500)).default([]),
  qualifications: z.array(z.string().trim().min(1).max(500)).default([]),
  preferredSkills: z.array(z.string().trim().min(1).max(500)).default([]),
});
const jobListingTranslationsSchema = z.object({ en: jobListingLocaleTextSchema, ar: jobListingLocaleTextSchema });

export const createJobListingSchema = z.object({ slug: slugSchema });

export const saveJobListingVersionSchema = z.object({
  // Careers direct-save: the admin explicitly picks the live status on
  // every save instead of Save always requiring a separate publish step
  // (see the PATCH handler's docstring). ARCHIVED is included alongside
  // DRAFT/PUBLISHED so archiving/restoring a listing is the same Save
  // flow, not a separate workflow action.
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  datePosted: z.coerce.date().nullable().default(null),
  translations: jobListingTranslationsSchema,
});

export const jobListingActionSchema = pageActionSchema;

export const jobListingsQuerySchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

export const jobApplicationsQuerySchema = z.object({
  jobListingId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});

export type CreateJobListingInput = z.infer<typeof createJobListingSchema>;
export type SaveJobListingVersionInput = z.infer<typeof saveJobListingVersionSchema>;
export type JobListingActionInput = z.infer<typeof jobListingActionSchema>;
export type JobListingsQuery = z.infer<typeof jobListingsQuerySchema>;

/**
 * SRS §20.1/§20.2 Career Application — one of the nine standard-form lead
 * types (§20.1: "the nine-form inventory... Career Application"), so it
 * becomes a Submission+Lead like every other form, not a dedicated entity
 * — see the career-application ingest route's own comment for the full
 * reasoning. Validated separately from `leadIngestSchema` because this is
 * the one form that arrives as multipart/form-data (a resume file), not JSON.
 */
export const careerApplicationFieldsSchema = z.object({
  jobId: z.string().trim().min(1),
  jobTitle: z.string().trim().min(1),
  fullName: z.string().trim().min(1),
  email: z.string().trim().email(),
  portfolioUrl: z.string().trim().max(500).optional(),
  gender: z.string().trim().max(50).optional(),
  veteranStatus: z.string().trim().max(50).optional(),
});
export type CareerApplicationFieldsInput = z.infer<typeof careerApplicationFieldsSchema>;

/**
 * SRS §18 Media Library. `altText` is required and non-empty — "save is
 * blocked without it" — matching the MediaAsset.altText column's own
 * non-nullable-ness (schema.prisma), enforced again here since the
 * upload route parses multipart form fields by hand, not through this
 * schema's usual JSON-body path.
 */
export const mediaMetadataSchema = z.object({
  altText: z.string().trim().min(1, "Alt text is required."),
  caption: z.string().trim().max(500).optional(),
  folder: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
});

export const updateMediaMetadataSchema = z.object({
  altText: z.string().trim().min(1, "Alt text is required.").optional(),
  caption: z.string().trim().max(500).optional(),
  folder: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  archived: z.boolean().optional(),
});

export const mediaQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  fileType: z.string().trim().min(1).optional(),
  folder: z.string().trim().min(1).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  archived: z.enum(["true", "false", "all"]).default("false"),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(24),
});

export type MediaMetadataInput = z.infer<typeof mediaMetadataSchema>;
export type UpdateMediaMetadataInput = z.infer<typeof updateMediaMetadataSchema>;
export type MediaQuery = z.infer<typeof mediaQuerySchema>;

export type LoginInput = z.infer<typeof loginSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type LeadIngestInput = z.infer<typeof leadIngestSchema>;
export type RoleAssignmentInput = z.infer<typeof roleAssignmentSchema>;
export type RolePermissionsInput = z.infer<typeof rolePermissionsSchema>;
export type ReauthInput = z.infer<typeof reauthSchema>;
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;
export type UpdateAdminUserStatusInput = z.infer<typeof updateAdminUserStatusSchema>;
export type UpdateSettingsGroupInput = z.infer<typeof updateSettingsGroupSchema>;
export type CreateBannerInput = z.infer<typeof createBannerSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
export type LeadsQuery = z.infer<typeof leadsQuerySchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

/**
 * CMS General "Redirects" — admin-managed URL redirects, same
 * settings:manage gate and direct-edit shape as AnnouncementBanner (no
 * draft/publish workflow). `from`/`to` are locale-agnostic path segments
 * starting with "/" — the website prefixes both with the current locale.
 */
const redirectPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((v) => v.startsWith("/"), { message: "Path must start with /" });

export const createRedirectSchema = z.object({
  from: redirectPathSchema,
  to: redirectPathSchema,
  permanent: z.boolean().default(true),
});

export const updateRedirectSchema = z.object({
  to: redirectPathSchema,
  permanent: z.boolean().default(true),
});

export type CreateRedirectInput = z.infer<typeof createRedirectSchema>;
export type UpdateRedirectInput = z.infer<typeof updateRedirectSchema>;

/**
 * Knowledge Center FAQ — same direct-save-with-status shape as
 * DocArticle (see saveDocArticleSchema above), just without a slug or
 * rich-text body: `question`/`answer` are plain strings, `category` is
 * free-text taxonomy matching the small fixed set the website already
 * renders as tabs (Product/Pricing/Security/Support), not a relational FK.
 */
const faqItemLocaleTextSchema = z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(2000),
});
const faqItemTranslationsSchema = z.object({ en: faqItemLocaleTextSchema, ar: faqItemLocaleTextSchema });

export const createFaqItemSchema = z.object({
  category: z.string().trim().min(1).max(100),
  order: z.number().int().min(0).default(0),
  translations: faqItemTranslationsSchema,
});

export const saveFaqItemSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  category: z.string().trim().min(1).max(100),
  order: z.number().int().min(0).default(0),
  translations: faqItemTranslationsSchema,
});

export const faqItemsQuerySchema = z.object({
  category: z.string().trim().min(1).optional(),
  status: z.enum(CONTENT_STATUS_VALUES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(50),
});

export type CreateFaqItemInput = z.infer<typeof createFaqItemSchema>;
export type SaveFaqItemInput = z.infer<typeof saveFaqItemSchema>;
export type FaqItemsQuery = z.infer<typeof faqItemsQuerySchema>;
