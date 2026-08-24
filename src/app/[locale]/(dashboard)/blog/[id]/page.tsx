"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";
import { ActionButton } from "@/components/ui/ActionButton";
import { MediaPicker, type MediaAssetSummary } from "@/components/MediaPicker";
import { BlogBodyEditor } from "@/components/BlogBodyEditor";
import type { ArticleBlock } from "@/lib/blog/article-blocks";

interface LocaleText {
  title: string;
  excerpt: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
  noIndex?: boolean;
  body: ArticleBlock[];
}

interface TaxonomyRow {
  id: string;
  slug: string;
  translations: Record<"en" | "ar", { name: string }>;
}

interface AuthorRow {
  id: string;
  translations: Record<"en" | "ar", { name: string }>;
}

interface BlogPostVersionRow {
  id: string;
  versionNumber: number;
  publishedDate: string | null;
  updatedDate: string | null;
  heroImageId: string | null;
  relatedPostSlugs: string[];
  translations: Record<"en" | "ar", LocaleText>;
  publishedAt: string | null;
  createdAt: string;
  categories: { category: TaxonomyRow }[];
  tags: { tag: TaxonomyRow }[];
}

interface PostDetail {
  id: string;
  slug: string;
  authorId: string | null;
  featured: boolean;
  status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  reviewComment: string | null;
  updatedAt: string;
  currentVersion: BlogPostVersionRow | null;
  versions: BlogPostVersionRow[];
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "notFound" } | { kind: "error" } | { kind: "ready" };

const EMPTY_LOCALE: LocaleText = { title: "", excerpt: "", body: [] };
type MissingKey = "en" | "ar" | "image";
type AutoSaveState = "idle" | "saving" | "saved" | "error";
const AUTO_SAVE_INTERVAL_MS = 30 * 1000;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Content fields autosave is responsible for — deliberately excludes `status`, since autosave never changes it (see performSave). */
interface ContentPayload {
  publishedDate: string | null;
  updatedDate: string | null;
  heroImageId: string | null;
  relatedPostSlugs: string[];
  categoryIds: string[];
  tagIds: string[];
  translations: Record<"en" | "ar", LocaleText>;
}

function snapshotOf(p: ContentPayload): string {
  return JSON.stringify({ ...p, categoryIds: [...p.categoryIds].sort(), tagIds: [...p.tagIds].sort() });
}

export default function BlogPostEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("dashboard.blog");
  const tCommon = useTranslations("common");
  const dashboardLocale = useLocale() as "en" | "ar";
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [post, setPost] = useState<PostDetail | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [categories, setCategories] = useState<TaxonomyRow[]>([]);
  const [tags, setTags] = useState<TaxonomyRow[]>([]);

  const [activeLocale, setActiveLocale] = useState<"en" | "ar">(dashboardLocale);
  const [translations, setTranslations] = useState<Record<"en" | "ar", LocaleText>>({ en: EMPTY_LOCALE, ar: EMPTY_LOCALE });
  const [authorId, setAuthorId] = useState("");
  const [featured, setFeatured] = useState(false);
  const [publishedDate, setPublishedDate] = useState("");
  const [updatedDate, setUpdatedDate] = useState("");
  const [heroImage, setHeroImage] = useState<MediaAssetSummary | null>(null);
  const [heroAltDraft, setHeroAltDraft] = useState("");
  const [heroAltSaving, setHeroAltSaving] = useState(false);
  const [heroAltSaved, setHeroAltSaved] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [showBodyImagePicker, setShowBodyImagePicker] = useState(false);
  const [bodyImageResolver, setBodyImageResolver] = useState<((asset: { url: string; alt: string } | null) => void) | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategorySaving, setNewCategorySaving] = useState(false);
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [newTagSaving, setNewTagSaving] = useState(false);
  const [newTagError, setNewTagError] = useState<string | null>(null);
  const [relatedSlugsText, setRelatedSlugsText] = useState("");

  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED">("DRAFT");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [missingForPublish, setMissingForPublish] = useState<MissingKey[] | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [coercedNotice, setCoercedNotice] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [requestChangesComment, setRequestChangesComment] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");

  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>("idle");
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<Date | null>(null);
  const lastSavedContentRef = useRef<string>("");
  // Interval-driven autosave always calls through this ref rather than a
  // closed-over function, so the cadence stays steady (never reset by
  // typing) while still saving whatever was most recently edited — a plain
  // closure captured once by setInterval would otherwise keep saving the
  // article as it existed when the timer was created.
  const performSaveRef = useRef<(auto: boolean) => Promise<boolean>>(async () => false);

  const load = useCallback(async () => {
    try {
      const [postRes, sessionRes, authorsRes, categoriesRes, tagsRes] = await Promise.all([
        fetch(`/api/admin/blog/posts/${id}`),
        fetch("/api/admin/auth/session"),
        fetch("/api/admin/blog/authors"),
        fetch("/api/admin/blog/categories"),
        fetch("/api/admin/blog/tags"),
      ]);
      if (postRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (postRes.status === 404) {
        setState({ kind: "notFound" });
        return;
      }
      if (!postRes.ok || !sessionRes.ok) {
        setState({ kind: "error" });
        return;
      }
      const postData = await postRes.json();
      const sessionData = await sessionRes.json();
      const authorsData = authorsRes.ok ? await authorsRes.json() : { authors: [] };
      const categoriesData = categoriesRes.ok ? await categoriesRes.json() : { categories: [] };
      const tagsData = tagsRes.ok ? await tagsRes.json() : { tags: [] };

      setPost(postData.post);
      setPermissions(new Set<string>(sessionData.user.permissions));
      setAuthors(authorsData.authors);
      setCategories(categoriesData.categories);
      setTags(tagsData.tags);
      // Any pre-existing legacy workflow status (Submitted/In Review/etc.)
      // collapses to Draft in the selector — Blog now only recognizes
      // Draft, Published, and Archived as directly selectable states.
      // Archived must load as Archived (not collapse to Draft), or a
      // plain Save without touching the dropdown would silently
      // un-archive the post.
      const loadedStatus = postData.post.status === "PUBLISHED" || postData.post.status === "ARCHIVED" ? postData.post.status : "DRAFT";
      setStatus(loadedStatus);

      const version: BlogPostVersionRow | null = postData.post.currentVersion;
      const tr = version?.translations ?? { en: EMPTY_LOCALE, ar: EMPTY_LOCALE };
      const loadedPublishedDate = version?.publishedDate ? version.publishedDate.slice(0, 10) : "";
      const loadedUpdatedDate = version?.updatedDate ? version.updatedDate.slice(0, 10) : "";
      const loadedCategoryIds = (version?.categories ?? []).map((c) => c.category.id);
      const loadedTagIds = (version?.tags ?? []).map((tg) => tg.tag.id);
      const loadedRelatedSlugsText = (version?.relatedPostSlugs ?? []).join("\n");

      setTranslations(tr);
      setAuthorId(postData.post.authorId ?? "");
      setFeatured(postData.post.featured);
      setPublishedDate(loadedPublishedDate);
      setUpdatedDate(loadedUpdatedDate);
      setSelectedCategoryIds(new Set(loadedCategoryIds));
      setSelectedTagIds(new Set(loadedTagIds));
      setRelatedSlugsText(loadedRelatedSlugsText);

      // heroImageId only ever stores a MediaAsset id, never a resolved URL
      // (same contract Pages' block props use) — resolve it once on load
      // so an already-set hero image's thumbnail is visible immediately,
      // not just after re-picking it.
      let loadedHeroImageId: string | null = null;
      if (version?.heroImageId) {
        const heroRes = await fetch(`/api/admin/media/${version.heroImageId}`);
        if (heroRes.ok) {
          const heroData = await heroRes.json();
          setHeroImage(heroData.asset);
          setHeroAltDraft(heroData.asset.altText ?? "");
          loadedHeroImageId = heroData.asset.id;
        } else {
          setHeroImage(null);
          setHeroAltDraft("");
        }
      } else {
        setHeroImage(null);
        setHeroAltDraft("");
      }

      // Baseline for the autosave dirty-check — a tick before any edit
      // happens must never fire a no-op write.
      lastSavedContentRef.current = snapshotOf({
        publishedDate: loadedPublishedDate || null,
        updatedDate: loadedUpdatedDate || null,
        heroImageId: loadedHeroImageId,
        relatedPostSlugs: loadedRelatedSlugsText.split("\n").map((s) => s.trim()).filter(Boolean),
        categoryIds: loadedCategoryIds,
        tagIds: loadedTagIds,
        translations: tr,
      });

      setState({ kind: "ready" });
    } catch {
      setState({ kind: "error" });
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Autosave: a steady 30-second interval, created once the post and the
  // actor's permissions are known, torn down on unmount/navigation. It
  // always invokes the *latest* performSave via performSaveRef (kept fresh
  // on every render below) rather than a value captured when the interval
  // was created, so it saves whatever the admin has actually typed by the
  // time each tick fires.
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (!permissions.has("blog:edit")) return;
    const interval = setInterval(() => {
      void performSaveRef.current(true);
    }, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [state.kind, permissions]);

  // `performSave` is a hoisted function declaration (defined further down,
  // after the early-return guards) — reassigning the ref here, after every
  // render/commit, is what keeps performSaveRef pointing at the version
  // that closes over the current render's state.
  useEffect(() => {
    performSaveRef.current = performSave;
  });

  function hasPerm(action: string): boolean {
    return permissions.has(`blog:${action}`);
  }

  function setLocaleField<K extends keyof LocaleText>(locale: "en" | "ar", key: K, value: LocaleText[K]) {
    setTranslations((prev) => ({ ...prev, [locale]: { ...prev[locale], [key]: value } }));
    setSaveSuccess(false);
  }

  async function handleSaveHeroAlt() {
    if (!heroImage) return;
    setHeroAltSaving(true);
    setHeroAltSaved(false);
    try {
      const res = await fetch(`/api/admin/media/${heroImage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ altText: heroAltDraft.trim() }),
      });
      if (res.ok) {
        setHeroImage((prev) => (prev ? { ...prev, altText: heroAltDraft.trim() } : prev));
        setHeroAltSaved(true);
      }
    } finally {
      setHeroAltSaving(false);
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    setNewCategorySaving(true);
    setNewCategoryError(null);
    try {
      const res = await fetch("/api/admin/blog/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, translations: { en: { name }, ar: { name } } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNewCategoryError(data.error ?? t("newCategoryError"));
        return;
      }
      setCategories((prev) => [...prev, data.category]);
      setSelectedCategoryIds((prev) => new Set(prev).add(data.category.id));
      setNewCategoryName("");
    } catch {
      setNewCategoryError(t("newCategoryError"));
    } finally {
      setNewCategorySaving(false);
    }
  }

  async function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) return;
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    setNewTagSaving(true);
    setNewTagError(null);
    try {
      const res = await fetch("/api/admin/blog/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, translations: { en: { name }, ar: { name } } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNewTagError(data.error ?? t("newTagError"));
        return;
      }
      setTags((prev) => [...prev, data.tag]);
      setSelectedTagIds((prev) => new Set(prev).add(data.tag.id));
      setNewTagName("");
    } catch {
      setNewTagError(t("newTagError"));
    } finally {
      setNewTagSaving(false);
    }
  }

  function requestBodyImage(): Promise<{ url: string; alt: string } | null> {
    return new Promise((resolve) => {
      setBodyImageResolver(() => resolve);
      setShowBodyImagePicker(true);
    });
  }

  /**
   * Single save path shared by the manual Save button and the autosave
   * timer. The two differ only in the `status` they send and in how they
   * react afterward:
   *  - Manual (`auto=false`) always sends whatever the admin has chosen in
   *    the Status dropdown, surfaces the full success/error/missing-fields
   *    feedback, and reloads the post afterward.
   *  - Auto (`auto=true`) NEVER sends the dropdown's value — it preserves
   *    whatever status the post already has (Draft stays Draft, Published
   *    stays Published with its content refreshed, Archived stays
   *    Archived), so it can never publish an article and can never take a
   *    live Published article offline. It's also a no-op when nothing has
   *    changed since the last save (manual or auto), so idle tabs don't
   *    write empty versions every 30 seconds, and it never reloads the page
   *    state mid-edit (which could clobber in-progress typing).
   */
  async function performSave(auto: boolean): Promise<boolean> {
    if (!post) return false;
    if (auto && (saving || autoSaveState === "saving")) return false;

    const targetStatus = auto ? (post.status === "PUBLISHED" ? "PUBLISHED" : post.status === "ARCHIVED" ? "ARCHIVED" : "DRAFT") : status;
    const contentPayload: ContentPayload = {
      publishedDate: publishedDate || null,
      updatedDate: updatedDate || null,
      heroImageId: heroImage?.id ?? null,
      relatedPostSlugs: relatedSlugsText.split("\n").map((s) => s.trim()).filter(Boolean),
      categoryIds: Array.from(selectedCategoryIds),
      tagIds: Array.from(selectedTagIds),
      translations,
    };
    const snapshot = snapshotOf(contentPayload);
    if (auto && snapshot === lastSavedContentRef.current) return false;

    if (auto) {
      setAutoSaveState("saving");
    } else {
      setSaving(true);
      setSaveError(null);
      setMissingForPublish(null);
      setCoercedNotice(false);
    }

    try {
      const res = await fetch(`/api/admin/blog/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus, authorId: authorId || null, featured, ...contentPayload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (auto) {
          setAutoSaveState("error");
        } else if (Array.isArray(data.missing)) {
          setMissingForPublish(data.missing as MissingKey[]);
        } else {
          setSaveError(data.error ?? t("saveError"));
        }
        return false;
      }
      lastSavedContentRef.current = snapshot;
      if (auto) {
        setAutoSaveState("saved");
        setLastAutoSavedAt(new Date());
      } else {
        setSaveSuccess(true);
        setCoercedNotice(Boolean(data.coercedFromPublish));
        setAutoSaveState("idle");
        await load();
      }
      return true;
    } catch {
      if (auto) setAutoSaveState("error");
      else setSaveError(t("saveError"));
      return false;
    } finally {
      if (!auto) setSaving(false);
    }
  }

  async function handleSaveDraft() {
    await performSave(false);
  }

  // Independent workflow actions (Submit/Approve/Request Changes/Schedule/
  // Publish/Archive) — a separate permission-gated action bar from the
  // direct-save Status dropdown above, so an actor holding e.g. only
  // blog:submit (no blog:edit) can still submit a post that was created
  // with full content at creation time, matching Writer's role
  // definition. Same shape as the Pages editor's own runAction.
  async function runAction(body: Record<string, unknown>, pendingKey: string) {
    setActionPending(pendingKey);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/blog/posts/${id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error ?? t("submitError"));
        return;
      }
      await load();
    } catch {
      setActionError(t("submitError"));
    } finally {
      setActionPending(null);
    }
  }

  async function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setActionPending("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/blog/posts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? t("deleteError"));
        return;
      }
      router.push("/blog");
    } catch {
      setActionError(t("deleteError"));
    } finally {
      setActionPending(null);
    }
  }

  if (state.kind === "forbidden") return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  if (state.kind === "notFound") return <p className="text-sm text-neutral-500">{t("notFound")}</p>;
  if (state.kind === "loading") return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  if (state.kind === "error" || !post) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <p className="text-sm text-error">{t("loadError")}</p>
        <button type="button" onClick={() => void load()} className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50">
          {t("retry")}
        </button>
      </div>
    );
  }

  // Blog has no Draft -> Submit -> Approve -> Publish gate: any admin with
  // edit permission can create/edit/save content, but only an actor
  // holding blog:publish can move a post to Published or touch the cover
  // image (§4/§17) — enforced again on the backend PATCH handler, not just
  // here (see its docstring).
  const canEdit = hasPerm("edit");
  const canPublish = hasPerm("publish");
  const canDelete = hasPerm("delete");
  const canArchive = hasPerm("archive");
  const canSubmit = hasPerm("submit");
  const canApprove = hasPerm("approve");
  const canRequestChanges = hasPerm("requestChanges");
  const canSchedule = hasPerm("schedule");
  const heroImageUrl = heroImage?.url ?? null;
  const missingLabels: Record<MissingKey, string> = {
    en: t("publishMissingEnglish"),
    ar: t("publishMissingArabic"),
    image: t("publishMissingImage"),
  };
  const seoTextLocale = translations[activeLocale];
  const contentDir = activeLocale === "ar" ? "rtl" : "ltr";

  const seoPreviewUrl = (seoTextLocale.canonicalUrl || `zynreach.com/blog/${post.slug}`).replace(/^https?:\/\//, "");
  const seoPreviewTitle = seoTextLocale.seoTitle || translations[activeLocale].title || post.slug;
  const seoPreviewDescription = seoTextLocale.seoDescription || translations[activeLocale].excerpt;
  // "Create Article" seeds every new post with a placeholder slug
  // (untitled-<timestamp>) so it can be created before a title exists —
  // there's no slug field anywhere in this editor to replace it with a
  // real one afterward. Showing that raw placeholder under the title once
  // a real title has been typed reads as a broken/unfinished article, so
  // this line falls back to "last saved" (always meaningful) instead —
  // the real slug still appears in the SEO preview section below, and is
  // left completely untouched everywhere else (public URL, SEO, delete
  // audit trail), since changing it would move a post's live URL.
  const hasPlaceholderSlug = /^untitled-\d+$/.test(post.slug);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/blog" className="text-sm text-primary-600 hover:underline">
            ← {t("backToList")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-neutral-900">
            {translations[dashboardLocale].title || translations.en.title || post.slug}
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {hasPlaceholderSlug ? t("lastSavedLabel", { date: new Date(post.updatedAt).toLocaleString() }) : `/${post.slug}`}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">{t(`status.${post.status}`)}</span>
      </div>

      {post.status === "CHANGES_REQUESTED" && post.reviewComment ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">{t("reviewCommentLabel")}</p>
          <p className="mt-0.5">{post.reviewComment}</p>
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {actionError}
        </div>
      ) : null}

      {/* Publish bar: status, Save, and all save/autosave feedback live together at the top so they're never missed while scrolling a long article. */}
      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-4">
        {canEdit ? <p className="text-xs text-neutral-400">{t("autoSaveHint")}</p> : null}

        {saveError ? (
          <div role="alert" className="mt-3 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {saveError}
          </div>
        ) : null}
        {missingForPublish && missingForPublish.length > 0 ? (
          <div role="alert" className="mt-3 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            <p className="font-medium">{t("publishBlockedTitle")}</p>
            <p className="mt-0.5">
              {t("publishMissingListPrefix")}
              {missingForPublish.map((k) => missingLabels[k]).join(", ")}.
            </p>
          </div>
        ) : null}
        {saveSuccess && coercedNotice ? (
          <div role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("savedAsDraftNotice")}
          </div>
        ) : saveSuccess ? (
          <div role="status" className="mt-3 rounded-md bg-success-bg px-3 py-2 text-sm text-success">
            {t("saveSuccess")}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[10rem]">
            <label className="block text-sm font-medium text-neutral-700">{t("statusSelectorLabel")}</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "DRAFT" | "PUBLISHED" | "ARCHIVED");
                setSaveSuccess(false);
              }}
              disabled={!canEdit || !canPublish}
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            >
              <option value="DRAFT">{t("status.DRAFT")}</option>
              {canPublish ? <option value="PUBLISHED">{t("status.PUBLISHED")}</option> : null}
              {canArchive ? <option value="ARCHIVED">{t("status.ARCHIVED")}</option> : null}
            </select>
          </div>

          {canEdit ? (
            <button
              type="button"
              onClick={() => void handleSaveDraft()}
              disabled={saving}
              className="min-h-9 rounded-md bg-primary-600 px-5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? t("saving") : t("saveDraft")}
            </button>
          ) : null}

          <div className="min-h-9 flex items-center text-xs text-neutral-500">
            {autoSaveState === "saving" ? t("autoSaveSaving") : null}
            {autoSaveState === "saved" && lastAutoSavedAt
              ? t("autoSaveSaved", { time: lastAutoSavedAt.toLocaleTimeString(dashboardLocale === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }) })
              : null}
            {autoSaveState === "error" ? <span className="text-amber-600">{t("autoSaveError")}</span> : null}
          </div>
        </div>
        {canEdit && !canPublish ? <p className="mt-2 text-xs text-neutral-500">{t("cannotPublishRole")}</p> : null}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("postFieldsTitle")}</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("authorLabel")}</label>
            <select
              value={authorId}
              onChange={(e) => setAuthorId(e.target.value)}
              disabled={!canEdit}
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            >
              <option value="">{t("noAuthor")}</option>
              {authors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.translations[dashboardLocale]?.name || a.translations.en.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("publishedDateLabel")}</label>
            <input
              type="date"
              value={publishedDate}
              onChange={(e) => setPublishedDate(e.target.value)}
              disabled={!canEdit}
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("updatedDateLabel")}</label>
            <input
              type="date"
              value={updatedDate}
              onChange={(e) => setUpdatedDate(e.target.value)}
              disabled={!canEdit}
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} disabled={!canEdit} />
            {t("featuredLabel")}
          </label>
        </div>
      </div>

      {/* Article content — the main writing workspace. */}
      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <div className="flex gap-1 border-b border-neutral-200">
          {(["en", "ar"] as const).map((locale) => (
            <button
              key={locale}
              type="button"
              onClick={() => setActiveLocale(locale)}
              className={`min-h-9 px-3 text-sm font-medium ${activeLocale === locale ? "border-b-2 border-primary-600 text-primary-700" : "text-neutral-500 hover:text-neutral-700"}`}
            >
              {locale === "en" ? t("localeEnglish") : t("localeArabic")}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <TextField
            label={t("titleLabel")}
            name="title"
            value={translations[activeLocale].title}
            onChange={(v) => setLocaleField(activeLocale, "title", v)}
            required={false}
            disabled={!canEdit}
            dir={contentDir}
          />
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("excerptLabel")}</label>
            <textarea
              value={translations[activeLocale].excerpt}
              onChange={(e) => setLocaleField(activeLocale, "excerpt", e.target.value)}
              disabled={!canEdit}
              rows={2}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("bodyLabel")}</label>
            <BlogBodyEditor
              key={activeLocale}
              value={translations[activeLocale].body}
              onChange={(blocks) => setLocaleField(activeLocale, "body", blocks)}
              disabled={!canEdit}
              dir={contentDir}
              onRequestImage={requestBodyImage}
            />
          </div>
        </div>
      </div>

      {/* Cover image — directly under the content, per the required Article Content -> Cover Image -> Alt Text -> Categories -> Tags -> SEO order. */}
      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("heroImageLabel")}</h2>
        <div className="mt-3">
          {heroImageUrl ? (
            <div className="overflow-hidden rounded-lg border border-neutral-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImageUrl} alt="" className="aspect-[16/9] w-full object-cover" />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 bg-neutral-50 px-3 py-2">
                <p className="truncate text-xs text-neutral-500">
                  {heroImage?.filename}
                  {heroImage?.width && heroImage?.height ? ` · ${heroImage.width}×${heroImage.height}` : ""}
                  {heroImage?.fileSize ? ` · ${formatFileSize(heroImage.fileSize)}` : ""}
                </p>
                <div className="flex shrink-0 gap-1">
                  <ActionButton tone="neutral-bordered" size="xs" onClick={() => setShowMediaPicker(true)} disabled={!canEdit || !canPublish}>
                    {t("changeHeroImage")}
                  </ActionButton>
                  <ActionButton
                    tone="danger"
                    size="xs"
                    onClick={() => {
                      setHeroImage(null);
                      setHeroAltDraft("");
                    }}
                    disabled={!canEdit || !canPublish}
                  >
                    {t("removeHeroImage")}
                  </ActionButton>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowMediaPicker(true)}
              disabled={!canEdit || !canPublish}
              className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-neutral-300 text-neutral-500 hover:border-primary-400 hover:bg-primary-50/40 hover:text-primary-600 disabled:opacity-60"
            >
              <span className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white">{t("chooseHeroImageFile")}</span>
              <span className="text-xs text-neutral-400">{t("noCoverImageHint")}</span>
            </button>
          )}
          {!canPublish ? <p className="mt-2 text-xs text-neutral-500">{t("cannotChangeImageRole")}</p> : null}

          {heroImage ? (
            <div className="mt-4 max-w-md">
              <label className="block text-sm font-medium text-neutral-700">{t("heroImageAltLabel")}</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  type="text"
                  value={heroAltDraft}
                  onChange={(e) => {
                    setHeroAltDraft(e.target.value);
                    setHeroAltSaved(false);
                  }}
                  placeholder={t("heroImageAltPlaceholder")}
                  disabled={!canEdit || !canPublish}
                  className="min-h-9 flex-1 rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveHeroAlt()}
                  disabled={!canEdit || !canPublish || heroAltSaving || heroAltDraft === (heroImage.altText ?? "")}
                  className="min-h-9 shrink-0 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {t("save")}
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-500">{t("heroImageAltRequiredHint")}</p>
              {heroAltSaved ? <p className="mt-1 text-xs text-success">{t("heroImageAltSaved")}</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("categoriesLabel")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {categories.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={selectedCategoryIds.has(c.id)}
                onChange={(e) =>
                  setSelectedCategoryIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  })
                }
                disabled={!canEdit}
              />
              {c.translations[dashboardLocale]?.name || c.translations.en.name}
            </label>
          ))}
        </div>
        {canEdit ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={t("newCategoryPlaceholder")}
              disabled={newCategorySaving}
              className="min-h-8 flex-1 max-w-xs rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
            <button
              type="button"
              onClick={() => void handleCreateCategory()}
              disabled={newCategorySaving || !newCategoryName.trim()}
              className="min-h-8 shrink-0 rounded-md bg-primary-600 px-2.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {newCategorySaving ? t("newCategorySaving") : t("newCategoryAdd")}
            </button>
          </div>
        ) : null}
        {newCategoryError ? <p className="mt-1 text-xs text-error">{newCategoryError}</p> : null}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("tagsLabel")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {tags.map((tg) => (
            <label key={tg.id} className="flex items-center gap-1.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={selectedTagIds.has(tg.id)}
                onChange={(e) =>
                  setSelectedTagIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(tg.id);
                    else next.delete(tg.id);
                    return next;
                  })
                }
                disabled={!canEdit}
              />
              {tg.translations[dashboardLocale]?.name || tg.translations.en.name}
            </label>
          ))}
        </div>
        {canEdit ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder={t("newTagPlaceholder")}
              disabled={newTagSaving}
              className="min-h-8 flex-1 max-w-xs rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
            <button
              type="button"
              onClick={() => void handleCreateTag()}
              disabled={newTagSaving || !newTagName.trim()}
              className="min-h-8 shrink-0 rounded-md bg-primary-600 px-2.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {newTagSaving ? t("newTagSaving") : t("newTagAdd")}
            </button>
          </div>
        ) : null}
        {newTagError ? <p className="mt-1 text-xs text-error">{newTagError}</p> : null}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("relatedSlugsLabel")}</h2>
        <textarea
          value={relatedSlugsText}
          onChange={(e) => setRelatedSlugsText(e.target.value)}
          disabled={!canEdit}
          rows={3}
          className="mt-3 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
        />
        <p className="mt-1 text-xs text-neutral-500">{t("relatedSlugsHint")}</p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("seoSectionTitle")}</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("seoTitleLabel")}</label>
            <input
              type="text"
              value={seoTextLocale.seoTitle ?? ""}
              onChange={(e) => setLocaleField(activeLocale, "seoTitle", e.target.value)}
              disabled={!canEdit}
              dir={contentDir}
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="mt-1 text-xs text-neutral-500">{t("seoTitleHint", { count: (seoTextLocale.seoTitle ?? "").length })}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("seoDescriptionLabel")}</label>
            <textarea
              value={seoTextLocale.seoDescription ?? ""}
              onChange={(e) => setLocaleField(activeLocale, "seoDescription", e.target.value)}
              disabled={!canEdit}
              rows={2}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="mt-1 text-xs text-neutral-500">{t("seoDescriptionHint", { count: (seoTextLocale.seoDescription ?? "").length })}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("canonicalUrlLabel")}</label>
            <input
              type="text"
              value={seoTextLocale.canonicalUrl ?? ""}
              onChange={(e) => setLocaleField(activeLocale, "canonicalUrl", e.target.value)}
              disabled={!canEdit}
              placeholder="https://…"
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="mt-1 text-xs text-neutral-500">{t("canonicalUrlHint")}</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={seoTextLocale.noIndex ?? false}
              onChange={(e) => setLocaleField(activeLocale, "noIndex", e.target.checked)}
              disabled={!canEdit}
            />
            {t("noIndexLabel")}
          </label>

          {seoPreviewTitle ? (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-medium text-neutral-500">{t("seoPreviewTitle")}</p>
              <p className="mt-1.5 truncate text-xs text-neutral-500">{seoPreviewUrl}</p>
              <p className="mt-0.5 truncate text-sm text-primary-700">{seoPreviewTitle}</p>
              {seoPreviewDescription ? <p className="mt-0.5 line-clamp-2 text-xs text-neutral-600">{seoPreviewDescription}</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("actionsHeader")}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canSubmit ? (
            <button
              type="button"
              onClick={() => void runAction({ action: "submit" }, "submit")}
              disabled={actionPending !== null}
              className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              {actionPending === "submit" ? t("submitting") : t("submit")}
            </button>
          ) : null}
          {canApprove ? (
            <button
              type="button"
              onClick={() => void runAction({ action: "approve" }, "approve")}
              disabled={actionPending !== null}
              className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              {actionPending === "approve" ? t("approving") : t("approve")}
            </button>
          ) : null}
          {canRequestChanges ? (
            <button
              type="button"
              onClick={() => setShowRequestChanges(true)}
              disabled={actionPending !== null}
              className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              {t("requestChanges")}
            </button>
          ) : null}
          {canSchedule ? (
            <button
              type="button"
              onClick={() => setShowSchedule(true)}
              disabled={actionPending !== null}
              className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              {t("schedule")}
            </button>
          ) : null}
          {canArchive ? (
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined" && !window.confirm(t("archiveConfirm"))) return;
                void runAction({ action: "archive" }, "archive");
              }}
              disabled={actionPending !== null}
              className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              {actionPending === "archive" ? t("archiving") : t("archive")}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={actionPending !== null}
              className="min-h-9 rounded-md px-3 text-sm font-medium text-error hover:bg-error-bg"
            >
              {actionPending === "delete" ? t("deleting") : t("delete")}
            </button>
          ) : null}
        </div>

        {showRequestChanges ? (
          <div className="mt-4 rounded-md border border-neutral-200 p-3">
            <label className="block text-sm font-medium text-neutral-700">{t("commentLabel")}</label>
            <textarea
              value={requestChangesComment}
              onChange={(e) => setRequestChangesComment(e.target.value)}
              rows={3}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowRequestChanges(false);
                  setRequestChangesComment("");
                }}
                className="min-h-8 rounded-md px-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!requestChangesComment.trim()) {
                    setActionError(t("commentRequired"));
                    return;
                  }
                  await runAction({ action: "requestChanges", comment: requestChangesComment }, "requestChanges");
                  setShowRequestChanges(false);
                  setRequestChangesComment("");
                }}
                disabled={actionPending !== null}
                className="min-h-8 rounded-md bg-primary-600 px-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {actionPending === "requestChanges" ? t("requestingChanges") : t("requestChanges")}
              </button>
            </div>
          </div>
        ) : null}

        {showSchedule ? (
          <div className="mt-4 rounded-md border border-neutral-200 p-3">
            <label className="block text-sm font-medium text-neutral-700">{t("scheduledForLabel")}</label>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="mt-1.5 block rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSchedule(false)}
                className="min-h-8 rounded-md px-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!scheduledFor) return;
                  await runAction({ action: "schedule", scheduledFor: new Date(scheduledFor).toISOString() }, "schedule");
                  setShowSchedule(false);
                }}
                disabled={actionPending !== null}
                className="min-h-8 rounded-md bg-primary-600 px-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {actionPending === "schedule" ? t("scheduling") : t("schedule")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("versionHistoryTitle")}</h2>
        <ul className="mt-3 divide-y divide-neutral-100">
          {post.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-neutral-800">{t("versionNumber", { n: v.versionNumber })}</span>
                <span className="ms-2 text-neutral-500">{t("versionCreatedAt", { date: new Date(v.createdAt).toLocaleString() })}</span>
                {v.publishedAt ? (
                  <span className="ms-2 text-emerald-700">{t("versionPublishedLabel", { date: new Date(v.publishedAt).toLocaleString() })}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {showMediaPicker ? (
        <MediaPicker
          onSelect={(asset) => {
            setHeroImage(asset);
            setHeroAltDraft(asset.altText ?? "");
            setShowMediaPicker(false);
          }}
          onClose={() => setShowMediaPicker(false)}
          applyWatermark
        />
      ) : null}

      {showBodyImagePicker ? (
        <MediaPicker
          onSelect={(asset) => {
            bodyImageResolver?.({ url: asset.url, alt: asset.altText });
            setShowBodyImagePicker(false);
            setBodyImageResolver(null);
          }}
          onClose={() => {
            bodyImageResolver?.(null);
            setShowBodyImagePicker(false);
            setBodyImageResolver(null);
          }}
        />
      ) : null}
    </div>
  );
}
