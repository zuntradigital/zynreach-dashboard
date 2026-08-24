"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TextField } from "@/components/ui/TextField";

interface ReauthModalProps {
  onConfirmed: () => void;
  onCancel: () => void;
}

/**
 * SRS §23 / FR-ADM-001 step-up re-authentication UI — shown whenever an
 * API call comes back 401 from requireFreshSensitiveVerification
 * (guards.ts). Confirming here calls POST /api/admin/auth/reauth, which
 * marks the current session sensitive-verified for a 5-minute window
 * (session.ts), then the caller retries its original request.
 */
export function ReauthModal({ onConfirmed, onCancel }: ReauthModalProps) {
  const t = useTranslations("reauth");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onConfirmed();
        return;
      }
      setError(res.status === 429 ? t("rateLimited") : res.status === 401 ? t("incorrectPassword") : t("genericError"));
    } catch {
      setError(t("genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4">
      <div className="w-full max-w-sm rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold text-neutral-900">{t("title")}</h2>
        <p className="mt-1 text-sm text-neutral-500">{t("subtitle")}</p>

        {error ? (
          <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
          <TextField
            label={t("passwordLabel")}
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete="current-password"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
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
              {submitting ? t("submitting") : t("submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
