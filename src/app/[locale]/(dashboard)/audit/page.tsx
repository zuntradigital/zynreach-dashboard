"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

interface AuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  result: "SUCCESS" | "DENIED" | "ERROR";
  ipAddress: string | null;
  sessionId: string | null;
  createdAt: string;
}

interface Filters {
  action: string;
  result: string;
  actorEmail: string;
  resourceType: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = { action: "", result: "", actorEmail: "", resourceType: "", dateFrom: "", dateTo: "" };
const TAKE = 25;

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready"; rows: AuditRow[]; total: number };

function buildQuery(filters: Filters, page: number, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.result) params.set("result", filters.result);
  if (filters.actorEmail) params.set("actorEmail", filters.actorEmail);
  if (filters.resourceType) params.set("resourceType", filters.resourceType);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  params.set("page", String(page));
  params.set("take", String(TAKE));
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  return params.toString();
}

export default function AuditLogPage() {
  const t = useTranslations("dashboard.audit");
  const tCommon = useTranslations("common");
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedRow, setSelectedRow] = useState<AuditRow | null>(null);

  const load = useCallback(async (filters: Filters, pageNum: number) => {
    try {
      const res = await fetch(`/api/admin/audit-log?${buildQuery(filters, pageNum)}`);
      if (res.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = await res.json();
      setState({ kind: "ready", rows: data.rows, total: data.total });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(appliedFilters, page);
  }, [load, appliedFilters, page]);

  function handleApply(event: FormEvent) {
    event.preventDefault();
    setState({ kind: "loading" });
    setPage(1);
    setAppliedFilters(draftFilters);
  }

  function handleClear() {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
    setState({ kind: "loading" });
  }

  if (state.kind === "forbidden") {
    return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  }

  const totalPages = state.kind === "ready" ? Math.max(1, Math.ceil(state.total / TAKE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
        </div>
        <a
          href={`/api/admin/audit-log?${buildQuery(appliedFilters, 1, { format: "csv" })}`}
          className="min-h-9 shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
        >
          {t("exportCsv")}
        </a>
      </div>

      <form onSubmit={handleApply} className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-surface shadow-card p-4 sm:grid-cols-3 lg:grid-cols-6">
        <FilterField label={t("filters.action")} value={draftFilters.action} onChange={(v) => setDraftFilters((f) => ({ ...f, action: v }))} />
        <div>
          <label className="block text-xs font-medium text-neutral-600">{t("filters.result")}</label>
          <select
            value={draftFilters.result}
            onChange={(e) => setDraftFilters((f) => ({ ...f, result: e.target.value }))}
            className="mt-1 block h-9 w-full rounded-md border border-neutral-300 bg-surface px-2 text-sm"
          >
            <option value="">{t("filters.allResults")}</option>
            <option value="SUCCESS">{t("resultLabels.SUCCESS")}</option>
            <option value="DENIED">{t("resultLabels.DENIED")}</option>
            <option value="ERROR">{t("resultLabels.ERROR")}</option>
          </select>
        </div>
        <FilterField label={t("filters.actorEmail")} value={draftFilters.actorEmail} onChange={(v) => setDraftFilters((f) => ({ ...f, actorEmail: v }))} />
        <FilterField label={t("filters.resourceType")} value={draftFilters.resourceType} onChange={(v) => setDraftFilters((f) => ({ ...f, resourceType: v }))} />
        <FilterField type="date" label={t("filters.dateFrom")} value={draftFilters.dateFrom} onChange={(v) => setDraftFilters((f) => ({ ...f, dateFrom: v }))} />
        <FilterField type="date" label={t("filters.dateTo")} value={draftFilters.dateTo} onChange={(v) => setDraftFilters((f) => ({ ...f, dateTo: v }))} />
        <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-6">
          <button type="submit" className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700">
            {t("filters.apply")}
          </button>
          <button type="button" onClick={handleClear} className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
            {t("filters.clear")}
          </button>
        </div>
      </form>

      {state.kind === "loading" ? <p className="text-sm text-neutral-500">{tCommon("loading")}</p> : null}

      {state.kind === "error" ? (
        <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
          <p className="text-sm text-error">{t("loadError")}</p>
          <button
            type="button"
            onClick={() => {
              setState({ kind: "loading" });
              void load(appliedFilters, page);
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
                  <th className="px-4 py-3 text-start">{t("table.timestamp")}</th>
                  <th className="px-4 py-3 text-start">{t("table.actor")}</th>
                  <th className="px-4 py-3 text-start">{t("table.action")}</th>
                  <th className="px-4 py-3 text-start">{t("table.resource")}</th>
                  <th className="px-4 py-3 text-start">{t("table.result")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {state.rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedRow(row)}
                    className="cursor-pointer hover:bg-neutral-50"
                  >
                    <td className="px-4 py-3 text-neutral-500">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-neutral-700">{row.actorEmail ?? "—"}</td>
                    <td className="px-4 py-3 font-medium text-neutral-800">{row.action}</td>
                    <td className="px-4 py-3 text-neutral-600">
                      {row.resourceType ? `${row.resourceType}${row.resourceId ? ` #${row.resourceId.slice(0, 8)}` : ""}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <ResultBadge result={row.result} label={t(`resultLabels.${row.result}`)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} t={t} />
        </>
      ) : null}

      {selectedRow ? <AuditDetailDrawer row={selectedRow} onClose={() => setSelectedRow(null)} t={t} /> : null}
    </div>
  );
}

function FilterField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-600">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
      />
    </div>
  );
}

function ResultBadge({ result, label }: { result: "SUCCESS" | "DENIED" | "ERROR"; label: string }) {
  const styles: Record<string, string> = {
    SUCCESS: "bg-success-bg text-success",
    DENIED: "bg-error-bg text-error",
    ERROR: "bg-error-bg text-error",
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles[result]}`}>{label}</span>;
}

function Pagination({
  page,
  totalPages,
  onChange,
  t,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-neutral-500">{t("pagination.pageOf", { page, totalPages })}</span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
        >
          {t("pagination.previous")}
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
        >
          {t("pagination.next")}
        </button>
      </div>
    </div>
  );
}

function AuditDetailDrawer({
  row,
  onClose,
  t,
}: {
  row: AuditRow;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{t("detail.title")}</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <DetailRow label={t("table.timestamp")} value={new Date(row.createdAt).toLocaleString()} />
          <DetailRow label={t("table.actor")} value={row.actorEmail ?? t("detail.none")} />
          <DetailRow label={t("table.action")} value={row.action} />
          <DetailRow label={t("table.resource")} value={row.resourceType ? `${row.resourceType} ${row.resourceId ?? ""}` : t("detail.none")} />
          <DetailRow label={t("detail.ipAddress")} value={row.ipAddress ?? t("detail.none")} />
          <DetailRow label={t("detail.sessionId")} value={row.sessionId ?? t("detail.none")} />
        </dl>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t("detail.before")}</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-neutral-50 p-2 text-xs text-neutral-700">
              {row.before ? JSON.stringify(row.before, null, 2) : t("detail.none")}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t("detail.after")}</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-neutral-50 p-2 text-xs text-neutral-700">
              {row.after ? JSON.stringify(row.after, null, 2) : t("detail.none")}
            </pre>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            {t("detail.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-end font-medium text-neutral-800">{value}</dd>
    </div>
  );
}
