import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import { Inter, Playfair_Display, Noto_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing, localeDirection, type Locale } from "@/i18n/routing";
import { ThemeProvider } from "@/components/ThemeProvider";
import "../globals.css";

const THEME_STORAGE_KEY = "zynreach-admin-theme";

/**
 * Runs before hydration so data-theme is set on <html> before first paint
 * (avoids a flash of the wrong theme). Mirrors the pattern already proven
 * in zynreach-website's root layout, with the admin's own storage key.
 */
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("${THEME_STORAGE_KEY}");
    var theme = stored === "light" || stored === "dark" ? stored : null;
    if (!theme) {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
});

const notoSansArabic = Noto_Sans_Arabic({
  variable: "--font-noto-arabic",
  subsets: ["arabic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ZynReach Admin",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface RootLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function RootLayout({ children, params }: RootLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);
  const dir = localeDirection[locale as Locale];

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${inter.variable} ${playfair.variable} ${notoSansArabic.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans" style={locale === "ar" ? { fontFamily: "var(--font-noto-arabic)" } : undefined}>
        {/* Explicit locale prop, not left to implicit inference — see
            zynreach-website's own hydration-bug postmortem: an implicit
            locale resolution path is one indirection too many when the
            route segment already guarantees the correct value. */}
        <NextIntlClientProvider locale={locale}>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
        {/* Placed inside <body>, not a manually-authored <head>, matching
            next/script's own documented beforeInteractive pattern exactly
            (node_modules/next/dist/docs/.../script.md) — Next hoists this
            into the served page's real <head> itself regardless of where
            the JSX sits; wrapping it in an explicit <head> ourselves was
            what triggered "Encountered a script tag while rendering React
            component," since it fought Next's own head-injection instead
            of matching the shape Next expects for this strategy. */}
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </body>
    </html>
  );
}
