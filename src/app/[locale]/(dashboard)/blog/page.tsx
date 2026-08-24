"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { ActionButton } from "@/components/ui/ActionButton";

interface BlogPostRow {
  id: string;
  slug: string;
  featured: boolean;
  status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  updatedAt: string;
  author: { translations: Record<"en" | "ar", { name: string }> } | null;
  currentVersion: {
    translations: Record<"en" | "ar", { title: string }>;
    publishedDate: string | null;
    heroImage: { url: string; altText: string } | null;
  } | null;
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; posts: BlogPostRow[]; total: number };

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

const STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT: "bg-neutral-100 text-neutral-600",
  SUBMITTED: "bg-primary-100 text-primary-700",
  IN_REVIEW: "bg-primary-100 text-primary-700",
  CHANGES_REQUESTED: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  SCHEDULED: "bg-emerald-100 text-emerald-700",
  PUBLISHED: "bg-success-bg text-success",
  ARCHIVED: "bg-neutral-100 text-neutral-500",
};

export default function BlogPostListPage() {
  const t = useTranslations("dashboard.blog");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const load = useCallback(async (status: string) => {
    try {
      const url = status ? `/api/admin/blog/posts?status=${status}` : "/api/admin/blog/posts";
      // The article count at the bottom of this page is the total across
      // all statuses, not just whatever status filter is active above the
      // table — so when a filter is applied, a second unfiltered request
      // is needed purely to read its `total` (a real prisma.blogPost.count,
      // not a hardcoded number). No new endpoint: this reuses the same
      // list route the table itself already calls.
      const [res, totalRes, sessionRes] = await Promise.all([
        fetch(url),
        status ? fetch("/api/admin/blog/posts") : null,
        fetch("/api/admin/auth/session"),
      ]);
      if (res.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (!res.ok || (totalRes && !totalRes.ok)) {
        setState({ kind: "error" });
        return;
      }
      const data = await res.json();
      const total = totalRes ? (await totalRes.json()).total : data.total;
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        const perms = new Set<string>(sessionData.user.permissions);
        setCanCreate(perms.has("blog:create"));
        setCanDelete(perms.has("blog:delete"));
      }
      setState({ kind: "ready", posts: data.posts, total });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(statusFilter);
  }, [load, statusFilter]);

  /**
   * "New post" used to open a modal asking for a slug up front. The admin
   * has nothing meaningful to decide at that point — every real field
   * (title, excerpt, body, slug is derived from the title once one is
   * entered on the editor screen, etc.) lives in the full editor — so this
   * now creates a bare draft with an auto-generated, collision-proof slug
   * and drops the admin straight into the editor, matching how "creating"
   * an article actually works everywhere else in the app.
   */
  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/blog/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: `untitled-${Date.now()}` }),
      });
      if (!res.ok) {
        setCreateError(t("createError"));
        return;
      }
      const data = await res.json();
      router.push(`/blog/${data.post.id}`);
    } catch {
      setCreateError(t("createError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/blog/posts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error ?? t("deleteError"));
        return;
      }
      await load(statusFilter);
    } catch {
      setDeleteError(t("deleteError"));
    } finally {
      setDeletingId(null);
    }
  }

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
        {canCreate ? (
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="min-h-9 shrink-0 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {creating ? t("creating") : t("newPost")}
          </button>
        ) : null}
      </div>

      {createError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {createError}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <label htmlFor="status-filter" className="text-sm font-medium text-neutral-700">
          {t("statusFilterLabel")}
        </label>
        <select
          id="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-9 rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900"
        >
          <option value="">{t("allStatuses")}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {deleteError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {deleteError}
        </div>
      ) : null}

      {state.kind === "loading" ? <p className="text-sm text-neutral-500">{tCommon("loading")}</p> : null}

      {state.kind === "error" ? (
        <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
          <p className="text-sm text-error">{t("loadError")}</p>
          <button
            type="button"
            onClick={() => {
              setState({ kind: "loading" });
              void load(statusFilter);
            }}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {state.kind === "ready" && state.posts.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6 text-sm text-neutral-500">{t("empty")}</p>
      ) : null}

      {state.kind === "ready" && state.posts.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-surface shadow-card">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 text-start">{t("imageHeader")}</th>
                <th className="px-4 py-3 text-start">{t("titleHeader")}</th>
                <th className="px-4 py-3 text-start">{t("authorHeader")}</th>
                <th className="px-4 py-3 text-start">{t("statusHeader")}</th>
                <th className="px-4 py-3 text-start">{t("updatedHeader")}</th>
                <th className="px-4 py-3 text-start">{t("actionsHeader")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {state.posts.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    {row.currentVersion?.heroImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.currentVersion.heroImage.url}
                        alt={row.currentVersion.heroImage.altText}
                        className="h-12 w-16 rounded-md border border-neutral-200 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-16 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-[10px] text-neutral-400">
                        {t("noImage")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-neutral-800">
                    {row.currentVersion?.translations[locale]?.title || row.currentVersion?.translations.en.title || row.slug}
                    {row.featured ? <span className="ms-2 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">{t("featuredBadge")}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{row.author?.translations[locale]?.name ?? row.author?.translations.en.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>{t(`status.${row.status}`)}</span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{new Date(row.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <ActionButton href={`/blog/${row.id}`}>{t("edit")}</ActionButton>
                      {canDelete ? (
                        <ActionButton tone="danger" onClick={() => void handleDelete(row.id)} disabled={deletingId !== null}>
                          {deletingId === row.id ? t("deleting") : t("delete")}
                        </ActionButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {state.kind === "ready" ? <p className="text-sm text-neutral-500">{t("totalArticles", { count: state.total })}</p> : null}
    </div>
  );
}
