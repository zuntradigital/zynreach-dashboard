"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ReauthModal } from "@/components/ReauthModal";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  mfaRequired: boolean;
  permissionIds: string[];
}

interface PermissionOption {
  id: string;
  module: string;
  action: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready" };

function permissionKey(p: PermissionOption) {
  return `${p.module}:${p.action}`;
}

function permissionLabel(p: PermissionOption, t: ReturnType<typeof useTranslations>) {
  return `${t(`moduleNames.${p.module}`)}: ${t(`actionNames.${p.action}`)}`;
}

export default function RolesPage() {
  const t = useTranslations("dashboard.roles");
  const tUsers = useTranslations("dashboard.users");
  const tCommon = useTranslations("common");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [permissions, setPermissions] = useState<PermissionOption[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [originalByRole, setOriginalByRole] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [savedRoleIds, setSavedRoleIds] = useState<Set<string>>(new Set());
  const [globalMessage, setGlobalMessage] = useState<"success" | "noChanges" | null>(null);
  const [pendingReauth, setPendingReauth] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rolesRes, permsRes] = await Promise.all([
        fetch("/api/admin/roles"),
        fetch("/api/admin/permissions"),
      ]);
      if (rolesRes.status === 403 || permsRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (!rolesRes.ok || !permsRes.ok) {
        setState({ kind: "error" });
        return;
      }
      const rolesData = await rolesRes.json();
      const permsData = await permsRes.json();
      setRoles(rolesData.roles);
      setPermissions(permsData.permissions);
      const baseline: Record<string, string[]> = {};
      for (const role of rolesData.roles as RoleRow[]) baseline[role.id] = [...role.permissionIds].sort();
      setOriginalByRole(baseline);
      setSavedRoleIds(new Set());
      setRowError({});
      setGlobalMessage(null);
      setState({ kind: "ready" });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function togglePermission(roleId: string, permissionId: string) {
    setRoles((prev) =>
      prev.map((role) => {
        if (role.id !== roleId) return role;
        const has = role.permissionIds.includes(permissionId);
        return {
          ...role,
          permissionIds: has
            ? role.permissionIds.filter((id) => id !== permissionId)
            : [...role.permissionIds, permissionId],
        };
      })
    );
    setRowError((prev) => {
      if (!(roleId in prev)) return prev;
      const next = { ...prev };
      delete next[roleId];
      return next;
    });
    setSavedRoleIds((prev) => {
      if (!prev.has(roleId)) return prev;
      const next = new Set(prev);
      next.delete(roleId);
      return next;
    });
    setGlobalMessage(null);
  }

  function isDirty(role: RoleRow) {
    const original = originalByRole[role.id] ?? [];
    const current = [...role.permissionIds].sort();
    return original.length !== current.length || original.some((id, i) => id !== current[i]);
  }

  const dirtyRoles = roles.filter(isDirty);

  /**
   * Single bottom-of-table Save button covers every role the administrator
   * touched, not just one row — each dirty role still goes through its own
   * PUT /api/admin/roles/{id}/permissions (there is no batch endpoint; that
   * write path is exactly what already enforces rbac:manage + fresh re-auth
   * + the Super Administrator self-lockout guard + session invalidation +
   * audit logging), but the UI now drives all of them from one click rather
   * than exposing that per-role.
   */
  async function saveAllChanges() {
    const toSave = roles.filter(isDirty);
    if (toSave.length === 0) {
      setGlobalMessage("noChanges");
      return;
    }

    setSaving(true);
    setGlobalMessage(null);

    const succeededIds: string[] = [];
    const newRowError: Record<string, string> = {};
    let hitReauth = false;

    for (const role of toSave) {
      try {
        const res = await fetch(`/api/admin/roles/${role.id}/permissions`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissionIds: role.permissionIds }),
        });

        if (res.status === 401) {
          hitReauth = true;
          break;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          newRowError[role.id] = data.error || t("saveError");
          continue;
        }

        succeededIds.push(role.id);
      } catch {
        newRowError[role.id] = t("saveError");
      }
    }

    if (succeededIds.length > 0) {
      setOriginalByRole((prev) => {
        const next = { ...prev };
        for (const id of succeededIds) {
          const role = roles.find((r) => r.id === id);
          if (role) next[id] = [...role.permissionIds].sort();
        }
        return next;
      });
      setSavedRoleIds((prev) => new Set([...prev, ...succeededIds]));
    }

    setRowError((prev) => {
      const next = { ...prev, ...newRowError };
      for (const id of succeededIds) delete next[id];
      return next;
    });
    setSaving(false);

    if (hitReauth) {
      setPendingReauth(true);
      return;
    }

    if (Object.keys(newRowError).length === 0) {
      setGlobalMessage("success");
    }
  }

  if (state.kind === "forbidden") {
    return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
      </div>

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

      {state.kind === "ready" && roles.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6 text-sm text-neutral-500">{t("empty")}</p>
      ) : null}

      {state.kind === "ready" && roles.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-surface shadow-card">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 text-start">{t("roleHeader")}</th>
                  {permissions.map((permission) => (
                    <th key={permission.id} title={permissionKey(permission)} className="px-4 py-3 text-center normal-case">
                      {permissionLabel(permission, t)}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-start" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-neutral-800">{tUsers(`roleNames.${role.name}`)}</p>
                      {role.mfaRequired ? (
                        <p className="text-xs text-neutral-500">MFA</p>
                      ) : null}
                    </td>
                    {permissions.map((permission) => (
                      <td key={permission.id} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={role.permissionIds.includes(permission.id)}
                          onChange={() => togglePermission(role.id, permission.id)}
                          className="h-4 w-4 rounded border-neutral-300"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-end align-top">
                      {isDirty(role) ? (
                        <span className="text-xs font-medium text-amber-600">{t("unsavedChanges")}</span>
                      ) : savedRoleIds.has(role.id) ? (
                        <span className="text-xs text-success">✓</span>
                      ) : null}
                      {rowError[role.id] ? (
                        <p role="alert" className="mt-1 text-xs text-error">
                          {rowError[role.id]}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveAllChanges()}
              disabled={saving || dirtyRoles.length === 0}
              className="min-h-9 rounded-md bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? t("saving") : t("saveChanges")}
            </button>
            {globalMessage === "success" ? <span className="text-sm text-success">{t("saveSuccess")}</span> : null}
            {globalMessage === "noChanges" ? <span className="text-sm text-neutral-500">{t("noChanges")}</span> : null}
          </div>
        </>
      ) : null}

      {pendingReauth ? (
        <ReauthModal
          onCancel={() => setPendingReauth(false)}
          onConfirmed={() => {
            setPendingReauth(false);
            void saveAllChanges();
          }}
        />
      ) : null}
    </div>
  );
}
