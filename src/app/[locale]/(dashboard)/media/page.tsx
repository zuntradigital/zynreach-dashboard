"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";

interface MediaAssetRow {
  id: string;
  filename: string;
  url: string;
  altText: string;
  fileType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  folder: string | null;
  archived: boolean;
  createdAt: string;
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; assets: MediaAssetRow[] };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaLibraryPage() {
  const t = useTranslations("dashboard.media");
  const tCommon = useTranslations("common");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async (searchValue: string, archivedValue: boolean) => {
    try {
      const params = new URLSearchParams({ archived: archivedValue ? "all" : "false" });
      if (searchValue.trim()) params.set("search", searchValue.trim());
      const res = await fetch(`/api/admin/media?${params.toString()}`);
      if (res.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = await res.json();
      setState({ kind: "ready", assets: data.assets });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(search, showArchived);
  }, [load, search, showArchived]);

  if (state.kind === "forbidden") {
    return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="min-h-9 shrink-0 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
        >
          {t("upload")}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <TextField label={t("searchLabel")} name="search" value={search} onChange={setSearch} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          {t("showArchived")}
        </label>
      </div>

      {state.kind === "loading" ? <p className="text-sm text-neutral-500">{tCommon("loading")}</p> : null}

      {state.kind === "error" ? (
        <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
          <p className="text-sm text-error">{t("loadError")}</p>
          <button
            type="button"
            onClick={() => {
              setState({ kind: "loading" });
              void load(search, showArchived);
            }}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {state.kind === "ready" && state.assets.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6 text-sm text-neutral-500">{t("empty")}</p>
      ) : null}

      {state.kind === "ready" && state.assets.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {state.assets.map((asset) => (
            <Link
              key={asset.id}
              href={`/media/${asset.id}`}
              className="group overflow-hidden rounded-lg border border-neutral-200 bg-surface shadow-card hover:border-primary-400"
            >
              <div className="relative">
                {asset.fileType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset.url} alt={asset.altText} className="h-32 w-full object-cover" />
                ) : (
                  <div className="flex h-32 w-full items-center justify-center bg-neutral-100 text-xs text-neutral-500">
                    {asset.fileType}
                  </div>
                )}
                {asset.archived ? (
                  <span className="absolute end-1.5 top-1.5 rounded-full bg-neutral-900/70 px-2 py-0.5 text-xs font-medium text-white">
                    {t("archivedBadge")}
                  </span>
                ) : null}
              </div>
              <div className="p-2">
                <p className="truncate text-sm font-medium text-neutral-800 group-hover:text-primary-700">{asset.filename}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {formatFileSize(asset.fileSize)}
                  {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      {showUpload ? (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            setShowUpload(false);
            void load(search, showArchived);
          }}
        />
      ) : null}
    </div>
  );
}

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const t = useTranslations("dashboard.media");
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState("");
  const [caption, setCaption] = useState("");
  const [folder, setFolder] = useState("");
  const [tags, setTags] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) {
      setError(t("uploadError"));
      return;
    }
    if (!altText.trim()) {
      setError(t("altTextRequired"));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("altText", altText.trim());
      if (caption.trim()) formData.set("caption", caption.trim());
      if (folder.trim()) formData.set("folder", folder.trim());
      if (tags.trim()) {
        formData.set(
          "tags",
          JSON.stringify(
            tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          )
        );
      }
      const res = await fetch("/api/admin/media", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t("uploadError"));
        return;
      }
      onUploaded();
    } catch {
      setError(t("uploadError"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{t("uploadTitle")}</h2>
        <p className="mt-0.5 text-sm text-neutral-500">{t("uploadSubtitle")}</p>

        {error ? (
          <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-neutral-700"
          />
          <TextField label={t("altTextLabel")} name="altText" value={altText} onChange={setAltText} required />
          <TextField label={t("captionLabel")} name="caption" value={caption} onChange={setCaption} />
          <TextField label={t("folderLabel")} name="folder" value={folder} onChange={setFolder} />
          <div>
            <TextField label={t("tagsLabel")} name="tags" value={tags} onChange={setTags} />
            <p className="mt-1 text-xs text-neutral-500">{t("tagsHint")}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={uploading}
            className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {uploading ? t("uploading") : t("uploadButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
