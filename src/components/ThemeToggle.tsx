"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "@/components/ThemeProvider";

/**
 * Compact icon-only toggle for the sidebar's bottom control row (see
 * DashboardSidebar.tsx) — sun/moon reflects the *current* resolved theme,
 * matching the icon-swap pattern most SaaS dashboards use instead of a
 * labeled row+switch, which cost far more vertical space for the same
 * single piece of state. "system" preference remains available via
 * useTheme but this control only exposes light/dark, same as before.
 */
export function ThemeToggle() {
  const t = useTranslations("common.themeToggle");
  const { resolvedTheme, setPreference } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={`${t("label")}: ${isDark ? t("dark") : t("light")}`}
      title={t("label")}
      onClick={() => setPreference(isDark ? "light" : "dark")}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-text-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-text"
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
          />
        </svg>
      )}
    </button>
  );
}
