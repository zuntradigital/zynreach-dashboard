"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";
import { ActionButton } from "@/components/ui/ActionButton";
import { MediaPicker, type MediaAssetSummary } from "@/components/MediaPicker";

interface Metric {
  label: string;
  value: string;
}

interface LocaleText {
  challenge: string;
  solution: string;
  results: string;
  metrics: Metric[];
  testimonialQuote: string;
  seoTitle?: string;
  seoDescription?: string;
}

interface CustomerStoryVersionRow {
  id: string;
  versionNumber: number;
  testimonialName: string | null;
  testimonialTitle: string | null;
  testimonialCompany: string | null;
  testimonialPhotoId: string | null;
  testimonialPhoto: MediaAssetSummary | null;
  relatedCapabilitySlugs: string[];
  translations: Record<"en" | "ar", LocaleText>;
  publishedAt: string | null;
  createdAt: string;
}

interface ApprovalRow {
  id: string;
  decision: "APPROVE" | "REQUEST_CHANGES";
  comment: string | null;
  decidedAt: string;
  actor: { name: string; email: string } | null;
}

interface CustomerStoryDetail {
  id: string;
  slug: string;
  customerName: string;
  customerLogoId: string | null;
  industry: string;
  companySize: string | null;
  country: string | null;
  featured: boolean;
  status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  reviewComment: string | null;
  currentVersion: CustomerStoryVersionRow | null;
  versions: CustomerStoryVersionRow[];
  approvals: ApprovalRow[];
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "notFound" } | { kind: "error" } | { kind: "ready" };
type MissingKey = "en" | "ar";

const EMPTY_LOCALE: LocaleText = { challenge: "", solution: "", results: "", metrics: [], testimonialQuote: "" };

function metricsToText(metrics: Metric[]): string {
  return metrics.map((m) => `${m.label}: ${m.value}`).join("\n");
}

function textToMetrics(text: string): Metric[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...rest] = line.split(":");
      return { label: (label ?? "").trim(), value: rest.join(":").trim() };
    })
    .filter((m) => m.label && m.value);
}

export default function CustomerStoryEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("dashboard.customerStories");
  const tCommon = useTranslations("common");
  const dashboardLocale = useLocale() as "en" | "ar";
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [story, setStory] = useState<CustomerStoryDetail | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());

  const [activeLocale, setActiveLocale] = useState<"en" | "ar">(dashboardLocale);
  const [translations, setTranslations] = useState<Record<"en" | "ar", LocaleText>>({ en: EMPTY_LOCALE, ar: EMPTY_LOCALE });
  const [customerName, setCustomerName] = useState("");
  const [industry, setIndustry] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [country, setCountry] = useState("");
  const [featured, setFeatured] = useState(false);
  const [testimonialName, setTestimonialName] = useState("");
  const [testimonialTitle, setTestimonialTitle] = useState("");
  const [testimonialCompany, setTestimonialCompany] = useState("");
  const [relatedSlugsText, setRelatedSlugsText] = useState("");
  const [customerLogo, setCustomerLogo] = useState<MediaAssetSummary | null>(null);
  const [testimonialPhoto, setTestimonialPhoto] = useState<MediaAssetSummary | null>(null);
  const [showLogoPicker, setShowLogoPicker] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);

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

  const load = useCallback(async () => {
    try {
      const [storyRes, sessionRes] = await Promise.all([fetch(`/api/admin/customer-stories/${id}`), fetch("/api/admin/auth/session")]);
      if (storyRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (storyRes.status === 404) {
        setState({ kind: "notFound" });
        return;
      }
      if (!storyRes.ok || !sessionRes.ok) {
        setState({ kind: "error" });
        return;
      }
      const storyData = await storyRes.json();
      const sessionData = await sessionRes.json();

      setStory(storyData.story);
      setPermissions(new Set<string>(sessionData.user.permissions));
      const loadedStatus = storyData.story.status === "PUBLISHED" || storyData.story.status === "ARCHIVED" ? storyData.story.status : "DRAFT";
      setStatus(loadedStatus);

      const version: CustomerStoryVersionRow | null = storyData.story.currentVersion;
      setTranslations(version?.translations ?? { en: EMPTY_LOCALE, ar: EMPTY_LOCALE });
      setCustomerName(storyData.story.customerName);
      setIndustry(storyData.story.industry);
      setCompanySize(storyData.story.companySize ?? "");
      setCountry(storyData.story.country ?? "");
      setFeatured(storyData.story.featured);
      setTestimonialName(version?.testimonialName ?? "");
      setTestimonialTitle(version?.testimonialTitle ?? "");
      setTestimonialCompany(version?.testimonialCompany ?? "");
      setRelatedSlugsText((version?.relatedCapabilitySlugs ?? []).join("\n"));
      setCustomerLogo(storyData.story.customerLogo ?? null);
      setTestimonialPhoto(version?.testimonialPhoto ?? null);

      setState({ kind: "ready" });
    } catch {
      setState({ kind: "error" });
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function hasPerm(action: string): boolean {
    return permissions.has(`customerStories:${action}`);
  }

  function setLocaleField<K extends keyof LocaleText>(locale: "en" | "ar", key: K, value: LocaleText[K]) {
    setTranslations((prev) => ({ ...prev, [locale]: { ...prev[locale], [key]: value } }));
    setSaveSuccess(false);
  }

  async function handleSaveDraft() {
    setSaving(true);
    setSaveError(null);
    setMissingForPublish(null);
    setCoercedNotice(false);
    try {
      const res = await fetch(`/api/admin/customer-stories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          customerName,
          customerLogoId: customerLogo?.id ?? null,
          industry,
          companySize: companySize || null,
          country: country || null,
          featured,
          testimonialName: testimonialName || null,
          testimonialTitle: testimonialTitle || null,
          testimonialCompany: testimonialCompany || null,
          testimonialPhotoId: testimonialPhoto?.id ?? null,
          relatedCapabilitySlugs: relatedSlugsText.split("\n").map((s) => s.trim()).filter(Boolean),
          translations,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(data.missing)) {
          setMissingForPublish(data.missing as MissingKey[]);
        } else {
          setSaveError(data.error ?? t("saveError"));
        }
        return;
      }
      setSaveSuccess(true);
      setCoercedNotice(Boolean(data.coercedFromPublish));
      await load();
    } catch {
      setSaveError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function runAction(body: Record<string, unknown>, pendingKey: string) {
    setActionPending(pendingKey);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/customer-stories/${id}/actions`, {
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
      const res = await fetch(`/api/admin/customer-stories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? t("deleteError"));
        return;
      }
      router.push("/customer-stories");
    } catch {
      setActionError(t("deleteError"));
    } finally {
      setActionPending(null);
    }
  }

  if (state.kind === "forbidden") return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  if (state.kind === "notFound") return <p className="text-sm text-neutral-500">{t("notFound")}</p>;
  if (state.kind === "loading") return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  if (state.kind === "error" || !story) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <p className="text-sm text-error">{t("loadError")}</p>
        <button type="button" onClick={() => void load()} className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50">
          {t("retry")}
        </button>
      </div>
    );
  }

  const canEdit = hasPerm("edit");
  const canDelete = hasPerm("delete");
  const canArchive = hasPerm("archive");
  const canSubmit = hasPerm("submit");
  const canApprove = hasPerm("approve");
  const canRequestChanges = hasPerm("requestChanges");
  const canSchedule = hasPerm("schedule");
  const canPublish = hasPerm("publish");
  const canRollback = hasPerm("rollback");
  const contentDir = activeLocale === "ar" ? "rtl" : "ltr";
  const missingLabels: Record<MissingKey, string> = { en: t("publishMissingEnglish"), ar: t("publishMissingArabic") };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/customer-stories" className="text-sm text-primary-600 hover:underline">
            ← {t("backToList")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-neutral-900">{customerName || story.slug}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">/{story.slug}</p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">{t(`status.${story.status}`)}</span>
      </div>

      {story.status === "CHANGES_REQUESTED" && story.reviewComment ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">{t("reviewCommentLabel")}</p>
          <p className="mt-0.5">{story.reviewComment}</p>
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {actionError}
        </div>
      ) : null}

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        {saveError ? (
          <div role="alert" className="mb-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {saveError}
          </div>
        ) : null}
        {missingForPublish && missingForPublish.length > 0 ? (
          <div role="alert" className="mb-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            <p className="font-medium">{t("publishBlockedTitle")}</p>
            <p className="mt-0.5">
              {t("publishMissingListPrefix")}
              {missingForPublish.map((k) => missingLabels[k]).join(", ")}.
            </p>
          </div>
        ) : null}
        {saveSuccess && coercedNotice ? (
          <div role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("savedAsDraftNotice")}
          </div>
        ) : saveSuccess ? (
          <div role="status" className="mb-4 rounded-md bg-success-bg px-3 py-2 text-sm text-success">
            {t("saveSuccess")}
          </div>
        ) : null}

        <div className="mb-4 max-w-xs">
          <label className="block text-sm font-medium text-neutral-700">{t("statusSelectorLabel")}</label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "DRAFT" | "PUBLISHED" | "ARCHIVED");
              setSaveSuccess(false);
            }}
            disabled={!canEdit}
            className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900 disabled:bg-neutral-50"
          >
            <option value="DRAFT">{t("status.DRAFT")}</option>
            {canPublish ? <option value="PUBLISHED">{t("status.PUBLISHED")}</option> : null}
            {canArchive ? <option value="ARCHIVED">{t("status.ARCHIVED")}</option> : null}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label={t("customerNameLabel")} name="customerName" value={customerName} onChange={setCustomerName} required disabled={!canEdit} />
          <TextField label={t("industryLabel")} name="industry" value={industry} onChange={setIndustry} required disabled={!canEdit} />
          <TextField label={t("companySizeLabel")} name="companySize" value={companySize} onChange={setCompanySize} required={false} disabled={!canEdit} />
          <TextField label={t("countryLabel")} name="country" value={country} onChange={setCountry} required={false} disabled={!canEdit} />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} disabled={!canEdit} />
          {t("featuredLabel")}
        </label>

        <div className="mt-4">
          <label className="block text-sm font-medium text-neutral-700">{t("customerLogoLabel")}</label>
          <div className="mt-1.5 flex items-center gap-3">
            {customerLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={customerLogo.url} alt="" className="h-12 w-12 rounded border border-neutral-200 object-contain" />
            ) : null}
            <ActionButton tone="neutral-bordered" size="sm" onClick={() => setShowLogoPicker(true)} disabled={!canEdit}>
              {customerLogo ? t("changeLogo") : t("chooseLogo")}
            </ActionButton>
            {customerLogo ? (
              <ActionButton tone="danger" size="sm" onClick={() => setCustomerLogo(null)} disabled={!canEdit}>
                {t("removeLogo")}
              </ActionButton>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex gap-1 border-b border-neutral-200">
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
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("challengeLabel")}</label>
            <textarea
              value={translations[activeLocale].challenge}
              onChange={(e) => setLocaleField(activeLocale, "challenge", e.target.value)}
              disabled={!canEdit}
              rows={3}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("solutionLabel")}</label>
            <textarea
              value={translations[activeLocale].solution}
              onChange={(e) => setLocaleField(activeLocale, "solution", e.target.value)}
              disabled={!canEdit}
              rows={3}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("resultsLabel")}</label>
            <textarea
              value={translations[activeLocale].results}
              onChange={(e) => setLocaleField(activeLocale, "results", e.target.value)}
              disabled={!canEdit}
              rows={3}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("metricsLabel")}</label>
            <textarea
              value={metricsToText(translations[activeLocale].metrics)}
              onChange={(e) => setLocaleField(activeLocale, "metrics", textToMetrics(e.target.value))}
              disabled={!canEdit}
              rows={3}
              dir={contentDir}
              placeholder={t("metricsPlaceholder")}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="mt-1 text-xs text-neutral-500">{t("metricsHint")}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("testimonialQuoteLabel")}</label>
            <textarea
              value={translations[activeLocale].testimonialQuote}
              onChange={(e) => setLocaleField(activeLocale, "testimonialQuote", e.target.value)}
              disabled={!canEdit}
              rows={3}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("seoTitleLabel")}</label>
            <input
              type="text"
              value={translations[activeLocale].seoTitle ?? ""}
              onChange={(e) => setLocaleField(activeLocale, "seoTitle", e.target.value)}
              disabled={!canEdit}
              dir={contentDir}
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("seoDescriptionLabel")}</label>
            <textarea
              value={translations[activeLocale].seoDescription ?? ""}
              onChange={(e) => setLocaleField(activeLocale, "seoDescription", e.target.value)}
              disabled={!canEdit}
              rows={2}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("testimonialSectionTitle")}</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label={t("testimonialNameLabel")} name="testimonialName" value={testimonialName} onChange={setTestimonialName} required={false} disabled={!canEdit} />
          <TextField label={t("testimonialTitleLabel")} name="testimonialTitle" value={testimonialTitle} onChange={setTestimonialTitle} required={false} disabled={!canEdit} />
          <TextField label={t("testimonialCompanyLabel")} name="testimonialCompany" value={testimonialCompany} onChange={setTestimonialCompany} required={false} disabled={!canEdit} />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-neutral-700">{t("testimonialPhotoLabel")}</label>
          <div className="mt-1.5 flex items-center gap-3">
            {testimonialPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={testimonialPhoto.url} alt="" className="h-12 w-12 rounded-full border border-neutral-200 object-cover" />
            ) : null}
            <ActionButton tone="neutral-bordered" size="sm" onClick={() => setShowPhotoPicker(true)} disabled={!canEdit}>
              {testimonialPhoto ? t("changePhoto") : t("choosePhoto")}
            </ActionButton>
            {testimonialPhoto ? (
              <ActionButton tone="danger" size="sm" onClick={() => setTestimonialPhoto(null)} disabled={!canEdit}>
                {t("removePhoto")}
              </ActionButton>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("relatedCapabilitiesTitle")}</h2>
        <textarea
          value={relatedSlugsText}
          onChange={(e) => setRelatedSlugsText(e.target.value)}
          disabled={!canEdit}
          rows={3}
          className="mt-3 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
        />
        <p className="mt-1 text-xs text-neutral-500">{t("relatedCapabilitiesHint")}</p>
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
          {story.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-neutral-800">{t("versionNumber", { n: v.versionNumber })}</span>
                <span className="ms-2 text-neutral-500">{t("versionCreatedAt", { date: new Date(v.createdAt).toLocaleString() })}</span>
                {v.publishedAt ? (
                  <span className="ms-2 text-emerald-700">{t("versionPublishedLabel", { date: new Date(v.publishedAt).toLocaleString() })}</span>
                ) : null}
              </div>
              {canRollback && v.id !== story.currentVersion?.id ? (
                <ActionButton
                  onClick={() => {
                    if (typeof window !== "undefined" && !window.confirm(t("rollbackConfirm"))) return;
                    void runAction({ action: "rollback", versionId: v.id }, `rollback-${v.id}`);
                  }}
                  disabled={actionPending !== null}
                >
                  {t("rollback")}
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("approvalHistoryTitle")}</h2>
        {story.approvals.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">{t("noApprovals")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {story.approvals.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <span className="font-medium text-neutral-800">{a.decision === "APPROVE" ? t("decisionApprove") : t("decisionRequestChanges")}</span>
                <span className="ms-2 text-neutral-500">
                  {a.actor?.name ?? "—"} · {new Date(a.decidedAt).toLocaleString()}
                </span>
                {a.comment ? <p className="mt-0.5 text-neutral-600">{a.comment}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {showLogoPicker ? (
        <MediaPicker
          onSelect={(asset) => {
            setCustomerLogo(asset);
            setShowLogoPicker(false);
          }}
          onClose={() => setShowLogoPicker(false)}
        />
      ) : null}

      {showPhotoPicker ? (
        <MediaPicker
          onSelect={(asset) => {
            setTestimonialPhoto(asset);
            setShowPhotoPicker(false);
          }}
          onClose={() => setShowPhotoPicker(false)}
        />
      ) : null}
    </div>
  );
}
