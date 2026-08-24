"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TextField } from "@/components/ui/TextField";
import { ActionButton } from "@/components/ui/ActionButton";
import type { Locale } from "@/i18n/routing";

interface TaxonomyRow {
  id: string;
  slug: string;
  translations: Record<"en" | "ar", { name: string }>;
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; rows: TaxonomyRow[] };

interface SectionConfig {
  resource: "categories" | "tags";
  apiBase: string;
  titleKey: "categoriesTitle" | "tagsTitle";
  newKey: "newCategory" | "newTag";
}

const SECTIONS: SectionConfig[] = [
  { resource: "categories", apiBase: "/api/admin/blog/categories", titleKey: "categoriesTitle", newKey: "newCategory" },
  { resource: "tags", apiBase: "/api/admin/blog/tags", titleKey: "tagsTitle", newKey: "newTag" },
];

/**
 * SRS SCR-016 Taxonomy Manager — a dedicated screen for the Category/Tag
 * entities the Blog editor's own pickers already read from and write to
 * (GET/POST/PATCH/DELETE /api/admin/blog/categories|tags), so a tag added
 * here shows up in the article editor's tag list immediately, and a tag
 * added inline from the article editor shows up here too — one shared
 * table, not a second taxonomy system.
 */
export default function TaxonomyPage() {
  const t = useTranslations("dashboard.taxonomy");

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
      </div>

      {SECTIONS.map((section) => (
        <TaxonomySection key={section.resource} config={section} />
      ))}
    </div>
  );
}

function TaxonomySection({ config }: { config: SectionConfig }) {
  const t = useTranslations("dashboard.taxonomy");
  const locale = useLocale() as Locale;

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingRow, setEditingRow] = useState<TaxonomyRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rowsRes, sessionRes] = await Promise.all([fetch(config.apiBase), fetch("/api/admin/auth/session")]);
      if (rowsRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (!rowsRes.ok || !sessionRes.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = await rowsRes.json();
      const sessionData = await sessionRes.json();
      setPermissions(new Set<string>(sessionData.user.permissions));
      setState({ kind: "ready", rows: data[config.resource] });
    } catch {
      setState({ kind: "error" });
    }
  }, [config]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canEdit = permissions.has("blog:edit");
  const canDelete = permissions.has("blog:delete");

  async function handleDelete(row: TaxonomyRow) {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setDeletingId(row.id);
    setRowError(null);
    try {
      const res = await fetch(`${config.apiBase}/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRowError(data.error ?? t("deleteError"));
        return;
      }
      await load();
    } catch {
      setRowError(t("deleteError"));
    } finally {
      setDeletingId(null);
    }
  }

  if (state.kind === "forbidden") return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;

  return (
    <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">{t(config.titleKey)}</h2>
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setEditingRow(null);
              setShowForm(true);
            }}
            className="min-h-8 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700"
          >
            {t(config.newKey)}
          </button>
        ) : null}
      </div>

      {rowError ? (
        <div role="alert" className="mt-3 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {rowError}
        </div>
      ) : null}

      {state.kind === "loading" ? <p className="mt-3 text-sm text-neutral-500">…</p> : null}

      {state.kind === "error" ? (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-sm text-error">{t("loadError")}</p>
          <button type="button" onClick={() => void load()} className="min-h-8 rounded-md px-2.5 text-sm font-medium text-primary-600 hover:bg-primary-50">
            {t("retry")}
          </button>
        </div>
      ) : null}

      {state.kind === "ready" ? (
        state.rows.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">{t("empty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {state.rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-medium text-neutral-800">{row.translations[locale]?.name || row.translations.en.name}</span>
                  <span className="ms-2 text-neutral-400">/{row.slug}</span>
                </div>
                <div className="flex items-center gap-1">
                  {canEdit ? (
                    <ActionButton
                      onClick={() => {
                        setEditingRow(row);
                        setShowForm(true);
                      }}
                    >
                      {t("edit")}
                    </ActionButton>
                  ) : null}
                  {canDelete ? (
                    <ActionButton tone="danger" onClick={() => void handleDelete(row)} disabled={deletingId !== null}>
                      {deletingId === row.id ? t("deleting") : t("delete")}
                    </ActionButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {showForm ? (
        <TaxonomyFormModal
          config={config}
          editingRow={editingRow}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function TaxonomyFormModal({
  config,
  editingRow,
  onClose,
  onSaved,
}: {
  config: SectionConfig;
  editingRow: TaxonomyRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("dashboard.taxonomy");
  const [slug, setSlug] = useState(editingRow?.slug ?? "");
  const [nameEn, setNameEn] = useState(editingRow?.translations.en.name ?? "");
  const [nameAr, setNameAr] = useState(editingRow?.translations.ar.name ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const url = editingRow ? `${config.apiBase}/${editingRow.id}` : config.apiBase;
      const res = await fetch(url, {
        method: editingRow ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, translations: { en: { name: nameEn }, ar: { name: nameAr } } }),
      });
      if (res.status === 409) {
        setError(t("slugTaken"));
        return;
      }
      if (!res.ok) {
        setError(t("saveError"));
        return;
      }
      onSaved();
    } catch {
      setError(t("saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{editingRow ? t("edit") : t(config.newKey)}</h2>

        {error ? (
          <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
          <div>
            <TextField label={t("slugLabel")} name="slug" value={slug} onChange={setSlug} required />
            <p className="mt-1 text-xs text-neutral-500">{t("slugHint")}</p>
          </div>
          <TextField label={t("nameEnglishLabel")} name="nameEn" value={nameEn} onChange={setNameEn} required />
          <TextField label={t("nameArabicLabel")} name="nameAr" value={nameAr} onChange={setNameAr} required />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={submitting} className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {submitting ? (editingRow ? t("saving") : t("creating")) : editingRow ? t("save") : t("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
