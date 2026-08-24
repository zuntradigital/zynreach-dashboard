"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";
import { ActionButton } from "@/components/ui/ActionButton";
import { MediaPicker, type MediaAssetSummary } from "@/components/MediaPicker";

interface LocaleText {
  title: string;
  description: string;
}

interface ResourceVersionRow {
  id: string;
  versionNumber: number;
  category: string | null;
  targetAudience: string | null;
  difficultyLevel: "Beginner" | "Intermediate" | "Advanced" | null;
  relatedResourceSlugs: string[];
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

interface ResourceDetail {
  id: string;
  slug: string;
  resourceFormat: "GUIDE" | "TEMPLATE" | "WHITEPAPER" | "CHECKLIST" | "PLAYBOOK";
  gated: boolean;
  downloadFileId: string | null;
  downloadFile: MediaAssetSummary | null;
  status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  reviewComment: string | null;
  currentVersion: ResourceVersionRow | null;
  versions: ResourceVersionRow[];
  approvals: ApprovalRow[];
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "notFound" } | { kind: "error" } | { kind: "ready" };

const EMPTY_LOCALE: LocaleText = { title: "", description: "" };

export default function ResourceEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("dashboard.resources");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [resource, setResource] = useState<ResourceDetail | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED">("DRAFT");

  const [activeLocale, setActiveLocale] = useState<"en" | "ar">("en");
  const [translations, setTranslations] = useState<Record<"en" | "ar", LocaleText>>({ en: EMPTY_LOCALE, ar: EMPTY_LOCALE });
  const [gated, setGated] = useState(true);
  const [downloadFile, setDownloadFile] = useState<MediaAssetSummary | null>(null);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [category, setCategory] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState<"" | "Beginner" | "Intermediate" | "Advanced">("");
  const [relatedContentText, setRelatedContentText] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [requestChangesComment, setRequestChangesComment] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");

  const load = useCallback(async () => {
    try {
      const [resourceRes, sessionRes] = await Promise.all([fetch(`/api/admin/resources/${id}`), fetch("/api/admin/auth/session")]);
      if (resourceRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (resourceRes.status === 404) {
        setState({ kind: "notFound" });
        return;
      }
      if (!resourceRes.ok || !sessionRes.ok) {
        setState({ kind: "error" });
        return;
      }
      const resourceData = await resourceRes.json();
      const sessionData = await sessionRes.json();

      setResource(resourceData.resource);
      setPermissions(new Set<string>(sessionData.user.permissions));
      // Any pre-existing legacy workflow status (Submitted/In Review/etc.)
      // collapses to Draft in the selector — Resources now only recognizes
      // Draft, Published, and Archived as directly selectable states.
      // Archived must load as Archived (not collapse to Draft), or a
      // plain Save without touching the dropdown would silently
      // un-archive the resource.
      const loadedStatus =
        resourceData.resource.status === "PUBLISHED" || resourceData.resource.status === "ARCHIVED" ? resourceData.resource.status : "DRAFT";
      setStatus(loadedStatus);

      const version: ResourceVersionRow | null = resourceData.resource.currentVersion;
      setTranslations(version?.translations ?? { en: EMPTY_LOCALE, ar: EMPTY_LOCALE });
      setGated(resourceData.resource.gated);
      setDownloadFile(resourceData.resource.downloadFile ?? null);
      setCategory(version?.category ?? "");
      setTargetAudience(version?.targetAudience ?? "");
      setDifficultyLevel(version?.difficultyLevel ?? "");
      setRelatedContentText((version?.relatedResourceSlugs ?? []).join("\n"));

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
    return permissions.has(`resources:${action}`);
  }

  function setLocaleField<K extends keyof LocaleText>(locale: "en" | "ar", key: K, value: LocaleText[K]) {
    setTranslations((prev) => ({ ...prev, [locale]: { ...prev[locale], [key]: value } }));
    setSaveSuccess(false);
  }

  async function handleSaveDraft() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/resources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          gated,
          downloadFileId: downloadFile?.id ?? null,
          category: category.trim() || null,
          targetAudience: targetAudience.trim() || null,
          difficultyLevel: difficultyLevel || null,
          relatedResourceSlugs: relatedContentText.split("\n").map((s) => s.trim()).filter(Boolean),
          translations,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error ?? t("saveError"));
        return;
      }
      setSaveSuccess(true);
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
      const res = await fetch(`/api/admin/resources/${id}/actions`, {
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
      const res = await fetch(`/api/admin/resources/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? t("deleteError"));
        return;
      }
      router.push("/resources");
    } catch {
      setActionError(t("deleteError"));
    } finally {
      setActionPending(null);
    }
  }

  if (state.kind === "forbidden") return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  if (state.kind === "notFound") return <p className="text-sm text-neutral-500">{t("notFound")}</p>;
  if (state.kind === "loading") return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  if (state.kind === "error" || !resource) {
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

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/resources" className="text-sm text-primary-600 hover:underline">
            ← {t("backToList")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-neutral-900">{translations.en.title || resource.slug}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            /{resource.slug} · {t(`format.${resource.resourceFormat}`)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">{t(`status.${resource.status}`)}</span>
      </div>

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
        {saveSuccess ? (
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

        <label className="mb-4 flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={gated} onChange={(e) => setGated(e.target.checked)} disabled={!canEdit} />
          {t("gatedLabel")}
        </label>

        <div className="mb-4">
          <label className="block text-sm font-medium text-neutral-700">{t("downloadFileLabel")}</label>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {downloadFile ? <span className="truncate text-sm text-neutral-600">{downloadFile.filename}</span> : <span className="text-sm text-neutral-400">{t("noDownloadFile")}</span>}
            <ActionButton tone="neutral-bordered" size="sm" onClick={() => setShowFilePicker(true)} disabled={!canEdit || !canPublish}>
              {downloadFile ? t("changeDownloadFile") : t("chooseDownloadFile")}
            </ActionButton>
            {downloadFile ? (
              <ActionButton tone="danger" size="sm" onClick={() => setDownloadFile(null)} disabled={!canEdit || !canPublish}>
                {t("removeDownloadFile")}
              </ActionButton>
            ) : null}
          </div>
          {!canPublish ? <p className="mt-1 text-xs text-neutral-500">{t("cannotChangeFileRole")}</p> : null}
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label={t("categoryLabel")} name="category" value={category} onChange={setCategory} required={false} disabled={!canEdit} />
          <TextField
            label={t("targetAudienceLabel")}
            name="targetAudience"
            value={targetAudience}
            onChange={setTargetAudience}
            required={false}
            disabled={!canEdit}
          />
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("difficultyLevelLabel")}</label>
            <select
              value={difficultyLevel}
              onChange={(e) => setDifficultyLevel(e.target.value as typeof difficultyLevel)}
              disabled={!canEdit}
              className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            >
              <option value="">{t("difficultyLevelNone")}</option>
              <option value="Beginner">{t("difficulty.Beginner")}</option>
              <option value="Intermediate">{t("difficulty.Intermediate")}</option>
              <option value="Advanced">{t("difficulty.Advanced")}</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-neutral-700">{t("relatedContentLabel")}</label>
          <textarea
            value={relatedContentText}
            onChange={(e) => setRelatedContentText(e.target.value)}
            disabled={!canEdit}
            rows={2}
            className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
          />
        </div>

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
          />
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("descriptionLabel")}</label>
            <textarea
              value={translations[activeLocale].description}
              onChange={(e) => setLocaleField(activeLocale, "description", e.target.value)}
              disabled={!canEdit}
              rows={3}
              dir={activeLocale === "ar" ? "rtl" : "ltr"}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
        </div>

        {canEdit ? (
          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={saving}
            className="mt-6 min-h-9 rounded-md bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
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
          {resource.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-neutral-800">{t("versionNumber", { n: v.versionNumber })}</span>
                <span className="ms-2 text-neutral-500">{t("versionCreatedAt", { date: new Date(v.createdAt).toLocaleString() })}</span>
                {v.publishedAt ? (
                  <span className="ms-2 text-emerald-700">{t("versionPublishedLabel", { date: new Date(v.publishedAt).toLocaleString() })}</span>
                ) : null}
              </div>
              {canRollback && v.id !== resource.currentVersion?.id ? (
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
        {resource.approvals.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">{t("noApprovals")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {resource.approvals.map((a) => (
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

      {showFilePicker ? (
        <MediaPicker
          onSelect={(asset) => {
            setDownloadFile(asset);
            setShowFilePicker(false);
          }}
          onClose={() => setShowFilePicker(false)}
        />
      ) : null}
    </div>
  );
}
