"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TextField } from "@/components/ui/TextField";
import { SETTINGS_GROUPS, type SettingGroupDef } from "@/lib/settings-groups";
import { routing } from "@/i18n/routing";

type PageState = { kind: "loading" } | { kind: "forbidden" } | { kind: "ready" };

export default function SettingsPage() {
  const t = useTranslations("dashboard.settings");
  const tCommon = useTranslations("common");
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [activeGroup, setActiveGroup] = useState<string>(SETTINGS_GROUPS[0].group);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/settings/${SETTINGS_GROUPS[0].group}`)
      .then((res) => {
        if (cancelled) return;
        if (res.status === 403) {
          setState({ kind: "forbidden" });
          return;
        }
        setState({ kind: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "ready" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  }

  if (state.kind === "forbidden") {
    return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  }

  const activeGroupDef = SETTINGS_GROUPS.find((g) => g.group === activeGroup);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-neutral-200 pb-px">
        {SETTINGS_GROUPS.map((groupDef) => (
          <button
            key={groupDef.group}
            type="button"
            onClick={() => setActiveGroup(groupDef.group)}
            className={`rounded-t-md px-3 py-2 text-sm font-medium ${
              activeGroup === groupDef.group
                ? "border-b-2 border-primary-600 text-primary-700"
                : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {t(`groups.${groupDef.titleKey}`)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setActiveGroup("localization")}
          className={`rounded-t-md px-3 py-2 text-sm font-medium ${
            activeGroup === "localization"
              ? "border-b-2 border-primary-600 text-primary-700"
              : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          {t("groups.localization")}
        </button>
        <button
          type="button"
          onClick={() => setActiveGroup("banners")}
          className={`rounded-t-md px-3 py-2 text-sm font-medium ${
            activeGroup === "banners"
              ? "border-b-2 border-primary-600 text-primary-700"
              : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          {t("groups.banners")}
        </button>
        <button
          type="button"
          onClick={() => setActiveGroup("redirects")}
          className={`rounded-t-md px-3 py-2 text-sm font-medium ${
            activeGroup === "redirects"
              ? "border-b-2 border-primary-600 text-primary-700"
              : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          {t("groups.redirects")}
        </button>
      </div>

      {activeGroup === "localization" ? (
        <LocalizationInfoPanel />
      ) : activeGroup === "banners" ? (
        <BannersManager />
      ) : activeGroup === "redirects" ? (
        <RedirectsManager />
      ) : activeGroupDef ? (
        <SettingsGroupForm key={activeGroupDef.group} groupDef={activeGroupDef} />
      ) : null}
    </div>
  );
}

function LocalizationInfoPanel() {
  const t = useTranslations("dashboard.settings");
  return (
    <div className="max-w-lg rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
      <p className="text-sm text-neutral-600">{t("localizationInfo")}</p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">{t("currentLocalesLabel")}</dt>
          <dd className="font-medium text-neutral-800">{routing.locales.join(", ")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">{t("defaultLocaleLabel")}</dt>
          <dd className="font-medium text-neutral-800">{routing.defaultLocale}</dd>
        </div>
      </dl>
    </div>
  );
}

type FieldValues = Record<string, string | boolean | string[]>;
type LoadState = { kind: "loading" } | { kind: "error" } | { kind: "ready" };

function SettingsGroupForm({ groupDef }: { groupDef: SettingGroupDef }) {
  const t = useTranslations("dashboard.settings");
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [values, setValues] = useState<FieldValues>({});
  const [originalValues, setOriginalValues] = useState<FieldValues>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/settings/${groupDef.group}`);
      if (!res.ok) {
        setLoadState({ kind: "error" });
        return;
      }
      const data = await res.json();
      const loaded: FieldValues = {};
      for (const field of groupDef.fields) {
        const raw = data.values?.[field.key];
        if (field.type === "toggle") loaded[field.key] = typeof raw === "boolean" ? raw : false;
        else if (field.type === "multiselect") loaded[field.key] = Array.isArray(raw) ? raw : [];
        else loaded[field.key] = typeof raw === "string" ? raw : "";
      }
      setValues(loaded);
      setOriginalValues(loaded);
      setLoadState({ kind: "ready" });
    } catch {
      setLoadState({ kind: "error" });
    }
  }, [groupDef]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function setField(key: string, value: string | boolean | string[]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  }

  function toggleMultiselectOption(key: string, option: string) {
    setValues((prev) => {
      const current = Array.isArray(prev[key]) ? (prev[key] as string[]) : [];
      const next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
      return { ...prev, [key]: next };
    });
    setSaveSuccess(false);
  }

  const isDirty = groupDef.fields.some((f) => JSON.stringify(values[f.key]) !== JSON.stringify(originalValues[f.key]));

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/settings/${groupDef.group}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(
          groupDef.group === "maintenanceMode" && res.status === 400
            ? t("maintenanceReasonRequired")
            : data.error || t("saveError")
        );
        return;
      }
      setOriginalValues(values);
      setSaveSuccess(true);
    } catch {
      setSaveError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg space-y-4 rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
      {loadState.kind === "loading" ? <p className="text-sm text-neutral-500">…</p> : null}

      {loadState.kind === "error" ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-error">{t("loadError")}</p>
          <button
            type="button"
            onClick={() => {
              setLoadState({ kind: "loading" });
              void load();
            }}
            className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {loadState.kind === "ready" ? (
        <>
          {saveError ? (
            <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
              {saveError}
            </div>
          ) : null}
          {saveSuccess ? (
            <div role="status" className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">
              {t("saveSuccess")}
            </div>
          ) : null}

          <div className="space-y-4">
            {groupDef.fields.map((field) => (
              <SettingFieldInput
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={(v) => setField(field.key, v)}
                onToggleOption={(option) => toggleMultiselectOption(field.key, option)}
                label={t(`fields.${field.labelKey}`)}
              />
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !isDirty}
              className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function SettingFieldInput({
  field,
  value,
  onChange,
  onToggleOption,
  label,
}: {
  field: SettingGroupDef["fields"][number];
  value: string | boolean | string[] | undefined;
  onChange: (value: string | boolean | string[]) => void;
  onToggleOption: (option: string) => void;
  label: string;
}) {
  if (field.type === "toggle") {
    return (
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-300"
        />
        <span className="text-sm font-medium text-neutral-800">{label}</span>
      </label>
    );
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-neutral-800">{label}</legend>
        <div className="flex flex-wrap gap-3">
          {(field.options ?? []).map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => onToggleOption(option)}
                className="h-4 w-4 rounded border-neutral-300"
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (field.type === "textarea") {
    return (
      <div>
        <label className="block text-sm font-medium text-neutral-700">{label}</label>
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
        />
      </div>
    );
  }

  return (
    <TextField
      label={label}
      name={field.key}
      type={field.type === "email" ? "email" : "text"}
      value={typeof value === "string" ? value : ""}
      onChange={onChange}
    />
  );
}

interface Banner {
  id: string;
  message: string;
  link: string | null;
  startDate: string | null;
  endDate: string | null;
  dismissible: boolean;
  targetZone: string;
  createdAt: string;
}

type BannersLoadState = { kind: "loading" } | { kind: "error" } | { kind: "ready" };

const EMPTY_BANNER_FORM = { message: "", link: "", startDate: "", endDate: "", targetZone: "sitewide" };

function BannersManager() {
  const t = useTranslations("dashboard.settings");
  const [loadState, setLoadState] = useState<BannersLoadState>({ kind: "loading" });
  const [banners, setBanners] = useState<Banner[]>([]);
  const [form, setForm] = useState(EMPTY_BANNER_FORM);
  const [dismissible, setDismissible] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings/banners");
      if (!res.ok) {
        setLoadState({ kind: "error" });
        return;
      }
      const data = await res.json();
      setBanners(Array.isArray(data.banners) ? data.banners : []);
      setLoadState({ kind: "ready" });
    } catch {
      setLoadState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handleCreate() {
    if (!form.message.trim()) {
      setCreateError(t("banners.messageRequired"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/settings/banners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: form.message.trim(),
          link: form.link.trim() || undefined,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
          dismissible,
          targetZone: form.targetZone.trim() || "sitewide",
        }),
      });
      if (!res.ok) {
        setCreateError(t("banners.createError"));
        return;
      }
      const data = await res.json();
      setBanners((prev) => [data.banner, ...prev]);
      setForm(EMPTY_BANNER_FORM);
      setDismissible(true);
    } catch {
      setCreateError(t("banners.createError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (typeof window !== "undefined" && !window.confirm(t("banners.deleteConfirm"))) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/settings/banners/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleteError(t("banners.deleteError"));
        return;
      }
      setBanners((prev) => prev.filter((b) => b.id !== id));
    } catch {
      setDeleteError(t("banners.deleteError"));
    } finally {
      setDeletingId(null);
    }
  }

  function formatRange(banner: Banner): string {
    if (banner.startDate && banner.endDate) {
      return t("banners.activeRange", {
        start: new Date(banner.startDate).toLocaleDateString(),
        end: new Date(banner.endDate).toLocaleDateString(),
      });
    }
    if (banner.startDate) return t("banners.startsOn", { date: new Date(banner.startDate).toLocaleDateString() });
    if (banner.endDate) return t("banners.endsOn", { date: new Date(banner.endDate).toLocaleDateString() });
    return t("banners.noDateRange");
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("banners.createTitle")}</h2>
        <p className="mt-1 text-sm text-neutral-600">{t("banners.subtitle")}</p>

        {createError ? (
          <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {createError}
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
          <TextField
            label={t("banners.messageLabel")}
            name="message"
            value={form.message}
            onChange={(v) => setForm((prev) => ({ ...prev, message: v }))}
          />
          <TextField
            label={t("banners.linkLabel")}
            name="link"
            value={form.link}
            onChange={(v) => setForm((prev) => ({ ...prev, link: v }))}
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700">{t("banners.startDateLabel")}</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700">{t("banners.endDateLabel")}</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
              />
            </div>
          </div>
          <TextField
            label={t("banners.targetZoneLabel")}
            name="targetZone"
            value={form.targetZone}
            onChange={(v) => setForm((prev) => ({ ...prev, targetZone: v }))}
          />
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={dismissible}
              onChange={(e) => setDismissible(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-300"
            />
            <span className="text-sm font-medium text-neutral-800">{t("banners.dismissibleLabel")}</span>
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {creating ? t("banners.creating") : t("banners.create")}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("banners.listTitle")}</h2>

        {loadState.kind === "loading" ? <p className="mt-4 text-sm text-neutral-500">…</p> : null}

        {loadState.kind === "error" ? (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-error">{t("banners.loadError")}</p>
            <button
              type="button"
              onClick={() => {
                setLoadState({ kind: "loading" });
                void load();
              }}
              className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
            >
              {t("banners.retry")}
            </button>
          </div>
        ) : null}

        {loadState.kind === "ready" ? (
          <>
            {deleteError ? (
              <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
                {deleteError}
              </div>
            ) : null}
            {banners.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">{t("banners.empty")}</p>
            ) : (
              <ul className="mt-4 divide-y divide-neutral-200">
                {banners.map((banner) => (
                  <li key={banner.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">{banner.message}</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {banner.targetZone} · {formatRange(banner)}
                        {banner.link ? (
                          <>
                            {" · "}
                            <a href={banner.link} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
                              {banner.link}
                            </a>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(banner.id)}
                      disabled={deletingId === banner.id}
                      className="min-h-9 shrink-0 rounded-md px-3 text-sm font-medium text-error hover:bg-error-bg disabled:opacity-60"
                    >
                      {deletingId === banner.id ? t("banners.deleting") : t("banners.delete")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

interface Redirect {
  id: string;
  from: string;
  to: string;
  permanent: boolean;
  createdAt: string;
}

type RedirectsLoadState = { kind: "loading" } | { kind: "error" } | { kind: "ready" };

const EMPTY_REDIRECT_FORM = { from: "", to: "" };

function RedirectsManager() {
  const t = useTranslations("dashboard.settings");
  const [loadState, setLoadState] = useState<RedirectsLoadState>({ kind: "loading" });
  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [form, setForm] = useState(EMPTY_REDIRECT_FORM);
  const [permanent, setPermanent] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTo, setEditTo] = useState("");
  const [editPermanent, setEditPermanent] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/redirects");
      if (!res.ok) {
        setLoadState({ kind: "error" });
        return;
      }
      const data = await res.json();
      setRedirects(Array.isArray(data.redirects) ? data.redirects : []);
      setLoadState({ kind: "ready" });
    } catch {
      setLoadState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handleCreate() {
    const from = form.from.trim();
    const to = form.to.trim();
    if (!from.startsWith("/")) {
      setCreateError(t("redirects.fromRequired"));
      return;
    }
    if (!to.startsWith("/")) {
      setCreateError(t("redirects.toRequired"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/redirects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, permanent }),
      });
      if (!res.ok) {
        setCreateError(res.status === 409 ? t("redirects.duplicateError") : t("redirects.createError"));
        return;
      }
      const data = await res.json();
      setRedirects((prev) => [data.redirect, ...prev]);
      setForm(EMPTY_REDIRECT_FORM);
      setPermanent(true);
    } catch {
      setCreateError(t("redirects.createError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (typeof window !== "undefined" && !window.confirm(t("redirects.deleteConfirm"))) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/redirects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleteError(t("redirects.deleteError"));
        return;
      }
      setRedirects((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setDeleteError(t("redirects.deleteError"));
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(redirect: Redirect) {
    setEditingId(redirect.id);
    setEditTo(redirect.to);
    setEditPermanent(redirect.permanent);
    setEditError(null);
  }

  async function handleSaveEdit(id: string) {
    const to = editTo.trim();
    if (!to.startsWith("/")) {
      setEditError(t("redirects.toRequired"));
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/redirects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, permanent: editPermanent }),
      });
      if (!res.ok) {
        setEditError(t("redirects.saveError"));
        return;
      }
      const data = await res.json();
      setRedirects((prev) => prev.map((r) => (r.id === id ? data.redirect : r)));
      setEditingId(null);
    } catch {
      setEditError(t("redirects.saveError"));
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("redirects.createTitle")}</h2>
        <p className="mt-1 text-sm text-neutral-600">{t("redirects.subtitle")}</p>

        {createError ? (
          <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {createError}
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
          <div>
            <TextField
              label={t("redirects.fromLabel")}
              name="from"
              value={form.from}
              onChange={(v) => setForm((prev) => ({ ...prev, from: v }))}
            />
            <p className="mt-1 text-xs text-neutral-500">{t("redirects.fromHint")}</p>
          </div>
          <div>
            <TextField
              label={t("redirects.toLabel")}
              name="to"
              value={form.to}
              onChange={(v) => setForm((prev) => ({ ...prev, to: v }))}
            />
            <p className="mt-1 text-xs text-neutral-500">{t("redirects.toHint")}</p>
          </div>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={permanent}
              onChange={(e) => setPermanent(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-300"
            />
            <span className="text-sm font-medium text-neutral-800">{t("redirects.permanentLabel")}</span>
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {creating ? t("redirects.creating") : t("redirects.create")}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("redirects.listTitle")}</h2>

        {loadState.kind === "loading" ? <p className="mt-4 text-sm text-neutral-500">…</p> : null}

        {loadState.kind === "error" ? (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-error">{t("redirects.loadError")}</p>
            <button
              type="button"
              onClick={() => {
                setLoadState({ kind: "loading" });
                void load();
              }}
              className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
            >
              {t("redirects.retry")}
            </button>
          </div>
        ) : null}

        {loadState.kind === "ready" ? (
          <>
            {deleteError ? (
              <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
                {deleteError}
              </div>
            ) : null}
            {redirects.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">{t("redirects.empty")}</p>
            ) : (
              <ul className="mt-4 divide-y divide-neutral-200">
                {redirects.map((redirect) => (
                  <li key={redirect.id} className="py-3">
                    {editingId === redirect.id ? (
                      <div className="space-y-3">
                        {editError ? (
                          <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
                            {editError}
                          </div>
                        ) : null}
                        <p className="text-xs text-neutral-500">{redirect.from}</p>
                        <TextField label={t("redirects.toLabel")} name={`to-${redirect.id}`} value={editTo} onChange={setEditTo} />
                        <label className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={editPermanent}
                            onChange={(e) => setEditPermanent(e.target.checked)}
                            className="h-4 w-4 rounded border-neutral-300"
                          />
                          <span className="text-sm font-medium text-neutral-800">{t("redirects.permanentLabel")}</span>
                        </label>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                          >
                            {t("redirects.cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSaveEdit(redirect.id)}
                            disabled={savingEdit}
                            className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                          >
                            {savingEdit ? t("redirects.saving") : t("redirects.save")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-neutral-900">
                            {redirect.from} <span className="text-neutral-400">&rarr;</span> {redirect.to}
                          </p>
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {redirect.permanent ? t("redirects.permanentBadge") : t("redirects.temporaryBadge")}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(redirect)}
                            className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
                          >
                            {t("redirects.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(redirect.id)}
                            disabled={deletingId === redirect.id}
                            className="min-h-9 rounded-md px-3 text-sm font-medium text-error hover:bg-error-bg disabled:opacity-60"
                          >
                            {deletingId === redirect.id ? t("redirects.deleting") : t("redirects.delete")}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
