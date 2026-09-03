"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ActionButton } from "@/components/ui/ActionButton";

type ApplicationStatus = "NEW" | "REVIEWED" | "ARCHIVED";
const STATUS_OPTIONS: ApplicationStatus[] = ["NEW", "REVIEWED", "ARCHIVED"];
const STATUS_BADGE_CLASS: Record<ApplicationStatus, string> = {
  NEW: "bg-primary-100 text-primary-700",
  REVIEWED: "bg-emerald-100 text-emerald-700",
  ARCHIVED: "bg-neutral-100 text-neutral-500",
};

interface ApplicationRow {
  id: string;
  fullName: string;
  email: string;
  jobTitleSnapshot: string;
  submittedAt: string;
  status: ApplicationStatus;
  jobListing: { id: string; slug: string; status: string } | null;
}

interface ApplicationDetail {
  id: string;
  fullName: string;
  email: string;
  portfolioUrl: string | null;
  gender: string | null;
  veteranStatus: string | null;
  jobTitleSnapshot: string;
  status: ApplicationStatus;
  resumeUrl: string;
  resumeFilename: string;
  resumeFileType: string;
  resumeFileSize: number;
  submittedAt: string;
  jobListing: { id: string; slug: string; status: string } | null;
}

const TAKE = 20;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-end font-medium text-neutral-800">{value}</dd>
    </div>
  );
}

type AppLoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready"; rows: ApplicationRow[]; total: number };

/**
 * Careers → Job Applicants (SCR-015 sibling). Source of truth is
 * JobApplication (a real jobListingId relation to JobListing) — the
 * applicant is always linked to the exact job they applied for, never an
 * arbitrary string. Reuses the existing /api/admin/careers/applications
 * APIs unchanged; this component only adds review-state (status) and
 * delete on top of the already-working list/detail/resume-download flow.
 */
export function JobApplicantsPanel({ initialJobListingId }: { initialJobListingId: string | null }) {
  const t = useTranslations("dashboard.careersApplications");
  const [jobListingId, setJobListingId] = useState<string | null>(initialJobListingId);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<AppLoadState>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const load = useCallback(async (jlId: string | null, status: string, pageNum: number) => {
    try {
      const params = new URLSearchParams();
      if (jlId) params.set("jobListingId", jlId);
      if (status) params.set("status", status);
      params.set("page", String(pageNum));
      params.set("take", String(TAKE));
      const [res, sessionRes] = await Promise.all([
        fetch(`/api/admin/careers/applications?${params.toString()}`),
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
        setCanEdit(perms.has("careers:edit"));
        setCanDelete(perms.has("careers:delete"));
      }
      setState({ kind: "ready", rows: data.applications, total: data.total });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(jobListingId, statusFilter, page);
  }, [load, jobListingId, statusFilter, page]);

  function reload() {
    void load(jobListingId, statusFilter, page);
  }

  if (state.kind === "forbidden") {
    return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  }

  const totalPages = state.kind === "ready" ? Math.max(1, Math.ceil(state.total / TAKE)) : 1;
  const filteredJobTitle = state.kind === "ready" ? state.rows[0]?.jobTitleSnapshot : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-600">
            {jobListingId && filteredJobTitle ? t("subtitleFiltered", { job: filteredJobTitle }) : t("subtitle")}
          </p>
          {jobListingId ? (
            <button
              type="button"
              onClick={() => {
                setJobListingId(null);
                setPage(1);
                setState({ kind: "loading" });
              }}
              className="mt-1 text-sm text-primary-600 hover:underline"
            >
              {t("clearFilter")}
            </button>
          ) : null}
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600">{t("filters.status")}</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
              setState({ kind: "loading" });
            }}
            className="mt-1 block h-9 w-44 rounded-md border border-neutral-300 bg-surface px-2 text-sm"
          >
            <option value="">{t("filters.allStatuses")}</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {t(`statusLabels.${status}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state.kind === "loading" ? <p className="text-sm text-neutral-500">{t("loading")}</p> : null}

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
                  <th className="px-4 py-3 text-start">{t("applicantHeader")}</th>
                  <th className="px-4 py-3 text-start">{t("emailHeader")}</th>
                  <th className="px-4 py-3 text-start">{t("jobHeader")}</th>
                  <th className="px-4 py-3 text-start">{t("statusHeader")}</th>
                  <th className="px-4 py-3 text-start">{t("submittedHeader")}</th>
                  <th className="px-4 py-3 text-start">{t("actionsHeader")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {state.rows.map((row) => (
                  <tr key={row.id} onClick={() => setSelectedId(row.id)} className="cursor-pointer hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-800">{row.fullName}</td>
                    <td className="px-4 py-3 text-neutral-600">{row.email}</td>
                    <td className="px-4 py-3 text-neutral-600">
                      {row.jobTitleSnapshot}
                      {!row.jobListing ? <span className="ms-2 text-xs text-neutral-400">({t("jobDeletedHint")})</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                        {t(`statusLabels.${row.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{new Date(row.submittedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <ActionButton
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(row.id);
                        }}
                      >
                        {t("view")}
                      </ActionButton>
                    </td>
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

      {selectedId ? (
        <JobApplicantDetailModal
          id={selectedId}
          canEdit={canEdit}
          canDelete={canDelete}
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

type AppDetailState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; application: ApplicationDetail };

function JobApplicantDetailModal({
  id,
  canEdit,
  canDelete,
  onClose,
  onChanged,
  onDeleted,
}: {
  id: string;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("dashboard.careersApplications");
  const [state, setState] = useState<AppDetailState>({ kind: "loading" });
  const [statusSaving, setStatusSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadDetail = useCallback(() => {
    setState({ kind: "loading" });
    fetch(`/api/admin/careers/applications/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((data) => setState({ kind: "ready", application: data.application }))
      .catch(() => setState({ kind: "error" }));
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetail();
  }, [loadDetail]);

  async function handleStatusChange(nextStatus: ApplicationStatus) {
    setStatusSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/careers/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        setActionError(t("statusUpdateError"));
        return;
      }
      loadDetail();
      onChanged();
    } catch {
      setActionError(t("statusUpdateError"));
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/careers/applications/${id}`, { method: "DELETE" });
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
        {state.kind === "loading" ? <p className="text-sm text-neutral-500">{t("loading")}</p> : null}
        {state.kind === "error" ? <p className="text-sm text-error">{t("loadError")}</p> : null}

        {state.kind === "ready" ? (
          <>
            <span className="inline-block rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700">
              {t("sourceBadge")}
            </span>
            <h2 className="mt-2 text-base font-semibold text-neutral-900">{state.application.fullName}</h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              {t("appliedFor")}: {state.application.jobTitleSnapshot}
              {!state.application.jobListing ? ` (${t("jobDeletedHint")})` : ""}
            </p>

            <div className="mt-4">
              <h3 className="text-sm font-semibold text-neutral-900">{t("applicantInfoTitle")}</h3>
              <dl className="mt-2 space-y-2 text-sm">
                <DetailRow label={t("fullNameLabel")} value={state.application.fullName} />
                <DetailRow label={t("emailLabel")} value={state.application.email} />
                <DetailRow label={t("portfolioLabel")} value={state.application.portfolioUrl ?? "—"} />
                <DetailRow label={t("submittedLabel")} value={new Date(state.application.submittedAt).toLocaleString()} />
                <DetailRow label={t("genderLabel")} value={state.application.gender ?? "—"} />
                <DetailRow label={t("veteranStatusLabel")} value={state.application.veteranStatus ?? "—"} />
              </dl>
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-semibold text-neutral-900">{t("resumeTitle")}</h3>
              <p className="mt-1 text-sm text-neutral-700">{state.application.resumeFilename}</p>
              <p className="text-xs text-neutral-500">
                {state.application.resumeFileType} · {formatBytes(state.application.resumeFileSize)}
              </p>
              <a
                href={`/api/admin/careers/applications/${state.application.id}/resume`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm font-medium text-primary-600 hover:underline"
              >
                {t("downloadResume")}
              </a>
            </div>

            {canEdit ? (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-neutral-900">{t("statusHeader")}</h3>
                <select
                  value={state.application.status}
                  disabled={statusSaving}
                  onChange={(e) => void handleStatusChange(e.target.value as ApplicationStatus)}
                  className="mt-1.5 block h-9 w-full rounded-md border border-neutral-300 bg-surface px-2 text-sm disabled:opacity-60"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {t(`statusLabels.${status}`)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mt-4">
                <DetailRow label={t("statusHeader")} value={t(`statusLabels.${state.application.status}`)} />
              </div>
            )}

            {actionError ? (
              <div role="alert" className="mt-3 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
                {actionError}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
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
