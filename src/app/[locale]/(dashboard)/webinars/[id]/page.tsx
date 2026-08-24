"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";
import { ActionButton } from "@/components/ui/ActionButton";
import { MediaPicker, type MediaAssetSummary } from "@/components/MediaPicker";

interface LocaleText {
  title: string;
  description: string;
  speakerName: string;
  speakerTitle: string;
  speakerCompany: string;
  agenda?: string;
  whatYouWillLearn?: string;
  keyTakeaways?: string;
  seoTitle?: string;
  seoDescription?: string;
}

interface WebinarVersionRow {
  id: string;
  versionNumber: number;
  scheduledAt: string | null;
  durationMinutes: number | null;
  isOnDemand: boolean;
  videoUrl: string | null;
  category: string | null;
  speakerPhotoId: string | null;
  speakerPhoto: MediaAssetSummary | null;
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

interface WebinarDetail {
  id: string;
  slug: string;
  gated: boolean;
  featured: boolean;
  status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  reviewComment: string | null;
  currentVersion: WebinarVersionRow | null;
  versions: WebinarVersionRow[];
  approvals: ApprovalRow[];
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "notFound" } | { kind: "error" } | { kind: "ready" };
type MissingKey = "en" | "ar";

const EMPTY_LOCALE: LocaleText = { title: "", description: "", speakerName: "", speakerTitle: "", speakerCompany: "" };

export default function WebinarEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("dashboard.webinars");
  const tCommon = useTranslations("common");
  const dashboardLocale = useLocale() as "en" | "ar";
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [webinar, setWebinar] = useState<WebinarDetail | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());

  const [activeLocale, setActiveLocale] = useState<"en" | "ar">(dashboardLocale);
  const [translations, setTranslations] = useState<Record<"en" | "ar", LocaleText>>({ en: EMPTY_LOCALE, ar: EMPTY_LOCALE });
  const [gated, setGated] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [isOnDemand, setIsOnDemand] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [category, setCategory] = useState("");
  const [speakerPhoto, setSpeakerPhoto] = useState<MediaAssetSummary | null>(null);
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
      const [webinarRes, sessionRes] = await Promise.all([fetch(`/api/admin/webinars/${id}`), fetch("/api/admin/auth/session")]);
      if (webinarRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (webinarRes.status === 404) {
        setState({ kind: "notFound" });
        return;
      }
      if (!webinarRes.ok || !sessionRes.ok) {
        setState({ kind: "error" });
        return;
      }
      const webinarData = await webinarRes.json();
      const sessionData = await sessionRes.json();

      setWebinar(webinarData.webinar);
      setPermissions(new Set<string>(sessionData.user.permissions));
      const loadedStatus = webinarData.webinar.status === "PUBLISHED" || webinarData.webinar.status === "ARCHIVED" ? webinarData.webinar.status : "DRAFT";
      setStatus(loadedStatus);

      const version: WebinarVersionRow | null = webinarData.webinar.currentVersion;
      setTranslations(version?.translations ?? { en: EMPTY_LOCALE, ar: EMPTY_LOCALE });
      setGated(webinarData.webinar.gated);
      setFeatured(webinarData.webinar.featured);
      setScheduledAt(version?.scheduledAt ? version.scheduledAt.slice(0, 16) : "");
      setDurationMinutes(version?.durationMinutes != null ? String(version.durationMinutes) : "");
      setIsOnDemand(version?.isOnDemand ?? false);
      setVideoUrl(version?.videoUrl ?? "");
      setCategory(version?.category ?? "");
      setSpeakerPhoto(version?.speakerPhoto ?? null);

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
    return permissions.has(`webinars:${action}`);
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
      const res = await fetch(`/api/admin/webinars/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          gated,
          featured,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          durationMinutes: durationMinutes ? Number(durationMinutes) : null,
          isOnDemand,
          videoUrl: videoUrl || null,
          category: category.trim() || null,
          speakerPhotoId: speakerPhoto?.id ?? null,
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
      const res = await fetch(`/api/admin/webinars/${id}/actions`, {
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
      const res = await fetch(`/api/admin/webinars/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? t("deleteError"));
        return;
      }
      router.push("/webinars");
    } catch {
      setActionError(t("deleteError"));
    } finally {
      setActionPending(null);
    }
  }

  if (state.kind === "forbidden") return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  if (state.kind === "notFound") return <p className="text-sm text-neutral-500">{t("notFound")}</p>;
  if (state.kind === "loading") return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  if (state.kind === "error" || !webinar) {
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
          <Link href="/webinars" className="text-sm text-primary-600 hover:underline">
            ← {t("backToList")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-neutral-900">{translations[dashboardLocale].title || translations.en.title || webinar.slug}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">/{webinar.slug}</p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">{t(`status.${webinar.status}`)}</span>
      </div>

      {webinar.status === "CHANGES_REQUESTED" && webinar.reviewComment ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">{t("reviewCommentLabel")}</p>
          <p className="mt-0.5">{webinar.reviewComment}</p>
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

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={gated} onChange={(e) => setGated(e.target.checked)} disabled={!canEdit} />
            {t("gatedLabel")}
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} disabled={!canEdit} />
            {t("featuredLabel")}
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={isOnDemand} onChange={(e) => setIsOnDemand(e.target.checked)} disabled={!canEdit} />
            {t("isOnDemandLabel")}
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("scheduledAtLabel")}</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              disabled={!canEdit}
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("durationMinutesLabel")}</label>
            <input
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              disabled={!canEdit}
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-neutral-700">{t("videoUrlLabel")}</label>
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={!canEdit}
              placeholder="https://…"
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <TextField label={t("categoryLabel")} name="category" value={category} onChange={setCategory} required={false} disabled={!canEdit} />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-neutral-700">{t("speakerPhotoLabel")}</label>
          <div className="mt-1.5 flex items-center gap-3">
            {speakerPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={speakerPhoto.url} alt="" className="h-12 w-12 rounded-full border border-neutral-200 object-cover" />
            ) : null}
            <ActionButton tone="neutral-bordered" size="sm" onClick={() => setShowPhotoPicker(true)} disabled={!canEdit}>
              {speakerPhoto ? t("changePhoto") : t("choosePhoto")}
            </ActionButton>
            {speakerPhoto ? (
              <ActionButton tone="danger" size="sm" onClick={() => setSpeakerPhoto(null)} disabled={!canEdit}>
                {t("removePhoto")}
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
            <label className="block text-sm font-medium text-neutral-700">{t("descriptionLabel")}</label>
            <textarea
              value={translations[activeLocale].description}
              onChange={(e) => setLocaleField(activeLocale, "description", e.target.value)}
              disabled={!canEdit}
              rows={3}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField
              label={t("speakerNameLabel")}
              name="speakerName"
              value={translations[activeLocale].speakerName}
              onChange={(v) => setLocaleField(activeLocale, "speakerName", v)}
              required={false}
              disabled={!canEdit}
              dir={contentDir}
            />
            <TextField
              label={t("speakerTitleLabel")}
              name="speakerTitle"
              value={translations[activeLocale].speakerTitle}
              onChange={(v) => setLocaleField(activeLocale, "speakerTitle", v)}
              required={false}
              disabled={!canEdit}
              dir={contentDir}
            />
            <TextField
              label={t("speakerCompanyLabel")}
              name="speakerCompany"
              value={translations[activeLocale].speakerCompany}
              onChange={(v) => setLocaleField(activeLocale, "speakerCompany", v)}
              required={false}
              disabled={!canEdit}
              dir={contentDir}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("agendaLabel")}</label>
            <textarea
              value={translations[activeLocale].agenda ?? ""}
              onChange={(e) => setLocaleField(activeLocale, "agenda", e.target.value)}
              disabled={!canEdit}
              rows={3}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("whatYouWillLearnLabel")}</label>
            <textarea
              value={translations[activeLocale].whatYouWillLearn ?? ""}
              onChange={(e) => setLocaleField(activeLocale, "whatYouWillLearn", e.target.value)}
              disabled={!canEdit}
              rows={3}
              dir={contentDir}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("keyTakeawaysLabel")}</label>
            <textarea
              value={translations[activeLocale].keyTakeaways ?? ""}
              onChange={(e) => setLocaleField(activeLocale, "keyTakeaways", e.target.value)}
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

        {canEdit ? (
          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={saving}
            className="mt-6 min-h-9 rounded-md bg-primary-600 px-5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {saving ? t("saving") : t("saveDraft")}
          </button>
        ) : null}
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
          {webinar.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-neutral-800">{t("versionNumber", { n: v.versionNumber })}</span>
                <span className="ms-2 text-neutral-500">{t("versionCreatedAt", { date: new Date(v.createdAt).toLocaleString() })}</span>
                {v.publishedAt ? (
                  <span className="ms-2 text-emerald-700">{t("versionPublishedLabel", { date: new Date(v.publishedAt).toLocaleString() })}</span>
                ) : null}
              </div>
              {canRollback && v.id !== webinar.currentVersion?.id ? (
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
        {webinar.approvals.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">{t("noApprovals")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {webinar.approvals.map((a) => (
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

      {showPhotoPicker ? (
        <MediaPicker
          onSelect={(asset) => {
            setSpeakerPhoto(asset);
            setShowPhotoPicker(false);
          }}
          onClose={() => setShowPhotoPicker(false)}
        />
      ) : null}
    </div>
  );
}
