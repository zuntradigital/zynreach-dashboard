import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware replacements for next/link and next/navigation's
 * useRouter/usePathname — every internal link/redirect in the app should
 * use these instead of the plain Next.js equivalents so the locale
 * prefix is always carried automatically.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
