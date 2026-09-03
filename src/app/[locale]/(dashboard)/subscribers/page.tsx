"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FilteredLeadSection, type FilteredLeadColumn } from "@/components/leads/FilteredLeadSection";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-end font-medium text-neutral-800 break-words">{value}</dd>
    </div>
  );
}

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : "—";
}

function tabClass(active: boolean) {
  return `min-h-9 px-3 text-sm font-medium ${active ? "border-b-2 border-primary-600 text-primary-700" : "text-neutral-500 hover:text-neutral-700"}`;
}

type Tab = "subscriptions" | "partners";

/**
 * "قائمة المشتركين" — Newsletter Subscriptions and Partner Applications
 * live in one dashboard section (as requested) but are kept unambiguous
 * via tabs and a distinct "Type" badge per row, never merged into one
 * undifferentiated table. Same underlying Lead/Submission data and API as
 * the main Leads page, scoped by formId ("newsletter-signup" vs.
 * "partnership-application").
 */
export default function SubscribersPage() {
  const t = useTranslations("dashboard.subscribers");
  const [tab, setTab] = useState<Tab>("subscriptions");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
      </div>

      <div className="flex gap-1 border-b border-neutral-200">
        <button type="button" onClick={() => setTab("subscriptions")} className={tabClass(tab === "subscriptions")}>
          {t("tabs.subscriptions")}
        </button>
        <button type="button" onClick={() => setTab("partners")} className={tabClass(tab === "partners")}>
          {t("tabs.partners")}
        </button>
      </div>

      {tab === "subscriptions" ? <SubscriptionsTab /> : <PartnersTab />}
    </div>
  );
}

function SubscriptionsTab() {
  const t = useTranslations("dashboard.subscribers");

  const columns: FilteredLeadColumn[] = [
    { header: t("nameHeader"), render: (payload) => str(payload, "name") },
    { header: t("emailHeader"), render: (payload) => str(payload, "workEmail") },
    { header: t("companyHeader"), render: (payload) => str(payload, "company") },
  ];

  return (
    <div>
      <p className="mb-3 mt-4 text-sm text-neutral-600">{t("subscriptionsIntro")}</p>
      <FilteredLeadSection
        formId="newsletter-signup"
        namespace="dashboard.subscribers"
        columns={columns}
        renderDetailFields={(payload) => (
          <>
            <DetailRow label={t("typeHeader")} value={t("subscriptionBadge")} />
            <DetailRow label={t("nameHeader")} value={str(payload, "name")} />
            <DetailRow label={t("emailHeader")} value={str(payload, "workEmail")} />
            <DetailRow label={t("companyHeader")} value={str(payload, "company")} />
            <DetailRow label={t("jobTitleHeader")} value={str(payload, "jobTitle")} />
            <DetailRow label={t("companySizeHeader")} value={str(payload, "companySize")} />
            <DetailRow label={t("subscribedToHeader")} value={str(payload, "sourceContext") === "—" ? t("newsletterDefault") : str(payload, "sourceContext")} />
          </>
        )}
      />
    </div>
  );
}

function PartnersTab() {
  const t = useTranslations("dashboard.subscribers");

  function partnershipTypeLabel(payload: Record<string, unknown>): string {
    const value = str(payload, "partnershipType");
    if (value === "—") return value;
    const known = new Set(["reseller", "referral", "technology", "agency", "other"]);
    return known.has(value) ? t(`partnershipTypeLabels.${value}` as "partnershipTypeLabels.other") : value;
  }

  const columns: FilteredLeadColumn[] = [
    { header: t("companyHeader"), render: (payload) => str(payload, "companyName") },
    { header: t("contactHeader"), render: (payload) => str(payload, "contactName") },
    { header: t("typeHeader"), render: partnershipTypeLabel },
  ];

  return (
    <div>
      <p className="mb-3 mt-4 text-sm text-neutral-600">{t("partnersIntro")}</p>
      <FilteredLeadSection
        formId="partnership-application"
        namespace="dashboard.subscribers"
        columns={columns}
        renderDetailFields={(payload) => (
          <>
            <DetailRow label={t("typeHeader")} value={t("partnerBadge")} />
            <DetailRow label={t("companyHeader")} value={str(payload, "companyName")} />
            <DetailRow label={t("contactHeader")} value={str(payload, "contactName")} />
            <DetailRow label={t("emailHeader")} value={str(payload, "workEmail")} />
            <DetailRow label={t("websiteHeader")} value={str(payload, "website")} />
            <DetailRow label={t("partnershipTypeHeader")} value={partnershipTypeLabel(payload)} />
            <DetailRow label={t("businessTypeHeader")} value={str(payload, "businessType")} />
            <DetailRow label={t("customerTypeHeader")} value={str(payload, "customerType")} />
            <DetailRow label={t("customerBaseHeader")} value={str(payload, "customerBase")} />
            <DetailRow label={t("messageHeader")} value={str(payload, "message")} />
            <DetailRow label={t("collaborationHeader")} value={str(payload, "collaborationInterest")} />
          </>
        )}
      />
    </div>
  );
}
