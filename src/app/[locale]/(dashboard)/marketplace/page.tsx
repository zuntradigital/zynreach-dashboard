"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type PlanTier = "STARTER" | "GROWTH" | "ENTERPRISE";

interface MarketplaceListing {
  id: string;
  toolSlug: string;
  visible: boolean;
  featured: boolean;
  minPlanTier: PlanTier;
  order: number;
}

type PageState = { kind: "loading" } | { kind: "forbidden" } | { kind: "ready" };
type ListState = { kind: "loading" } | { kind: "error" } | { kind: "ready" };

function toolLabel(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function MarketplacePage() {
  const t = useTranslations("dashboard.marketplace");
  const tCommon = useTranslations("common");
  const [pageState, setPageState] = useState<PageState>({ kind: "loading" });
  const [listState, setListState] = useState<ListState>({ kind: "loading" });
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/marketplace");
      if (res.status === 403) {
        setPageState({ kind: "forbidden" });
        return;
      }
      if (!res.ok) {
        setListState({ kind: "error" });
        setPageState({ kind: "ready" });
        return;
      }
      const data = await res.json();
      setListings(Array.isArray(data.listings) ? data.listings : []);
      setListState({ kind: "ready" });
      setPageState({ kind: "ready" });
    } catch {
      setListState({ kind: "error" });
      setPageState({ kind: "ready" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function saveListing(toolSlug: string, patch: Partial<Pick<MarketplaceListing, "visible" | "featured" | "minPlanTier" | "order">>) {
    const current = listings.find((l) => l.toolSlug === toolSlug);
    if (!current) return;
    const next = { ...current, ...patch };
    setListings((prev) => prev.map((l) => (l.toolSlug === toolSlug ? next : l)));
    setSavingSlug(toolSlug);
    setError(null);
    setSavedSlug(null);
    try {
      const res = await fetch(`/api/admin/marketplace/${toolSlug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible: next.visible, featured: next.featured, minPlanTier: next.minPlanTier, order: next.order }),
      });
      if (!res.ok) {
        setListings((prev) => prev.map((l) => (l.toolSlug === toolSlug ? current : l)));
        setError(t("saveError"));
        return;
      }
      setSavedSlug(toolSlug);
    } catch {
      setListings((prev) => prev.map((l) => (l.toolSlug === toolSlug ? current : l)));
      setError(t("saveError"));
    } finally {
      setSavingSlug(null);
    }
  }

  if (pageState.kind === "loading") {
    return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  }

  if (pageState.kind === "forbidden") {
    return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card">
        {listState.kind === "loading" ? <p className="p-6 text-sm text-neutral-500">…</p> : null}

        {listState.kind === "error" ? (
          <div className="flex items-center justify-between p-6">
            <p className="text-sm text-error">{t("loadError")}</p>
            <button
              type="button"
              onClick={() => {
                setListState({ kind: "loading" });
                void load();
              }}
              className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
            >
              {t("retry")}
            </button>
          </div>
        ) : null}

        {listState.kind === "ready" ? (
          <>
            {error ? (
              <div role="alert" className="m-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
                {error}
              </div>
            ) : null}
            {listings.length === 0 ? (
              <p className="p-6 text-sm text-neutral-500">{t("empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      <th className="px-4 py-3">{t("toolColumn")}</th>
                      <th className="px-4 py-3">{t("visibleColumn")}</th>
                      <th className="px-4 py-3">{t("featuredColumn")}</th>
                      <th className="px-4 py-3">{t("planColumn")}</th>
                      <th className="px-4 py-3">{t("orderColumn")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {[...listings]
                      .sort((a, b) => a.order - b.order || a.toolSlug.localeCompare(b.toolSlug))
                      .map((listing) => (
                        <tr key={listing.toolSlug}>
                          <td className="px-4 py-3 font-medium text-neutral-900">
                            {toolLabel(listing.toolSlug)}
                            {savingSlug === listing.toolSlug ? <span className="ms-2 text-xs text-neutral-400">…</span> : null}
                            {savedSlug === listing.toolSlug && savingSlug !== listing.toolSlug ? (
                              <span className="ms-2 text-xs text-success">{t("saved")}</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={listing.visible}
                              onChange={(e) => void saveListing(listing.toolSlug, { visible: e.target.checked })}
                              aria-label={t("visibleColumn")}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={listing.featured}
                              onChange={(e) => void saveListing(listing.toolSlug, { featured: e.target.checked })}
                              aria-label={t("featuredColumn")}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={listing.minPlanTier}
                              onChange={(e) => void saveListing(listing.toolSlug, { minPlanTier: e.target.value as PlanTier })}
                              className="min-h-9 rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
                            >
                              <option value="STARTER">{t("planStarter")}</option>
                              <option value="GROWTH">{t("planGrowth")}</option>
                              <option value="ENTERPRISE">{t("planEnterprise")}</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={listing.order}
                              onChange={(e) => void saveListing(listing.toolSlug, { order: Number(e.target.value) || 0 })}
                              className="min-h-9 w-20 rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
