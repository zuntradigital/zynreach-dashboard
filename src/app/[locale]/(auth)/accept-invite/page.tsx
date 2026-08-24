"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type Step =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "invite"; name: string; email: string }
  | { kind: "form"; name: string; email: string }
  | { kind: "mfa"; challengeToken: string; qrCodeDataUrl?: string };

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitePageInner />
    </Suspense>
  );
}

function AcceptInvitePageInner() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep({ kind: "invalid" });
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/auth/accept-invite?token=${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("invalid"))))
      .then((data) => {
        if (cancelled) return;
        // Already accepted (e.g. a reload after clicking "Accept
        // Invitation" but before finishing the password) — skip straight
        // to the password form instead of asking them to accept again.
        setStep(
          data.alreadyAccepted
            ? { kind: "form", name: data.name, email: data.email }
            : { kind: "invite", name: data.name, email: data.email }
        );
      })
      .catch(() => {
        if (!cancelled) setStep({ kind: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept() {
    if (step.kind !== "invite") return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/accept-invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(res.status === 429 ? t("auth.login.rateLimited") : data.error || t("auth.acceptInvite.genericError"));
        return;
      }

      setStep({ kind: "form", name: step.name, email: step.email });
    } catch {
      setError(t("auth.acceptInvite.genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t("auth.acceptInvite.nameRequired"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("auth.acceptInvite.passwordMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          res.status === 429 ? t("auth.login.rateLimited") : data.error || t("auth.acceptInvite.genericError")
        );
        return;
      }

      if (data.status === "mfa_required") {
        setStep({ kind: "mfa", challengeToken: data.challengeToken });
      } else if (data.status === "mfa_setup_required") {
        setStep({ kind: "mfa", challengeToken: data.challengeToken, qrCodeDataUrl: data.qrCodeDataUrl });
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError(t("auth.acceptInvite.genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaSubmit(event: FormEvent) {
    event.preventDefault();
    if (step.kind !== "mfa") return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/mfa-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: step.challengeToken, code }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(res.status === 429 ? t("auth.login.rateLimited") : t("auth.mfa.invalidCode"));
        return;
      }

      void data;
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("auth.acceptInvite.genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="absolute top-4 end-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-surface p-8 shadow-card">
        <div className="mb-6 text-center">
          <div className="mb-4 flex items-center justify-center gap-2.5">
            <Image src="/logo-mark.png" alt="" aria-hidden="true" width={471} height={312} priority className="h-9 w-auto" />
            <span className="font-serif text-2xl font-bold tracking-tight text-neutral-900">ZynReach</span>
          </div>
          <h1 className="text-lg font-semibold text-neutral-900">
            {step.kind === "mfa" ? t("auth.mfa.title") : t("auth.acceptInvite.title")}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {step.kind === "invite" || step.kind === "form"
              ? t("auth.acceptInvite.invitedAs", { email: step.email })
              : step.kind === "mfa"
                ? t("auth.mfa.subtitle")
                : step.kind === "invalid"
                  ? t("auth.acceptInvite.invalidBody")
                  : t("auth.acceptInvite.subtitle")}
          </p>
        </div>

        {error ? (
          <div role="alert" className="mb-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        {step.kind === "loading" ? <p className="text-center text-sm text-neutral-500">{t("common.loading")}</p> : null}

        {step.kind === "invalid" ? (
          <Link
            href="/login"
            className="block min-h-11 w-full rounded-md bg-primary-600 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            {t("auth.acceptInvite.backToLogin")}
          </Link>
        ) : null}

        {step.kind === "invite" ? (
          <button
            type="button"
            onClick={() => void handleAccept()}
            disabled={submitting}
            className="min-h-11 w-full rounded-md bg-primary-600 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
          >
            {submitting ? t("auth.acceptInvite.accepting") : t("auth.acceptInvite.accept")}
          </button>
        ) : null}

        {step.kind === "form" ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4" noValidate>
            <TextField
              label={t("auth.acceptInvite.nameLabel")}
              name="name"
              type="text"
              value={name}
              onChange={setName}
              required
              autoComplete="name"
              autoFocus
            />
            <TextField
              label={t("auth.acceptInvite.passwordLabel")}
              name="password"
              type="password"
              value={password}
              onChange={setPassword}
              required
              autoComplete="new-password"
            />
            <TextField
              label={t("auth.acceptInvite.confirmPasswordLabel")}
              name="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              required
              autoComplete="new-password"
            />
            <p className="text-xs text-neutral-500">{t("auth.acceptInvite.passwordHint")}</p>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 w-full rounded-md bg-primary-600 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
            >
              {submitting ? t("auth.acceptInvite.submitting") : t("auth.acceptInvite.submit")}
            </button>
          </form>
        ) : null}

        {step.kind === "mfa" ? (
          <form onSubmit={handleMfaSubmit} className="space-y-4" noValidate>
            {step.qrCodeDataUrl ? (
              <div className="flex justify-center">
                <Image
                  src={step.qrCodeDataUrl}
                  alt=""
                  width={176}
                  height={176}
                  unoptimized
                  className="h-44 w-44 rounded-md border border-neutral-200"
                />
              </div>
            ) : null}
            <TextField
              label={t("auth.mfa.codeLabel")}
              name="code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={setCode}
              required
              autoComplete="one-time-code"
              autoFocus
            />
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 w-full rounded-md bg-primary-600 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
            >
              {submitting ? t("auth.mfa.submitting") : t("auth.mfa.submit")}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
