"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TextField } from "@/components/ui/TextField";
import { ActionButton } from "@/components/ui/ActionButton";
import type { Locale } from "@/i18n/routing";

interface PricingPlanRow {
  id: string;
  slug: string;
  visibility: "PUBLIC" | "HIDDEN";
  featured: boolean;
  order: number;
  status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  updatedAt: string;
  currentVersion: { translations: Record<"en" | "ar", { name: string }>; monthlyPrice: number | null; annualPrice: number | null; currency: string } | null;
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; plans: PricingPlanRow[] };

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

export default function PricingPlanListPage() {
  const t = useTranslations("dashboard.pricing");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async (status: string) => {
    try {
      const url = status ? `/api/admin/pricing/plans?status=${status}` : "/api/admin/pricing/plans";
      const res = await fetch(url);
      if (res.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = await res.json();
      setState({ kind: "ready", plans: data.plans });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(statusFilter);
  }, [load, statusFilter]);

  async function handleDelete(id: string) {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/pricing/plans/${id}`, { method: "DELETE" });
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
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="min-h-9 shrink-0 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
        >
          {t("newPlan")}
        </button>
      </div>

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

      {state.kind === "ready" && state.plans.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6 text-sm text-neutral-500">{t("empty")}</p>
      ) : null}

      {state.kind === "ready" && state.plans.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-surface shadow-card">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 text-start">{t("nameHeader")}</th>
                <th className="px-4 py-3 text-start">{t("priceHeader")}</th>
                <th className="px-4 py-3 text-start">{t("statusHeader")}</th>
                <th className="px-4 py-3 text-start">{t("visibilityHeader")}</th>
                <th className="px-4 py-3 text-start">{t("updatedHeader")}</th>
                <th className="px-4 py-3 text-start">{t("actionsHeader")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {state.plans.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-medium text-neutral-800">
                    {row.currentVersion?.translations[locale]?.name ?? row.currentVersion?.translations.en.name ?? row.slug}
                    {row.featured ? <span className="ms-2 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">{t("featuredBadge")}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {row.currentVersion?.monthlyPrice != null
                      ? `${row.currentVersion.monthlyPrice} ${row.currentVersion.currency}/mo`
                      : t("customQuote")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>{t(`status.${row.status}`)}</span>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{t(`visibility.${row.visibility}`)}</td>
                  <td className="px-4 py-3 text-neutral-500">{new Date(row.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <ActionButton href={`/pricing/${row.id}`}>{t("edit")}</ActionButton>
                      <ActionButton tone="danger" onClick={() => void handleDelete(row.id)} disabled={deletingId !== null}>
                        {deletingId === row.id ? t("deleting") : t("delete")}
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showCreate ? (
        <CreatePlanModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load(statusFilter);
          }}
        />
      ) : null}
    </div>
  );
}

function CreatePlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations("dashboard.pricing");
  const [slug, setSlug] = useState("");
  const [order, setOrder] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pricing/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, order: Number(order) || 0 }),
      });
      if (res.status === 409) {
        setError(t("slugTaken"));
        return;
      }
      if (!res.ok) {
        setError(t("createError"));
        return;
      }
      const data = await res.json();
      onCreated(data.plan.id);
    } catch {
      setError(t("createError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{t("createTitle")}</h2>
        <p className="mt-0.5 text-sm text-neutral-500">{t("createSubtitle")}</p>

        {error ? (
          <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
          <div>
            <TextField label={t("slugLabel")} name="slug" value={slug} onChange={setSlug} required />
            <p className="mt-1 text-xs text-neutral-500">{t("slugHint")}</p>
          </div>
          <TextField label={t("orderLabel")} name="order" value={order} onChange={setOrder} />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {submitting ? t("creating") : t("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
