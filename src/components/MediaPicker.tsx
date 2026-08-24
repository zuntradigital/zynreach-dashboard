"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export interface MediaAssetSummary {
  id: string;
  filename: string;
  url: string;
  altText: string;
  fileType: string;
  fileSize?: number;
  width?: number | null;
  height?: number | null;
}

interface MediaPickerProps {
  onSelect: (asset: MediaAssetSummary) => void;
  onClose: () => void;
  /**
   * When true, an upload made through this picker instance's inline
   * upload form gets the ZynReach logo watermark treatment applied
   * server-side (see POST /api/admin/media's `watermark` field) — the same
   * logo-over-image treatment the public website already uses. Opt-in and
   * scoped to the picker instance rather than global, so only call sites
   * that actually want it (Blog's hero image) request it; every other
   * MediaPicker embed (Pages block images, etc.) is unaffected. Default
   * false.
   */
  applyWatermark?: boolean;
}

/**
 * SRS §18's Media Picker — the thing every image-typed block field
 * (block-types.ts's `type: "media"`) opens instead of a raw URL input,
 * so a page always references a real MediaAsset (with its required
 * altText) rather than an arbitrary string. Includes a compact inline
 * upload so an editor picking an image that doesn't exist yet doesn't
 * have to leave the Page Builder to go add it first.
 */
export function MediaPicker({ onSelect, onClose, applyWatermark = false }: MediaPickerProps) {
  const t = useTranslations("dashboard.media");
  const [search, setSearch] = useState("");
  const [assets, setAssets] = useState<MediaAssetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadAltText, setUploadAltText] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ take: "24" });
      if (query.trim()) params.set("search", query.trim());
      const res = await fetch(`/api/admin/media?${params.toString()}`);
      if (!res.ok) {
        setError(t("loadError"));
        return;
      }
      const data = await res.json();
      setAssets(data.assets);
      setError(null);
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(search);
  }, [load, search]);

  async function handleUpload() {
    if (!uploadFile || !uploadAltText.trim()) {
      setError(t("altTextRequired"));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("altText", uploadAltText.trim());
      if (applyWatermark) formData.set("watermark", "true");
      const res = await fetch("/api/admin/media", { method: "POST", body: formData });
      if (!res.ok) {
        setError(t("uploadError"));
        return;
      }
      const data = await res.json();
      onSelect(data.asset);
      onClose();
    } catch {
      setError(t("uploadError"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{t("pickerTitle")}</h2>

        {/* Two clearly separate, equally-weighted paths — existing media vs.
            a fresh upload from the admin's own computer — rather than a
            small toggle link easy to miss. */}
        <div className="mt-3 flex gap-1 border-b border-neutral-200">
          <button
            type="button"
            onClick={() => setShowUpload(false)}
            className={`min-h-9 px-3 text-sm font-medium ${!showUpload ? "border-b-2 border-primary-600 text-primary-700" : "text-neutral-500 hover:text-neutral-700"}`}
          >
            {t("pickerExistingMedia")}
          </button>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className={`min-h-9 px-3 text-sm font-medium ${showUpload ? "border-b-2 border-primary-600 text-primary-700" : "text-neutral-500 hover:text-neutral-700"}`}
          >
            {t("pickerUploadNew")}
          </button>
        </div>

        {error ? (
          <div role="alert" className="mt-3 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        {showUpload ? (
          <div className="mt-3 space-y-3">
            {applyWatermark ? <p className="text-xs text-neutral-500">{t("pickerWatermarkHint")}</p> : null}
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center hover:border-primary-400 hover:bg-primary-50">
              <span className="text-sm font-medium text-primary-700">{t("pickerChooseFile")}</span>
              <span className="text-xs text-neutral-500">{uploadFile ? uploadFile.name : t("pickerNoFileChosen")}</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">{t("altTextLabel")}</label>
              <input
                type="text"
                value={uploadAltText}
                onChange={(e) => setUploadAltText(e.target.value)}
                placeholder={t("altTextPlaceholder")}
                className="block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={uploading}
              className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {uploading ? t("uploading") : t("uploadButton")}
            </button>
          </div>
        ) : null}

        {!showUpload ? (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("pickerSearchPlaceholder")}
          className="mt-3 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900"
        />
        ) : null}

        {!showUpload ? (
        <div className="mt-3 flex-1 overflow-y-auto">
          {loading ? <p className="text-sm text-neutral-500">…</p> : null}
          {!loading && assets.length === 0 ? <p className="text-sm text-neutral-500">{t("pickerEmpty")}</p> : null}
          {!loading && assets.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => {
                    onSelect(asset);
                    onClose();
                  }}
                  className="group overflow-hidden rounded-md border border-neutral-200 hover:border-primary-400"
                >
                  {asset.fileType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt={asset.altText} className="h-20 w-full object-cover" />
                  ) : (
                    <div className="flex h-20 w-full items-center justify-center bg-neutral-100 text-xs text-neutral-500">
                      {asset.fileType}
                    </div>
                  )}
                  <span className="block truncate px-1 py-1 text-start text-xs text-neutral-600 group-hover:text-primary-700">
                    {asset.filename}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            {t("pickerCancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
