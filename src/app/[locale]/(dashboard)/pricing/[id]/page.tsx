"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";

interface LocaleText {
  name: string;
  description: string;
  priceSuffix: string;
  featureList: string[];
  ctaLabel: string;
  badgeLabel?: string;
}

interface FeatureRow {
  id: string;
  key: string;
  order: number;
  translations: Record<"en" | "ar", { category: string; feature: string }>;
}

interface VersionFeature {
  pricingFeatureId: string;
  value: string;
  feature: FeatureRow;
}

interface PricingVersionRow {
  id: string;
  versionNumber: number;
  monthlyPrice: number | null;
  annualPrice: number | null;
  currency: string;
  trialPeriodDays: number | null;
  ctaTarget: string;
  translations: Record<"en" | "ar", LocaleText>;
  publishedAt: string | null;
  createdAt: string;
  features: VersionFeature[];
}

interface ApprovalRow {
  id: string;
  decision: "APPROVE" | "REQUEST_CHANGES";
  comment: string | null;
  decidedAt: string;
  actor: { name: string; email: string } | null;
}

interface PlanDetail {
  id: string;
  slug: string;
  visibility: "PUBLIC" | "HIDDEN";
  featured: boolean;
  status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  reviewComment: string | null;
  currentVersion: PricingVersionRow | null;
  versions: PricingVersionRow[];
  approvals: ApprovalRow[];
}

type LoadState = { kind: "loading" } | { kind: "forbidden" } | { kind: "notFound" } | { kind: "error" } | { kind: "ready" };

const EMPTY_LOCALE: LocaleText = { name: "", description: "", priceSuffix: "", featureList: [], ctaLabel: "" };

export default function PricingPlanEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("dashboard.pricing");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [featureCatalog, setFeatureCatalog] = useState<FeatureRow[]>([]);

  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED">("DRAFT");
  const [activeLocale, setActiveLocale] = useState<"en" | "ar">("en");
  const [translations, setTranslations] = useState<Record<"en" | "ar", LocaleText>>({ en: EMPTY_LOCALE, ar: EMPTY_LOCALE });
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [annualPrice, setAnnualPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [ctaTarget, setCtaTarget] = useState("/trial");
  const [featureValues, setFeatureValues] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [planRes, sessionRes, featuresRes] = await Promise.all([
        fetch(`/api/admin/pricing/plans/${id}`),
        fetch("/api/admin/auth/session"),
        fetch("/api/admin/pricing/features"),
      ]);
      if (planRes.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (planRes.status === 404) {
        setState({ kind: "notFound" });
        return;
      }
      if (!planRes.ok || !sessionRes.ok) {
        setState({ kind: "error" });
        return;
      }
      const planData = await planRes.json();
      const sessionData = await sessionRes.json();
      const featuresData = featuresRes.ok ? await featuresRes.json() : { features: [] };

      setPlan(planData.plan);
      setPermissions(new Set<string>(sessionData.user.permissions));
      setFeatureCatalog(featuresData.features);
      // Any pre-existing legacy workflow status (Submitted/In Review/etc.)
      // collapses to Draft in the selector — Pricing now only recognizes
      // Draft, Published, and Archived as directly selectable states.
      // Archived must load as Archived (not collapse to Draft), or a
      // plain Save without touching the dropdown would silently
      // un-archive the plan.
      const loadedStatus = planData.plan.status === "PUBLISHED" || planData.plan.status === "ARCHIVED" ? planData.plan.status : "DRAFT";
      setStatus(loadedStatus);

      const version: PricingVersionRow | null = planData.plan.currentVersion;
      setTranslations(version?.translations ?? { en: EMPTY_LOCALE, ar: EMPTY_LOCALE });
      setMonthlyPrice(version?.monthlyPrice != null ? String(version.monthlyPrice) : "");
      setAnnualPrice(version?.annualPrice != null ? String(version.annualPrice) : "");
      setCurrency(version?.currency ?? "USD");
      setCtaTarget(version?.ctaTarget ?? "/trial");
      const values: Record<string, string> = {};
      for (const f of version?.features ?? []) values[f.pricingFeatureId] = f.value;
      setFeatureValues(values);

      setState({ kind: "ready" });
    } catch {
      setState({ kind: "error" });
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function hasPerm(action: string): boolean {
    return permissions.has(`pricing:${action}`);
  }

  function setLocaleField<K extends keyof LocaleText>(locale: "en" | "ar", key: K, value: LocaleText[K]) {
    setTranslations((prev) => ({ ...prev, [locale]: { ...prev[locale], [key]: value } }));
    setSaveSuccess(false);
  }

  async function handleSaveDraft() {
    setSaving(true);
    setSaveError(null);
    try {
      const monthly = monthlyPrice.trim() === "" ? null : Number(monthlyPrice);
      const annual = annualPrice.trim() === "" ? null : Number(annualPrice);
      const res = await fetch(`/api/admin/pricing/plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          monthlyPrice: monthly,
          annualPrice: annual,
          currency,
          ctaTarget,
          translations,
          features: Object.entries(featureValues)
            .filter(([, value]) => value.trim() !== "")
            .map(([featureId, value]) => ({ featureKey: featureCatalog.find((f) => f.id === featureId)?.key ?? "", value })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error ?? t("saveError"));
        return;
      }
      setSaveSuccess(true);
      await load();
    } catch {
      setSaveError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setActionPending("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/pricing/plans/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? t("deleteError"));
        return;
      }
      router.push("/pricing");
    } catch {
      setActionError(t("deleteError"));
    } finally {
      setActionPending(null);
    }
  }

  if (state.kind === "forbidden") return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  if (state.kind === "notFound") return <p className="text-sm text-neutral-500">{t("notFound")}</p>;
  if (state.kind === "loading") return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  if (state.kind === "error" || !plan) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <p className="text-sm text-error">{t("loadError")}</p>
        <button type="button" onClick={() => void load()} className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50">
          {t("retry")}
        </button>
      </div>
    );
  }

  // Pricing has no Draft → Submit → Approve → Publish gate: any admin
  // with edit permission can change fields and Save goes live directly
  // (see the PATCH handler's docstring for why Pricing diverges from the
  // governed workflow the other content modules still use).
  const canEdit = hasPerm("edit");
  const canDelete = hasPerm("delete");

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/pricing" className="text-sm text-primary-600 hover:underline">
            ← {t("backToList")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-neutral-900">{translations.en.name || plan.slug}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">/{plan.slug}</p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">{t(`status.${plan.status}`)}</span>
      </div>

      {plan.status === "CHANGES_REQUESTED" && plan.reviewComment ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">{t("reviewCommentLabel")}</p>
          <p className="mt-0.5">{plan.reviewComment}</p>
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {actionError}
        </div>
      ) : null}

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        {saveError ? (
          <div role="alert" className="mb-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {saveError}
          </div>
        ) : null}
        {saveSuccess ? (
          <div role="status" className="mb-4 rounded-md bg-success-bg px-3 py-2 text-sm text-success">
            {t("saveSuccess")}
          </div>
        ) : null}

        <div className="mb-4 max-w-xs">
          <label className="block text-sm font-medium text-neutral-700">{t("statusSelectorLabel")}</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "DRAFT" | "PUBLISHED" | "ARCHIVED")}
            disabled={!canEdit}
            className="mt-1.5 block min-h-9 w-full rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900 disabled:bg-neutral-50"
          >
            <option value="DRAFT">{t("status.DRAFT")}</option>
            <option value="PUBLISHED">{t("status.PUBLISHED")}</option>
            <option value="ARCHIVED">{t("status.ARCHIVED")}</option>
          </select>
        </div>

        <h2 className="text-sm font-semibold text-neutral-900">{t("pricingFieldsTitle")}</h2>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <TextField label={t("monthlyPriceLabel")} name="monthlyPrice" value={monthlyPrice} onChange={setMonthlyPrice} required={false} disabled={!canEdit} />
          <TextField label={t("annualPriceLabel")} name="annualPrice" value={annualPrice} onChange={setAnnualPrice} required={false} disabled={!canEdit} />
          <TextField label={t("currencyLabel")} name="currency" value={currency} onChange={setCurrency} required={false} disabled={!canEdit} />
          <TextField label={t("ctaTargetLabel")} name="ctaTarget" value={ctaTarget} onChange={setCtaTarget} required={false} disabled={!canEdit} />
        </div>
        <p className="mt-1 text-xs text-neutral-500">{t("customQuoteHint")}</p>

        <div className="mt-6 flex gap-1 border-b border-neutral-200">
          {(["en", "ar"] as const).map((locale) => (
            <button
              key={locale}
              type="button"
              onClick={() => setActiveLocale(locale)}
              className={`min-h-9 px-3 text-sm font-medium ${activeLocale === locale ? "border-b-2 border-primary-600 text-primary-700" : "text-neutral-500 hover:text-neutral-700"}`}
            >
              {locale === "en" ? t("localeEnglish") : t("localeArabic")}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <TextField
            label={t("nameLabel")}
            name="name"
            value={translations[activeLocale].name}
            onChange={(v) => setLocaleField(activeLocale, "name", v)}
            required={false}
            disabled={!canEdit}
          />
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("descriptionLabel")}</label>
            <textarea
              value={translations[activeLocale].description}
              onChange={(e) => setLocaleField(activeLocale, "description", e.target.value)}
              disabled={!canEdit}
              rows={2}
              dir={activeLocale === "ar" ? "rtl" : "ltr"}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
          </div>
          <TextField
            label={t("priceSuffixLabel")}
            name="priceSuffix"
            value={translations[activeLocale].priceSuffix}
            onChange={(v) => setLocaleField(activeLocale, "priceSuffix", v)}
            required={false}
            disabled={!canEdit}
          />
          <div>
            <label className="block text-sm font-medium text-neutral-700">{t("featureListLabel")}</label>
            <textarea
              value={translations[activeLocale].featureList.join("\n")}
              onChange={(e) => setLocaleField(activeLocale, "featureList", e.target.value.split("\n"))}
              disabled={!canEdit}
              rows={5}
              dir={activeLocale === "ar" ? "rtl" : "ltr"}
              className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="mt-1 text-xs text-neutral-500">{t("featureListHint")}</p>
          </div>
          <TextField
            label={t("ctaLabelLabel")}
            name="ctaLabel"
            value={translations[activeLocale].ctaLabel}
            onChange={(v) => setLocaleField(activeLocale, "ctaLabel", v)}
            required={false}
            disabled={!canEdit}
          />
        </div>

        <div className="mt-6">
          <h2 className="text-sm font-semibold text-neutral-900">{t("comparisonFeaturesTitle")}</h2>
          {featureCatalog.length === 0 ? <p className="mt-2 text-sm text-neutral-500">{t("noFeatureCatalog")}</p> : null}
          <ul className="mt-3 space-y-2">
            {featureCatalog.map((f) => (
              <li key={f.id} className="flex items-center gap-3">
                <span className="w-56 shrink-0 text-sm text-neutral-700">
                  {f.translations.en.category} — {f.translations.en.feature}
                </span>
                <input
                  type="text"
                  value={featureValues[f.id] ?? ""}
                  onChange={(e) => setFeatureValues((prev) => ({ ...prev, [f.id]: e.target.value }))}
                  disabled={!canEdit}
                  placeholder={t("featureValuePlaceholder")}
                  className="min-h-9 flex-1 rounded-md border border-neutral-300 bg-surface px-3 text-sm text-neutral-900 disabled:bg-neutral-50"
                />
              </li>
            ))}
          </ul>
        </div>

        {canEdit ? (
          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={saving}
            className="mt-6 min-h-9 rounded-md bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {saving ? t("saving") : t("saveDraft")}
          </button>
        ) : null}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("actionsHeader")}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canDelete ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={actionPending !== null}
              className="min-h-9 rounded-md px-3 text-sm font-medium text-error hover:bg-error-bg"
            >
              {actionPending === "delete" ? t("deleting") : t("delete")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("versionHistoryTitle")}</h2>
        <ul className="mt-3 divide-y divide-neutral-100">
          {plan.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-neutral-800">{t("versionNumber", { n: v.versionNumber })}</span>
                <span className="ms-2 text-neutral-500">{t("versionCreatedAt", { date: new Date(v.createdAt).toLocaleString() })}</span>
                {v.publishedAt ? (
                  <span className="ms-2 text-emerald-700">{t("versionPublishedLabel", { date: new Date(v.publishedAt).toLocaleString() })}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
        <h2 className="text-sm font-semibold text-neutral-900">{t("approvalHistoryTitle")}</h2>
        {plan.approvals.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">{t("noApprovals")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {plan.approvals.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <span className="font-medium text-neutral-800">{a.decision === "APPROVE" ? t("decisionApprove") : t("decisionRequestChanges")}</span>
                <span className="ms-2 text-neutral-500">
                  {a.actor?.name ?? "—"} · {new Date(a.decidedAt).toLocaleString()}
                </span>
                {a.comment ? <p className="mt-0.5 text-neutral-600">{a.comment}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
