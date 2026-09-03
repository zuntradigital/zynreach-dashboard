"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

type LeadStatus = "NEW" | "ROUTED" | "SYNCED" | "SYNC_FAILED" | "ARCHIVED";

interface LeadRow {
  id: string;
  status: LeadStatus;
  source: string | null;
  submittedAt: string;
}

interface LeadDetail {
  id: string;
  status: LeadStatus;
  source: string | null;
  createdAt: string;
  submission: {
    formId: string;
    payload: Record<string, unknown>;
    utm: unknown;
    submittedAt: string;
    ipHash: string | null;
  };
}

const TAKE = 20;

export interface FilteredLeadColumn {
  header: string;
  render: (payload: Record<string, unknown>) => ReactNode;
}

export interface FilteredLeadSectionProps {
  /** Exact Submission.formId this view is scoped to — never mixed with any other form's rows. */
  formId: string;
  /** i18n namespace holding empty/loading/error/detail/status strings for this specific section. */
  namespace: string;
  /** Table columns rendered from the raw submitted payload, left to right, before the fixed Status/Submitted/Actions columns. */
  columns: FilteredLeadColumn[];
  /** Structured "Full submitted data" rows shown in the detail panel, in order. */
  renderDetailFields: (payload: Record<string, unknown>) => ReactNode;
}

/**
 * Shared list+detail+delete UI for a Lead/Submission view scoped to one
 * formId — the same underlying data and API as the main Leads (Customer
 * Leads) page, just pre-filtered and rendered with fields specific to
 * that form, so Contact Us / Subscribers / Partners each get a focused,
 * unambiguous view instead of a duplicated parallel data model.
 */
export function FilteredLeadSection({ formId, namespace, columns, renderDetailFields }: FilteredLeadSectionProps) {
  const t = useTranslations(namespace);
  const tCommon = useTranslations("common");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; rows: (LeadRow & { payload: Record<string, unknown> })[]; total: number }
  >({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canArchive, setCanArchive] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const load = useCallback(
    async (pageNum: number) => {
      try {
        const params = new URLSearchParams({ formId, page: String(pageNum), take: String(TAKE) });
        const [res, sessionRes] = await Promise.all([
          fetch(`/api/admin/leads?${params.toString()}`),
          fetch("/api/admin/auth/session"),
        ]);
        if (res.status === 403) {
          setState({ kind: "forbidden" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "error" });
          return;
        }
        const data = await res.json();
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          const perms = new Set<string>(sessionData.user.permissions);
          setCanArchive(perms.has("leads:archive"));
          setCanDelete(perms.has("leads:delete"));
        }
        // The list endpoint returns summary fields only (no payload) — fetch
        // each row's detail to render the structured columns, same trade-off
        // the existing Leads table already accepts for a page-at-a-time view.
        const detailed = await Promise.all(
          data.leads.map(async (lead: LeadRow) => {
            const detailRes = await fetch(`/api/admin/leads/${lead.id}`);
            const payload = detailRes.ok ? ((await detailRes.json()).lead.submission.payload as Record<string, unknown>) : {};
            return { ...lead, payload };
          })
        );
        setState({ kind: "ready", rows: detailed, total: data.total });
      } catch {
        setState({ kind: "error" });
      }
    },
    [formId]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(page);
  }, [load, page]);

  function reload() {
    void load(page);
  }

  if (state.kind === "forbidden") {
    return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  }

  const totalPages = state.kind === "ready" ? Math.max(1, Math.ceil(state.total / TAKE)) : 1;

  return (
    <div className="space-y-4">
      {state.kind === "loading" ? <p className="text-sm text-neutral-500">{tCommon("loading")}</p> : null}

      {state.kind === "error" ? (
        <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
          <p className="text-sm text-error">{t("loadError")}</p>
          <button
            type="button"
            onClick={() => {
              setState({ kind: "loading" });
              reload();
            }}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {state.kind === "ready" && state.rows.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6 text-sm text-neutral-500">{t("empty")}</p>
      ) : null}

      {state.kind === "ready" && state.rows.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-surface shadow-card">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500">
                <tr>
                  {columns.map((col) => (
                    <th key={col.header} className="px-4 py-3 text-start">
                      {col.header}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-start">{t("statusHeader")}</th>
                  <th className="px-4 py-3 text-start">{t("submittedHeader")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {state.rows.map((row) => (
                  <tr key={row.id} onClick={() => setSelectedId(row.id)} className="cursor-pointer hover:bg-neutral-50">
                    {columns.map((col) => (
                      <td key={col.header} className="px-4 py-3 text-neutral-700">
                        {col.render(row.payload)}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          row.status === "ARCHIVED" ? "bg-neutral-100 text-neutral-500" : "bg-primary-100 text-primary-700"
                        }`}
                      >
                        {t(`statusLabels.${row.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{new Date(row.submittedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">{t("pageOf", { page, totalPages })}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
              >
                {t("previous")}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
              >
                {t("next")}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {selectedId ? (
        <FilteredLeadDetailModal
          leadId={selectedId}
          namespace={namespace}
          canArchive={canArchive}
          canDelete={canDelete}
          renderDetailFields={renderDetailFields}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
          onDeleted={() => {
            setSelectedId(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-end font-medium text-neutral-800 break-words">{value}</dd>
    </div>
  );
}

function FilteredLeadDetailModal({
  leadId,
  namespace,
  canArchive,
  canDelete,
  renderDetailFields,
  onClose,
  onChanged,
  onDeleted,
}: {
  leadId: string;
  namespace: string;
  canArchive: boolean;
  canDelete: boolean;
  renderDetailFields: (payload: Record<string, unknown>) => ReactNode;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations(namespace);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; lead: LeadDetail }>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadDetail = useCallback(() => {
    setState({ kind: "loading" });
    fetch(`/api/admin/leads/${leadId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((data) => setState({ kind: "ready", lead: data.lead }))
      .catch(() => setState({ kind: "error" }));
  }, [leadId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetail();
  }, [loadDetail]);

  async function handleArchive() {
    if (typeof window !== "undefined" && !window.confirm(t("archiveConfirm"))) return;
    setArchiving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      if (!res.ok) {
        setActionError(t("archiveError"));
        return;
      }
      loadDetail();
      onChanged();
    } catch {
      setActionError(t("archiveError"));
    } finally {
      setArchiving(false);
    }
  }

  async function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, { method: "DELETE" });
      if (!res.ok) {
        setActionError(t("deleteError"));
        return;
      }
      onDeleted();
    } catch {
      setActionError(t("deleteError"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{t("detailTitle")}</h2>

        {state.kind === "loading" ? <p className="mt-4 text-sm text-neutral-500">{t("loading")}</p> : null}
        {state.kind === "error" ? <p className="mt-4 text-sm text-error">{t("loadError")}</p> : null}

        {state.kind === "ready" ? (
          <div className="mt-4 space-y-4 text-sm">
            <dl className="space-y-2">
              <DetailRow label={t("statusHeader")} value={t(`statusLabels.${state.lead.status}`)} />
              <DetailRow label={t("submittedHeader")} value={new Date(state.lead.submission.submittedAt).toLocaleString()} />
              {state.lead.source ? <DetailRow label={t("sourceLabel")} value={state.lead.source} /> : null}
              {state.lead.submission.ipHash ? <DetailRow label={t("ipHashLabel")} value={state.lead.submission.ipHash} /> : null}
            </dl>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t("submittedDataTitle")}</p>
              <dl className="mt-2 space-y-2">{renderDetailFields(state.lead.submission.payload)}</dl>
            </div>

            {actionError ? (
              <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
                {actionError}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {state.kind === "ready" && canArchive && state.lead.status !== "ARCHIVED" ? (
            <button
              type="button"
              onClick={() => void handleArchive()}
              disabled={archiving}
              className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
            >
              {archiving ? t("archiving") : t("archive")}
            </button>
          ) : null}
          {state.kind === "ready" && canDelete ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="min-h-9 rounded-md border border-error/30 px-3 text-sm font-medium text-error hover:bg-error-bg disabled:opacity-60"
            >
              {deleting ? t("deleting") : t("delete")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
