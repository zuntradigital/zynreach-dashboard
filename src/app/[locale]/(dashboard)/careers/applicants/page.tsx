"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { JobApplicantsPanel } from "@/components/careers/JobApplicantsPanel";

export default function CareersApplicantsPage() {
  return (
    <Suspense fallback={null}>
      <CareersApplicantsPageInner />
    </Suspense>
  );
}

function CareersApplicantsPageInner() {
  const t = useTranslations("dashboard.careersApplications");
  const searchParams = useSearchParams();
  const jobListingId = searchParams.get("jobListingId");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
      </div>
      <JobApplicantsPanel initialJobListingId={jobListingId} />
    </div>
  );
}
