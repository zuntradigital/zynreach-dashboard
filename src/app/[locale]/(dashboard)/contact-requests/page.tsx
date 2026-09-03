"use client";

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

const KNOWN_REASONS = new Set(["sales", "support", "partnerships", "press", "other"]);

/**
 * "طلبات التواصل معنا" (Contact Us requests) — a dedicated, always-clear
 * view of Submission.formId === "contact" rows. Same Lead/Submission data
 * and API the main Leads page already uses (see FilteredLeadSection),
 * scoped to exactly one form so nothing else can ever mix in here.
 */
export default function ContactRequestsPage() {
  const t = useTranslations("dashboard.contactRequests");

  function reasonLabel(payload: Record<string, unknown>): string {
    const reason = str(payload, "reason");
    if (reason === "—") return reason;
    return KNOWN_REASONS.has(reason) ? t(`reasonLabels.${reason}` as "reasonLabels.other") : reason;
  }

  const columns: FilteredLeadColumn[] = [
    { header: t("nameHeader"), render: (payload) => str(payload, "name") },
    { header: t("emailHeader"), render: (payload) => str(payload, "email") },
    { header: t("reasonHeader"), render: reasonLabel },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
      </div>

      <FilteredLeadSection
        formId="contact"
        namespace="dashboard.contactRequests"
        columns={columns}
        renderDetailFields={(payload) => (
          <>
            <DetailRow label={t("nameHeader")} value={str(payload, "name")} />
            <DetailRow label={t("emailHeader")} value={str(payload, "email")} />
            <DetailRow label={t("reasonHeader")} value={reasonLabel(payload)} />
            <DetailRow label={t("messageHeader")} value={str(payload, "message")} />
          </>
        )}
      />
    </div>
  );
}
