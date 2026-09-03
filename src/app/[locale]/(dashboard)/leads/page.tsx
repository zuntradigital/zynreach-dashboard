"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

type LeadStatus = "NEW" | "ROUTED" | "SYNCED" | "SYNC_FAILED" | "ARCHIVED";

interface LeadRow {
  id: string;
  status: LeadStatus;
  source: string | null;
  campaign: string | null;
  formId: string;
  submittedAt: string;
  crmSyncStatus: string | null;
}

interface LeadOwner {
  id: string;
  name: string | null;
  email: string;
}

interface LeadDetail {
  id: string;
  status: LeadStatus;
  source: string | null;
  campaign: string | null;
  crmSyncStatus: string | null;
  crmSyncedAt: string | null;
  createdAt: string;
  assignedOwnerId: string | null;
  assignedOwner: LeadOwner | null;
  submission: {
    formId: string;
    payload: unknown;
    utm: unknown;
    submittedAt: string;
    ipHash: string | null;
  };
}

interface Filters {
  status: string;
  source: string;
  formId: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = { status: "", source: "", formId: "", dateFrom: "", dateTo: "" };
const TAKE = 20;
const STATUS_OPTIONS: LeadStatus[] = ["NEW", "ROUTED", "SYNCED", "SYNC_FAILED", "ARCHIVED"];

/**
 * SCR-034 — Customer/Sales Leads (Lead+Submission): every CTA form on the
 * public site except Contact, Career Application, and the Subscribers/
 * Partners forms (which now have their own dedicated dashboard sections —
 * see /contact-requests and /subscribers) lands here, distinguished by
 * `formId` (e.g. "trial", "book-a-demo", "enterprise-inquiry") so it's
 * always clear which CTA a lead came from. Job Applicants moved to its
 * own home under Careers (/careers/applicants) — a resume submission and
 * a demo request are a different kind of record (JobApplication has a
 * real jobListingId relation; Lead does not), so they no longer share one
 * undifferentiated list.
 */
function buildQuery(filters: Filters, page: number, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  if (filters.formId) params.set("formId", filters.formId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  params.set("page", String(page));
  params.set("take", String(TAKE));
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  return params.toString();
}

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready"; rows: LeadRow[]; total: number };

const FORM_ID_LABEL_KEYS: Record<string, string> = {
  trial: "formLabels.trial",
  "book-a-demo": "formLabels.demo",
  "enterprise-inquiry": "formLabels.enterpriseInquiry",
  contact: "formLabels.contact",
  "newsletter-signup": "formLabels.newsletterSignup",
  "gated-content-download": "formLabels.gatedContentDownload",
  "partnership-application": "formLabels.partnershipApplication",
};

export default function LeadsPage() {
  const t = useTranslations("dashboard.leads");
  const tCommon = useTranslations("common");
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canArchive, setCanArchive] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const load = useCallback(async (filters: Filters, pageNum: number) => {
    try {
      const [res, sessionRes] = await Promise.all([
        fetch(`/api/admin/leads?${buildQuery(filters, pageNum)}`),
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
        setCanExport(perms.has("leads:export"));
        setCanEdit(perms.has("leads:edit"));
        setCanArchive(perms.has("leads:archive"));
        setCanDelete(perms.has("leads:delete"));
      }
      setState({ kind: "ready", rows: data.leads, total: data.total });
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

  function formLabel(formId: string): string {
    const key = FORM_ID_LABEL_KEYS[formId];
    return key ? t(key) : formId;
  }

  if (state.kind === "forbidden") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
        </div>
        <p className="text-sm text-neutral-500">{t("forbidden")}</p>
      </div>
    );
  }

  const totalPages = state.kind === "ready" ? Math.max(1, Math.ceil(state.total / TAKE)) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
      </div>

      <div className="space-y-4">
        <div className="flex items-start justify-end gap-4">
          {canExport ? (
            <a
              href={`/api/admin/leads?${buildQuery(appliedFilters, 1, { format: "csv" })}`}
              className="min-h-9 shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
            >
              {t("exportCsv")}
            </a>
          ) : null}
        </div>

        <form onSubmit={handleApply} className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-surface shadow-card p-4 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <label className="block text-xs font-medium text-neutral-600">{t("filters.status")}</label>
            <select
              value={draftFilters.status}
              onChange={(e) => setDraftFilters((f) => ({ ...f, status: e.target.value }))}
              className="mt-1 block h-9 w-full rounded-md border border-neutral-300 bg-surface px-2 text-sm"
            >
              <option value="">{t("filters.allStatuses")}</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {t(`statusLabels.${status}`)}
                </option>
              ))}
            </select>
          </div>
          <FilterField label={t("filters.formId")} value={draftFilters.formId} onChange={(v) => setDraftFilters((f) => ({ ...f, formId: v }))} />
          <FilterField label={t("filters.source")} value={draftFilters.source} onChange={(v) => setDraftFilters((f) => ({ ...f, source: v }))} />
          <FilterField type="date" label={t("filters.dateFrom")} value={draftFilters.dateFrom} onChange={(v) => setDraftFilters((f) => ({ ...f, dateFrom: v }))} />
          <FilterField type="date" label={t("filters.dateTo")} value={draftFilters.dateTo} onChange={(v) => setDraftFilters((f) => ({ ...f, dateTo: v }))} />
          <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-5">
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
                    <th className="px-4 py-3 text-start">{t("table.form")}</th>
                    <th className="px-4 py-3 text-start">{t("table.status")}</th>
                    <th className="px-4 py-3 text-start">{t("table.source")}</th>
                    <th className="px-4 py-3 text-start">{t("table.campaign")}</th>
                    <th className="px-4 py-3 text-start">{t("table.submittedAt")}</th>
                    <th className="px-4 py-3 text-start">{t("table.crmSyncStatus")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {state.rows.map((lead) => (
                    <tr key={lead.id} onClick={() => setSelectedLeadId(lead.id)} className="cursor-pointer hover:bg-neutral-50">
                      <td className="px-4 py-3 font-medium text-neutral-800">{formLabel(lead.formId)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
                          {t(`statusLabels.${lead.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{lead.source ?? "—"}</td>
                      <td className="px-4 py-3 text-neutral-600">{lead.campaign ?? "—"}</td>
                      <td className="px-4 py-3 text-neutral-500">{new Date(lead.submittedAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-neutral-500">{lead.crmSyncStatus ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500">{t("pagination.pageOf", { page, totalPages })}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
                >
                  {t("pagination.previous")}
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
                >
                  {t("pagination.next")}
                </button>
              </div>
            </div>
          </>
        ) : null}

        {selectedLeadId ? (
          <LeadDetailModal
            leadId={selectedLeadId}
            canEdit={canEdit}
            canArchive={canArchive}
            canDelete={canDelete}
            onClose={() => setSelectedLeadId(null)}
            onChanged={() => void load(appliedFilters, page)}
            onDeleted={() => {
              setSelectedLeadId(null);
              void load(appliedFilters, page);
            }}
          />
        ) : null}
      </div>
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

type DetailState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; lead: LeadDetail };

function LeadDetailModal({
  leadId,
  canEdit,
  canArchive,
  canDelete,
  onClose,
  onChanged,
  onDeleted,
}: {
  leadId: string;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("dashboard.leads");
  const tCommon = useTranslations("common");
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [showReassign, setShowReassign] = useState(false);
  const [owners, setOwners] = useState<LeadOwner[] | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState("");
  const [reassignSubmitting, setReassignSubmitting] = useState(false);
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

  function openReassign() {
    setActionError(null);
    setSelectedOwnerId(state.kind === "ready" ? (state.lead.assignedOwnerId ?? "") : "");
    setShowReassign(true);
    if (!owners) {
      fetch("/api/admin/leads/assignable-owners")
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
        .then((data) => setOwners(data.owners))
        .catch(() => setOwners([]));
    }
  }

  async function handleReassignSave() {
    setReassignSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedOwnerId: selectedOwnerId || null }),
      });
      if (!res.ok) {
        setActionError(t("detail.reassignError"));
        return;
      }
      setShowReassign(false);
      loadDetail();
      onChanged();
    } catch {
      setActionError(t("detail.reassignError"));
    } finally {
      setReassignSubmitting(false);
    }
  }

  async function handleArchive() {
    if (typeof window !== "undefined" && !window.confirm(t("detail.archiveConfirm"))) return;
    setArchiving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      if (!res.ok) {
        setActionError(t("detail.archiveError"));
        return;
      }
      loadDetail();
      onChanged();
    } catch {
      setActionError(t("detail.archiveError"));
    } finally {
      setArchiving(false);
    }
  }

  async function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm(t("detail.deleteConfirm"))) return;
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, { method: "DELETE" });
      if (!res.ok) {
        setActionError(t("detail.deleteError"));
        return;
      }
      onDeleted();
    } catch {
      setActionError(t("detail.deleteError"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{t("detail.title")}</h2>

        {state.kind === "loading" ? <p className="mt-4 text-sm text-neutral-500">{tCommon("loading")}</p> : null}
        {state.kind === "error" ? <p className="mt-4 text-sm text-error">{t("loadError")}</p> : null}

        {state.kind === "ready" ? (
          <div className="mt-4 space-y-4 text-sm">
            <dl className="space-y-2">
              <DetailRow label={t("table.form")} value={state.lead.submission.formId} />
              <DetailRow label={t("table.status")} value={t(`statusLabels.${state.lead.status}`)} />
              <DetailRow label={t("table.source")} value={state.lead.source ?? t("detail.none")} />
              <DetailRow label={t("table.campaign")} value={state.lead.campaign ?? t("detail.none")} />
              <DetailRow label={t("table.submittedAt")} value={new Date(state.lead.submission.submittedAt).toLocaleString()} />
              <DetailRow label={t("table.crmSyncStatus")} value={state.lead.crmSyncStatus ?? t("detail.none")} />
              <DetailRow label={t("detail.ipHash")} value={state.lead.submission.ipHash ?? t("detail.none")} />
              <DetailRow
                label={t("detail.assignedOwner")}
                value={
                  state.lead.assignedOwner
                    ? `${state.lead.assignedOwner.name ?? state.lead.assignedOwner.email} (${state.lead.assignedOwner.email})`
                    : t("detail.unassigned")
                }
              />
            </dl>

            {actionError ? (
              <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
                {actionError}
              </div>
            ) : null}

            {showReassign ? (
              <div className="rounded-md border border-neutral-200 p-3">
                <label className="block text-xs font-medium text-neutral-600">{t("detail.assignedOwner")}</label>
                <select
                  value={selectedOwnerId}
                  onChange={(e) => setSelectedOwnerId(e.target.value)}
                  disabled={!owners}
                  className="mt-1 block h-9 w-full rounded-md border border-neutral-300 bg-surface px-2 text-sm"
                >
                  <option value="">{t("detail.unassigned")}</option>
                  {(owners ?? []).map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name ?? owner.email} ({owner.email})
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReassign(false)}
                    disabled={reassignSubmitting}
                    className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                  >
                    {t("detail.reassignCancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReassignSave()}
                    disabled={reassignSubmitting}
                    className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                  >
                    {reassignSubmitting ? t("detail.reassignSaving") : t("detail.reassignSave")}
                  </button>
                </div>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t("detail.payload")}</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-neutral-50 p-2 text-xs text-neutral-700">
                {JSON.stringify(state.lead.submission.payload, null, 2)}
              </pre>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t("detail.utm")}</p>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-neutral-50 p-2 text-xs text-neutral-700">
                {state.lead.submission.utm ? JSON.stringify(state.lead.submission.utm, null, 2) : t("detail.none")}
              </pre>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {state.kind === "ready" && canEdit && !showReassign ? (
            <button
              type="button"
              onClick={openReassign}
              className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
            >
              {t("detail.reassign")}
            </button>
          ) : null}
          {state.kind === "ready" && canArchive && state.lead.status !== "ARCHIVED" ? (
            <button
              type="button"
              onClick={() => void handleArchive()}
              disabled={archiving}
              className="min-h-9 rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
            >
              {archiving ? t("detail.archiving") : t("detail.archive")}
            </button>
          ) : null}
          {state.kind === "ready" && canDelete ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="min-h-9 rounded-md border border-error/30 px-3 text-sm font-medium text-error hover:bg-error-bg disabled:opacity-60"
            >
              {deleting ? t("detail.deleting") : t("detail.delete")}
            </button>
          ) : null}
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
