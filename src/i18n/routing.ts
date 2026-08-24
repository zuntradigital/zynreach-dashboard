import { defineRouting } from "next-intl/routing";

/**
 * System B is an internal staff tool — English is the default locale as
 * a sensible, easily-changed implementation choice (not an SRS
 * requirement; the SRS is silent on System B's own default locale).
 * Both locales are fully supported from Phase 1, per the explicit
 * project directive that Arabic/English + RTL/LTR must be a foundation,
 * not a retrofit.
 */
export const routing = defineRouting({
  locales: ["en", "ar"],
  defaultLocale: "en",
  localePrefix: "always",
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];

export const localeDirection: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  ar: "rtl",
};
