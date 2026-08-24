"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface Lead {
  id: string;
  status: string;
  source: string;
  campaign: string | null;
  formId: string;
  submittedAt: string;
  crmSyncStatus: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready"; leads: Lead[] };

export function RecentLeadsWidget() {
  const t = useTranslations("dashboard.home");
  const tCommon = useTranslations("common");
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/leads?take=10");
      if (res.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = await res.json();
      setState({ kind: "ready", leads: data.leads });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount into local component state — not a case the rule's
    // heuristic distinguishes from a problematic derived-state pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (state.kind === "forbidden") return null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
      <h2 className="text-sm font-semibold text-neutral-900">{t("leadsWidgetTitle")}</h2>

      {state.kind === "loading" ? <p className="mt-4 text-sm text-neutral-500">{tCommon("loading")}</p> : null}

      {state.kind === "error" ? (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-error">{t("leadsError")}</p>
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

      {state.kind === "ready" && state.leads.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">{t("leadsEmpty")}</p>
      ) : null}

      {state.kind === "ready" && state.leads.length > 0 ? (
        <ul className="mt-4 divide-y divide-neutral-100">
          {state.leads.map((lead) => (
            <li key={lead.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <p className="font-medium text-neutral-800">{lead.formId}</p>
                <p className="text-neutral-500">{lead.source}</p>
              </div>
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
                {lead.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
