"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TextField } from "@/components/ui/TextField";
import { ActionButton } from "@/components/ui/ActionButton";
import { ReauthModal } from "@/components/ReauthModal";

interface AdminUserRow {
  id: string;
  name: string | null;
  email: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  roles: { id: string; name: string }[];
}

interface RoleOption {
  id: string;
  name: string;
  description: string | null;
}

interface InvitationOutcome {
  emailSent: boolean;
  emailError: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready"; users: AdminUserRow[]; roles: RoleOption[]; currentUserId: string };

export default function UsersPage() {
  const t = useTranslations("dashboard.users");
  const tCommon = useTranslations("common");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [resendingUserId, setResendingUserId] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [usersRes, rolesRes, sessionRes] = await Promise.all([
        fetch("/api/admin/admin-users"),
        fetch("/api/admin/roles"),
        fetch("/api/admin/auth/session"),
      ]);

      if (usersRes.status === 403 || rolesRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (!usersRes.ok || !rolesRes.ok || !sessionRes.ok) {
        setState({ kind: "error" });
        return;
      }

      const usersData = await usersRes.json();
      const rolesData = await rolesRes.json();
      const sessionData = await sessionRes.json();
      setState({ kind: "ready", users: usersData.users, roles: rolesData.roles, currentUserId: sessionData.user.id });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function handleInvitationOutcome(outcome: InvitationOutcome) {
    void load();
    if (outcome.emailSent) {
      setInviteNotice(t("invitationSentSuccess"));
      setInviteError(null);
    } else {
      setInviteNotice(null);
      setInviteError(t("invitationSendFailed", { reason: outcome.emailError ?? t("resendError") }));
    }
  }

  async function handleDelete(userId: string) {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setDeletingUserId(userId);
    setDeleteError(null);
    setDeleteNotice(null);
    try {
      const res = await fetch(`/api/admin/admin-users/${userId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error ?? t("deleteError"));
        return;
      }
      setState((prev) =>
        prev.kind === "ready" ? { ...prev, users: prev.users.filter((u) => u.id !== userId) } : prev
      );
      setDeleteNotice(t("deleteSuccessRemoved"));
    } catch {
      setDeleteError(t("deleteError"));
    } finally {
      setDeletingUserId(null);
    }
  }

  async function toggleStatus(userId: string, nextStatus: "ACTIVE" | "DEACTIVATED") {
    setTogglingUserId(userId);
    setStatusError(null);
    try {
      const res = await fetch(`/api/admin/admin-users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        setStatusError(t("statusUpdateError"));
        return;
      }
      setState((prev) =>
        prev.kind === "ready"
          ? { ...prev, users: prev.users.map((u) => (u.id === userId ? { ...u, status: nextStatus } : u)) }
          : prev
      );
    } catch {
      setStatusError(t("statusUpdateError"));
    } finally {
      setTogglingUserId(null);
    }
  }

  async function handleResendInvitation(userId: string) {
    setResendingUserId(userId);
    setResendError(null);
    try {
      const res = await fetch(`/api/admin/admin-users/${userId}/resend-invitation`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResendError(data.error ?? t("resendError"));
        return;
      }
      handleInvitationOutcome({ emailSent: data.invitation.emailSent, emailError: data.invitation.emailError ?? null });
    } catch {
      setResendError(t("resendError"));
    } finally {
      setResendingUserId(null);
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
        {state.kind === "ready" ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="min-h-9 shrink-0 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
          >
            {t("createUser")}
          </button>
        ) : null}
      </div>

      {statusError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {statusError}
        </div>
      ) : null}

      {deleteError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {deleteError}
        </div>
      ) : null}

      {deleteNotice ? (
        <div role="status" className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">
          {deleteNotice}
        </div>
      ) : null}

      {resendError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {resendError}
        </div>
      ) : null}

      {inviteNotice ? (
        <div role="status" className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">
          {inviteNotice}
        </div>
      ) : null}

      {inviteError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {inviteError}
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
              void load();
            }}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {state.kind === "ready" && state.users.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6 text-sm text-neutral-500">{t("empty")}</p>
      ) : null}

      {state.kind === "ready" && state.users.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-surface shadow-card">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 text-start">{t("nameHeader")}</th>
                <th className="px-4 py-3 text-start">{t("emailHeader")}</th>
                <th className="px-4 py-3 text-start">{t("statusHeader")}</th>
                <th className="px-4 py-3 text-start">{t("rolesHeader")}</th>
                <th className="px-4 py-3 text-start">{t("mfaHeader")}</th>
                <th className="px-4 py-3 text-start">{t("lastLoginHeader")}</th>
                <th className="px-4 py-3 text-start">{t("actionsHeader")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {state.users.map((user) => {
                const isSelf = user.id === state.currentUserId;
                return (
                  <tr key={user.id}>
                    <td className="px-4 py-3 font-medium text-neutral-800">{user.name ?? t("noName")}</td>
                    <td className="px-4 py-3 text-neutral-600">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
                        {t(`statusLabels.${user.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {user.roles.map((r) => t(`roleNames.${r.name}`)).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{user.mfaEnabled ? "✓" : "—"}</td>
                    <td className="px-4 py-3 text-neutral-500">
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : t("never")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {user.status === "PENDING" ? (
                          <ActionButton
                            tone="neutral"
                            onClick={() => void handleResendInvitation(user.id)}
                            disabled={resendingUserId === user.id}
                          >
                            {resendingUserId === user.id ? t("resendingInvitation") : t("resendInvitation")}
                          </ActionButton>
                        ) : null}
                        <ActionButton
                          onClick={() => setEditingUserId(user.id)}
                          disabled={isSelf}
                          title={isSelf ? t("selfEditBlocked") : undefined}
                        >
                          {t("manageRoles")}
                        </ActionButton>
                        <ActionButton
                          tone="neutral"
                          onClick={() => void toggleStatus(user.id, user.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE")}
                          disabled={isSelf || togglingUserId === user.id}
                          title={isSelf ? t("selfStatusBlocked") : undefined}
                        >
                          {user.status === "ACTIVE" ? t("deactivate") : t("reactivate")}
                        </ActionButton>
                        <ActionButton
                          tone="danger"
                          onClick={() => void handleDelete(user.id)}
                          disabled={isSelf || deletingUserId === user.id}
                          title={isSelf ? t("selfDeleteBlocked") : undefined}
                        >
                          {deletingUserId === user.id ? t("deleting") : t("delete")}
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {state.kind === "ready" && editingUserId ? (
        <RoleAssignmentModal
          user={state.users.find((u) => u.id === editingUserId)!}
          allRoles={state.roles}
          onClose={() => setEditingUserId(null)}
          onSaved={(updatedRoles) => {
            setState((prev) =>
              prev.kind === "ready"
                ? {
                    ...prev,
                    users: prev.users.map((u) => (u.id === editingUserId ? { ...u, roles: updatedRoles } : u)),
                  }
                : prev
            );
            setEditingUserId(null);
          }}
        />
      ) : null}

      {state.kind === "ready" && showCreate ? (
        <CreateUserModal
          allRoles={state.roles}
          onClose={() => setShowCreate(false)}
          onCreated={(outcome) => {
            setShowCreate(false);
            handleInvitationOutcome(outcome);
          }}
        />
      ) : null}
    </div>
  );
}

interface RoleAssignmentModalProps {
  user: AdminUserRow;
  allRoles: RoleOption[];
  onClose: () => void;
  onSaved: (roles: { id: string; name: string }[]) => void;
}

function RoleAssignmentModal({ user, allRoles, onClose, onSaved }: RoleAssignmentModalProps) {
  const t = useTranslations("dashboard.users");
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set(user.roles.map((r) => r.id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingReauth, setPendingReauth] = useState(false);

  function toggleRole(roleId: string) {
    setSelectedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  // Assigning Super Administrator requires fresh re-authentication (same
  // requireFreshSensitiveVerification gate the Role & Permission Matrix
  // Editor already uses) — a 401 here means the API rejected the request
  // pending that step, not a normal save failure.
  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/admin-users/${user.id}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds: Array.from(selectedRoleIds) }),
      });
      if (res.status === 401) {
        setPendingReauth(true);
        return;
      }
      if (!res.ok) {
        setError(t("saveError"));
        return;
      }
      onSaved(allRoles.filter((r) => selectedRoleIds.has(r.id)).map((r) => ({ id: r.id, name: r.name })));
    } catch {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{user.name ?? user.email}</h2>
        <p className="mt-0.5 text-sm text-neutral-500">{user.email}</p>

        {error ? (
          <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        <fieldset className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          <legend className="sr-only">{t("rolesHeader")}</legend>
          {allRoles.map((role) => (
            <label key={role.id} className="flex items-start gap-2.5 rounded-md p-2 hover:bg-neutral-50">
              <input
                type="checkbox"
                checked={selectedRoleIds.has(role.id)}
                onChange={() => toggleRole(role.id)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-800">{t(`roleNames.${role.name}`)}</span>
                <span className="block text-xs text-neutral-500">{t(`roleDescriptions.${role.name}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>

      {pendingReauth ? (
        <ReauthModal
          onCancel={() => setPendingReauth(false)}
          onConfirmed={() => {
            setPendingReauth(false);
            void handleSave();
          }}
        />
      ) : null}
    </div>
  );
}

interface CreateUserModalProps {
  allRoles: RoleOption[];
  onClose: () => void;
  onCreated: (outcome: InvitationOutcome) => void;
}

/**
 * SRS §23 account creation ("invite → pending → active") — admin-
 * initiated only. There is no public sign-up route in System B; every
 * account is created here, by an already-authenticated Super
 * Administrator, matching §7 Actors (one human actor type: internal
 * staff) and §29's `POST /api/admin/users — Session + Users:Create`.
 */
function CreateUserModal({ allRoles, onClose, onCreated }: CreateUserModalProps) {
  const t = useTranslations("dashboard.users");
  const [email, setEmail] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingReauth, setPendingReauth] = useState(false);

  function toggleRole(roleId: string) {
    setSelectedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  // Inviting a user directly into Super Administrator requires fresh
  // re-authentication (same requireFreshSensitiveVerification gate the
  // Role & Permission Matrix Editor already uses) — a 401 here means the
  // API rejected the request pending that step, not a normal create failure.
  async function submitInvite() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, roleIds: Array.from(selectedRoleIds) }),
      });
      if (res.status === 401) {
        setPendingReauth(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setError(t("emailTaken"));
        return;
      }
      if (!res.ok) {
        setError(t("createError"));
        return;
      }
      onCreated({ emailSent: data.invitation.emailSent, emailError: data.invitation.emailError ?? null });
    } catch {
      setError(t("createError"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (selectedRoleIds.size === 0) {
      setError(t("selectRoleRequired"));
      return;
    }
    void submitInvite();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{t("createUserTitle")}</h2>
        <p className="mt-0.5 text-sm text-neutral-500">{t("createUserSubtitle")}</p>

        {error ? (
          <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
          <TextField label={t("emailLabel")} name="email" type="email" value={email} onChange={setEmail} required autoFocus />

          <fieldset className="max-h-56 space-y-2 overflow-y-auto">
            <legend className="mb-1 block text-xs font-medium text-neutral-600">{t("selectRolesLabel")}</legend>
            {allRoles.map((role) => (
              <label key={role.id} className="flex items-start gap-2.5 rounded-md p-2 hover:bg-neutral-50">
                <input
                  type="checkbox"
                  checked={selectedRoleIds.has(role.id)}
                  onChange={() => toggleRole(role.id)}
                  className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                />
                <span>
                  <span className="block text-sm font-medium text-neutral-800">{t(`roleNames.${role.name}`)}</span>
                  <span className="block text-xs text-neutral-500">{t(`roleDescriptions.${role.name}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

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

      {pendingReauth ? (
        <ReauthModal
          onCancel={() => setPendingReauth(false)}
          onConfirmed={() => {
            setPendingReauth(false);
            void submitInvite();
          }}
        />
      ) : null}
    </div>
  );
}
