"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";
import { ActionButton } from "@/components/ui/ActionButton";
import { BLOCK_TYPES, getBlockTypeDef } from "@/lib/content/block-types";
import { MediaPicker, type MediaAssetSummary } from "@/components/MediaPicker";

interface Block {
  id: string;
  type: string;
  order: number;
  props: Record<string, string>;
}

interface PageVersionRow {
  id: string;
  versionNumber: number;
  title: string;
  componentBlocks: Block[];
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

interface PageDetail {
  id: string;
  slug: string;
  title: string;
  templateType: string;
  classification: "STANDARD" | "PRICING" | "LEGAL" | "SECURITY";
  status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  reviewComment: string | null;
  currentVersion: PageVersionRow | null;
  versions: PageVersionRow[];
  approvals: ApprovalRow[];
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "notFound" } | { kind: "error" } | { kind: "ready" };

let blockIdCounter = 0;
function newBlockId(): string {
  blockIdCounter += 1;
  return `block-${Date.now()}-${blockIdCounter}`;
}

export default function PageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("dashboard.pages");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [page, setPage] = useState<PageDetail | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED">("DRAFT");
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [requestChangesComment, setRequestChangesComment] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [mediaCache, setMediaCache] = useState<Record<string, MediaAssetSummary>>({});
  const [pickerTarget, setPickerTarget] = useState<{ blockId: string; fieldKey: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [pageRes, sessionRes] = await Promise.all([fetch(`/api/admin/pages/${id}`), fetch("/api/admin/auth/session")]);
      if (pageRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (pageRes.status === 404) {
        setState({ kind: "notFound" });
        return;
      }
      if (!pageRes.ok || !sessionRes.ok) {
        setState({ kind: "error" });
        return;
      }
      const pageData = await pageRes.json();
      const sessionData = await sessionRes.json();
      setPage(pageData.page);
      setPermissions(new Set<string>(sessionData.user.permissions));
      // Any pre-existing legacy workflow status (Submitted/In Review/etc.)
      // collapses to Draft in the selector — Pages now only recognizes
      // Draft, Published, and Archived as directly selectable states.
      // Archived must load as Archived (not collapse to Draft), or a
      // plain Save without touching the dropdown would silently
      // un-archive the page.
      const loadedStatus = pageData.page.status === "PUBLISHED" || pageData.page.status === "ARCHIVED" ? pageData.page.status : "DRAFT";
      setStatus(loadedStatus);
      setTitle(pageData.page.currentVersion?.title ?? pageData.page.title);
      setBlocks(pageData.page.currentVersion?.componentBlocks ?? []);
      setState({ kind: "ready" });
    } catch {
      setState({ kind: "error" });
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Resolves each media-field prop (a MediaAsset id) to a thumbnail/alt
  // text for display — block.props only ever stores the id (see
  // block-types.ts's doc comment), never a resolved URL, so the editor
  // has to fetch it once per unique id encountered.
  useEffect(() => {
    const mediaIds = new Set<string>();
    for (const block of blocks) {
      for (const field of getBlockTypeDef(block.type)?.fields ?? []) {
        if (field.type === "media") {
          const assetId = block.props[field.key];
          if (assetId) mediaIds.add(assetId);
        }
      }
    }
    const missing = Array.from(mediaIds).filter((assetId) => !mediaCache[assetId]);
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missing.map((assetId) =>
        fetch(`/api/admin/media/${assetId}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => (data ? ([assetId, data.asset] as const) : null))
      )
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, MediaAssetSummary> = {};
      for (const result of results) {
        if (result) next[result[0]] = result[1];
      }
      if (Object.keys(next).length > 0) {
        setMediaCache((prev) => ({ ...prev, ...next }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blocks, mediaCache]);

  function hasPerm(action: string): boolean {
    return permissions.has(`content:${action}`);
  }

  function addBlock(type: string) {
    setBlocks((prev) => [...prev, { id: newBlockId(), type, order: prev.length, props: {} }]);
  }
  function removeBlock(blockId: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId).map((b, i) => ({ ...b, order: i })));
  }
  function moveBlock(blockId: string, direction: -1 | 1) {
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === blockId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((b, i) => ({ ...b, order: i }));
    });
  }
  function setBlockProp(blockId: string, key: string, value: string) {
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, props: { ...b.props, [key]: value } } : b)));
    setSaveSuccess(false);
  }

  async function handleSaveDraft() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/pages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, title, componentBlocks: blocks }),
      });
      if (!res.ok) {
        setSaveError(t("saveError"));
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
      const res = await fetch(`/api/admin/pages/${id}/actions`, {
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
      const res = await fetch(`/api/admin/pages/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? t("deleteError"));
        return;
      }
      router.push("/pages");
    } catch {
      setActionError(t("deleteError"));
    } finally {
      setActionPending(null);
    }
  }

  if (state.kind === "forbidden") return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  if (state.kind === "notFound") return <p className="text-sm text-neutral-500">{t("notFound")}</p>;
  if (state.kind === "loading") return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  if (state.kind === "error" || !page) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <p className="text-sm text-error">{t("loadError")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  const canEdit = hasPerm("edit");
  const canDelete = hasPerm("delete");
  const canSubmit = hasPerm("submit");
  const canApprove = hasPerm("approve");
  const canRequestChanges = hasPerm("requestChanges");
  const canSchedule = hasPerm("schedule");
  const canPublish = hasPerm("publish");
  const canArchive = hasPerm("archive");
  const canRollback = hasPerm("rollback");

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/pages" className="text-sm text-primary-600 hover:underline">
            ← {t("backToList")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-neutral-900">{page.title}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">/{page.slug}</p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
          {t(`status.${page.status}`)}
        </span>
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
            <option value="PUBLISHED">{t("status.PUBLISHED")}</option>
            <option value="ARCHIVED">{t("status.ARCHIVED")}</option>
          </select>
        </div>

        <TextField
          label={t("titleLabel")}
          name="title"
          value={title}
          onChange={(v) => {
            setTitle(v);
            setSaveSuccess(false);
          }}
          required={false}
        />

        <div className="mt-6">
          <h2 className="text-sm font-semibold text-neutral-900">{t("blocksTitle")}</h2>
          {blocks.length === 0 ? <p className="mt-2 text-sm text-neutral-500">{t("noBlocks")}</p> : null}
          <ol className="mt-3 space-y-3">
            {blocks.map((block, index) => (
              <li key={block.id} className="rounded-md border border-neutral-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-800">
                    {getBlockTypeDef(block.type) ? t(`blockType.${block.type}`) : block.type}
                  </span>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveBlock(block.id, -1)}
                        disabled={index === 0}
                        aria-label={t("moveUp")}
                        className="min-h-8 min-w-8 rounded-md text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBlock(block.id, 1)}
                        disabled={index === blocks.length - 1}
                        aria-label={t("moveDown")}
                        className="min-h-8 min-w-8 rounded-md text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <ActionButton tone="danger" onClick={() => removeBlock(block.id)}>
                        {t("removeBlock")}
                      </ActionButton>
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 space-y-3">
                  {(getBlockTypeDef(block.type)?.fields ?? []).map((field) => (
                    <div key={field.key}>
                      <label className="block text-xs font-medium text-neutral-600">{t(`field.${field.labelKey}`)}</label>
                      {field.type === "textarea" ? (
                        <textarea
                          value={block.props[field.key] ?? ""}
                          onChange={(e) => setBlockProp(block.id, field.key, e.target.value)}
                          disabled={!canEdit}
                          rows={3}
                          className="mt-1 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
                        />
                      ) : field.type === "media" ? (
                        <div className="mt-1 flex items-center gap-3">
                          {block.props[field.key] && mediaCache[block.props[field.key]] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mediaCache[block.props[field.key]].url}
                              alt={mediaCache[block.props[field.key]].altText}
                              className="h-16 w-16 rounded-md border border-neutral-200 object-cover"
                            />
                          ) : (
                            <span className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-neutral-300 text-xs text-neutral-400">
                              {t("noImageSelectedShort")}
                            </span>
                          )}
                          {canEdit ? (
                            <div className="flex flex-col gap-1">
                              <ActionButton tone="neutral-bordered" onClick={() => setPickerTarget({ blockId: block.id, fieldKey: field.key })}>
                                {block.props[field.key] ? t("changeImage") : t("selectImage")}
                              </ActionButton>
                              {block.props[field.key] ? (
                                <ActionButton tone="danger" onClick={() => setBlockProp(block.id, field.key, "")}>
                                  {t("removeImage")}
                                </ActionButton>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={block.props[field.key] ?? ""}
                          onChange={(e) => setBlockProp(block.id, field.key, e.target.value)}
                          disabled={!canEdit}
                          className="mt-1 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>

          {canEdit ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {BLOCK_TYPES.map((bt) => (
                <button
                  key={bt.type}
                  type="button"
                  onClick={() => addBlock(bt.type)}
                  className="min-h-8 rounded-md border border-neutral-300 px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  + {t(`blockType.${bt.labelKey}`)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {canEdit ? (
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => void handleSaveDraft()}
              disabled={saving}
              className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? t("saving") : t("saveDraft")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("actionsHeader")}</h2>
        {page.reviewComment ? (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span className="font-medium">{t("reviewCommentLabel")}:</span> {page.reviewComment}
          </p>
        ) : null}
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
          {canPublish ? (
            <button
              type="button"
              onClick={() => void runAction({ action: "publish" }, "publish")}
              disabled={actionPending !== null}
              className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {actionPending === "publish" ? t("publishing") : t("publish")}
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
          {page.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-neutral-800">{t("versionNumber", { n: v.versionNumber })}</span>
                <span className="ms-2 text-neutral-500">{t("versionCreatedAt", { date: new Date(v.createdAt).toLocaleString() })}</span>
                {v.publishedAt ? (
                  <span className="ms-2 text-emerald-700">{t("versionPublishedLabel", { date: new Date(v.publishedAt).toLocaleString() })}</span>
                ) : null}
              </div>
              {canRollback && v.id !== page.currentVersion?.id ? (
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
        {page.approvals.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">{t("noApprovals")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {page.approvals.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <span className="font-medium text-neutral-800">
                  {a.decision === "APPROVE" ? t("decisionApprove") : t("decisionRequestChanges")}
                </span>
                <span className="ms-2 text-neutral-500">
                  {a.actor?.name ?? "—"} · {new Date(a.decidedAt).toLocaleString()}
                </span>
                {a.comment ? <p className="mt-0.5 text-neutral-600">{a.comment}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pickerTarget ? (
        <MediaPicker
          onSelect={(asset) => {
            setMediaCache((prev) => ({ ...prev, [asset.id]: asset }));
            setBlockProp(pickerTarget.blockId, pickerTarget.fieldKey, asset.id);
          }}
          onClose={() => setPickerTarget(null)}
        />
      ) : null}
    </div>
  );
}
