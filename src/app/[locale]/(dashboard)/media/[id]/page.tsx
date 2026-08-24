"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";

interface MediaAssetDetail {
  id: string;
  filename: string;
  url: string;
  altText: string;
  caption: string | null;
  fileType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  folder: string | null;
  tags: string[];
  archived: boolean;
  createdAt: string;
}

interface UsageRef {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  blockId: string;
  blockType: string;
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "notFound" } | { kind: "error" } | { kind: "ready" };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaAssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("dashboard.media");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [asset, setAsset] = useState<MediaAssetDetail | null>(null);
  const [usage, setUsage] = useState<UsageRef[]>([]);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());

  const [altText, setAltText] = useState("");
  const [caption, setCaption] = useState("");
  const [folder, setFolder] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);

  const [actionPending, setActionPending] = useState<"archive" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [assetRes, usageRes, sessionRes] = await Promise.all([
        fetch(`/api/admin/media/${id}`),
        fetch(`/api/admin/media/${id}/usage`),
        fetch("/api/admin/auth/session"),
      ]);
      if (assetRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (assetRes.status === 404) {
        setState({ kind: "notFound" });
        return;
      }
      if (!assetRes.ok || !sessionRes.ok) {
        setState({ kind: "error" });
        return;
      }
      const assetData = await assetRes.json();
      const usageData = usageRes.ok ? await usageRes.json() : { usage: [] };
      const sessionData = await sessionRes.json();
      setAsset(assetData.asset);
      setUsage(usageData.usage);
      setPermissions(new Set<string>(sessionData.user.permissions));
      setAltText(assetData.asset.altText);
      setCaption(assetData.asset.caption ?? "");
      setFolder(assetData.asset.folder ?? "");
      setTags(assetData.asset.tags.join(", "));
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
    return permissions.has(`media:${action}`);
  }

  async function handleSaveMetadata() {
    if (!altText.trim()) {
      setSaveError(t("altTextRequired"));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/media/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          altText: altText.trim(),
          caption: caption.trim() || undefined,
          folder: folder.trim() || undefined,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
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

  async function handleReplace(confirmed: boolean) {
    if (!replaceFile) return;
    setReplacing(true);
    setReplaceError(null);
    try {
      const formData = new FormData();
      formData.set("file", replaceFile);
      if (confirmed) formData.set("confirmReplace", "true");
      const res = await fetch(`/api/admin/media/${id}`, { method: "PATCH", body: formData });
      if (res.status === 409) {
        const data = await res.json();
        if (typeof window !== "undefined" && window.confirm(t("replaceConfirm", { count: data.usage?.length ?? 0 }))) {
          await handleReplace(true);
        }
        return;
      }
      if (!res.ok) {
        setReplaceError(t("replaceError"));
        return;
      }
      setReplaceFile(null);
      await load();
    } catch {
      setReplaceError(t("replaceError"));
    } finally {
      setReplacing(false);
    }
  }

  async function handleToggleArchive() {
    if (!asset) return;
    setActionPending("archive");
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/media/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !asset.archived }),
      });
      if (!res.ok) {
        setActionError(t("archiveError"));
        return;
      }
      await load();
    } catch {
      setActionError(t("archiveError"));
    } finally {
      setActionPending(null);
    }
  }

  async function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setActionPending("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/media/${id}`, { method: "DELETE" });
      if (res.status === 409) {
        const data = await res.json();
        setActionError(t("deleteBlockedUsage", { count: data.usage?.length ?? 0 }));
        return;
      }
      if (!res.ok) {
        setActionError(t("deleteError"));
        return;
      }
      router.push("/media");
    } catch {
      setActionError(t("deleteError"));
    } finally {
      setActionPending(null);
    }
  }

  if (state.kind === "forbidden") return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  if (state.kind === "notFound") return <p className="text-sm text-neutral-500">{t("notFound")}</p>;
  if (state.kind === "loading") return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  if (state.kind === "error" || !asset) {
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
  const canArchive = hasPerm("archive");
  const canDelete = hasPerm("delete");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/media" className="text-sm text-primary-600 hover:underline">
          ← {t("backToLibrary")}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-neutral-900">{asset.filename}</h1>
        {asset.archived ? (
          <span className="mt-1 inline-block rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">{t("archivedBadge")}</span>
        ) : null}
      </div>

      {actionError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {actionError}
        </div>
      ) : null}

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        {asset.fileType.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={asset.altText} className="max-h-80 w-full rounded-md object-contain" />
        ) : (
          <div className="flex h-40 items-center justify-center rounded-md bg-neutral-100 text-sm text-neutral-500">{asset.fileType}</div>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-neutral-500">{t("fileSizeLabel")}</dt>
            <dd className="text-neutral-800">{formatFileSize(asset.fileSize)}</dd>
          </div>
          {asset.width && asset.height ? (
            <div>
              <dt className="text-neutral-500">{t("dimensionsLabel")}</dt>
              <dd className="text-neutral-800">{asset.width}×{asset.height}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-neutral-500">{t("uploadedLabel")}</dt>
            <dd className="text-neutral-800">{new Date(asset.createdAt).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("editMetadata")}</h2>
        {saveError ? (
          <div role="alert" className="mt-3 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {saveError}
          </div>
        ) : null}
        {saveSuccess ? (
          <div role="status" className="mt-3 rounded-md bg-success-bg px-3 py-2 text-sm text-success">
            {t("saveSuccess")}
          </div>
        ) : null}
        <div className="mt-4 space-y-4">
          <TextField
            label={t("altTextLabel")}
            name="altText"
            value={altText}
            onChange={(v) => {
              setAltText(v);
              setSaveSuccess(false);
            }}
            required
            disabled={!canEdit}
          />
          <TextField
            label={t("captionLabel")}
            name="caption"
            value={caption}
            onChange={(v) => {
              setCaption(v);
              setSaveSuccess(false);
            }}
            disabled={!canEdit}
          />
          <TextField
            label={t("folderLabel")}
            name="folder"
            value={folder}
            onChange={(v) => {
              setFolder(v);
              setSaveSuccess(false);
            }}
            disabled={!canEdit}
          />
          <TextField
            label={t("tagsLabel")}
            name="tags"
            value={tags}
            onChange={(v) => {
              setTags(v);
              setSaveSuccess(false);
            }}
            disabled={!canEdit}
          />
        </div>
        {canEdit ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleSaveMetadata()}
              disabled={saving}
              className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
          <h2 className="text-sm font-semibold text-neutral-900">{t("replaceAsset")}</h2>
          {replaceError ? (
            <div role="alert" className="mt-3 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
              {replaceError}
            </div>
          ) : null}
          <div className="mt-3 flex items-center gap-3">
            <input type="file" onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)} className="text-sm" />
            <button
              type="button"
              onClick={() => void handleReplace(false)}
              disabled={replacing || !replaceFile}
              className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-60"
            >
              {replacing ? t("replacing") : t("replaceAsset")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("usageTitle")}</h2>
        {usage.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">{t("noUsage")}</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {usage.map((ref, index) => (
              <li key={`${ref.pageId}-${ref.blockId}-${index}`}>
                <Link href={`/pages/${ref.pageId}`} className="text-primary-600 hover:underline">
                  {t("usedOnPage", { blockType: ref.blockType, pageTitle: ref.pageTitle })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {canArchive ? (
          <button
            type="button"
            onClick={() => void handleToggleArchive()}
            disabled={actionPending !== null}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            {actionPending === "archive" ? t("archiving") : asset.archived ? t("unarchiveAsset") : t("archiveAsset")}
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={actionPending !== null}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-error hover:bg-error-bg"
          >
            {actionPending === "delete" ? t("deleting") : t("deleteAsset")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
