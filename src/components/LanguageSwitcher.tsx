"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

interface LanguageSwitcherProps {
  /** "light" (default) is the original styling used on the white login
   * card. "dark" is for the dark-gold Dashboard sidebar, the only other
   * place this component is rendered. */
  variant?: "light" | "dark";
}

/**
 * The language-switching architecture required by the project directive:
 * swaps the active locale while staying on the exact same route —
 * router.replace with a locale override re-renders the current page
 * under the new locale, no full reload, no per-locale duplicate route.
 */
export function LanguageSwitcher({ variant = "light" }: LanguageSwitcherProps) {
  const t = useTranslations("common.languageSwitcher");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  function switchTo(nextLocale: Locale) {
    if (nextLocale === locale) return;
    router.replace(pathname, { locale: nextLocale });
  }

  return (
    <div
      className={`flex items-center ${variant === "dark" ? "gap-0.5 text-xs" : "gap-1 text-sm"}`}
      role="group"
      aria-label={t("label")}
    >
      {routing.locales.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => switchTo(loc)}
          aria-pressed={loc === locale}
          title={variant === "dark" ? t(loc) : undefined}
          className={`rounded-md font-medium transition-colors ${variant === "dark" ? "px-2 py-1" : "px-2.5 py-1.5"} ${
            variant === "dark"
              ? loc === locale
                ? "bg-sidebar-accent-bg text-sidebar-accent"
                : "text-sidebar-text-muted hover:bg-sidebar-hover hover:text-sidebar-text"
              : loc === locale
                ? "bg-primary-100 text-primary-700"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
          }`}
        >
          {variant === "dark" ? loc.toUpperCase() : t(loc)}
        </button>
      ))}
    </div>
  );
}
