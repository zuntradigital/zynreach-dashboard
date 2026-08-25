"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { TextField } from "@/components/ui/TextField";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

type Step =
  | { kind: "credentials" }
  | { kind: "mfa"; challengeToken: string; qrCodeDataUrl?: string };

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCredentialsSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          res.status === 429
            ? t("auth.login.rateLimited")
            : res.status === 401
              ? t("auth.login.invalidCredentials")
              : t("auth.login.genericError")
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
      setError(t("auth.login.genericError"));
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
        setError(
          res.status === 429 ? t("auth.login.rateLimited") : t("auth.mfa.invalidCode")
        );
        return;
      }

      void data;
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("auth.login.genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="absolute top-4 end-4 flex items-center gap-2">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-surface p-8 shadow-card">
        <div className="mb-6 text-center">
          <div className="mb-4 flex items-center justify-center gap-2.5">
            <Image src="/logo-mark.png" alt="" aria-hidden="true" width={471} height={312} priority className="h-9 w-auto" />
            <span className="font-serif text-2xl font-bold tracking-tight text-neutral-900">ZynReach</span>
          </div>
          <h1 className="text-lg font-semibold text-neutral-900">
            {step.kind === "credentials" ? t("auth.login.title") : t("auth.mfa.title")}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {step.kind === "credentials" ? t("auth.login.subtitle") : t("auth.mfa.subtitle")}
          </p>
        </div>

        {error ? (
          <div role="alert" className="mb-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        {step.kind === "credentials" ? (
          <form onSubmit={handleCredentialsSubmit} className="space-y-4" noValidate>
            <TextField
              label={t("auth.login.emailLabel")}
              name="email"
              type="email"
              value={email}
              onChange={setEmail}
              required
              autoComplete="username"
              autoFocus
            />
            <TextField
              label={t("auth.login.passwordLabel")}
              name="password"
              type="password"
              value={password}
              onChange={setPassword}
              required
              autoComplete="current-password"
            />
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 w-full rounded-md bg-primary-600 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
            >
              {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
            </button>
          </form>
        ) : (
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
            <button
              type="button"
              onClick={() => {
                setStep({ kind: "credentials" });
                setCode("");
                setError(null);
              }}
              className="min-h-11 w-full rounded-md text-sm font-medium text-neutral-500 hover:text-neutral-700"
            >
              {t("auth.mfa.backToLogin")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
