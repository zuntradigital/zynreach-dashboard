"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";

const THEME_STORAGE_KEY = "zynreach-admin-theme";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  /** The admin's stored preference — "system" means "follow the OS", not a fixed theme. */
  preference: ThemePreference;
  /** The theme actually applied right now (system resolved to light/dark). */
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * localStorage writes from this same tab don't fire a native "storage"
 * event (only other tabs get that), so setPreference notifies this
 * module-level listener set directly after writing — the same
 * external-store-with-manual-notify shape used by zynreach-website's own
 * ThemeProvider, which this component mirrors (separate storage key so
 * the two apps' theme choices don't collide if ever served same-origin).
 */
const preferenceListeners = new Set<() => void>();

function notifyPreferenceListeners() {
  preferenceListeners.forEach((listener) => listener());
}

function subscribeToPreference(onChange: () => void) {
  preferenceListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    preferenceListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStoredPreference(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function getServerPreference(): ThemePreference {
  return "system";
}

function subscribeToSystemTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getServerSystemTheme(): ResolvedTheme {
  return "light";
}

/**
 * Manual toggle layered on top of system-preference detection: "system"
 * tracks the OS live (via a matchMedia change listener), while an explicit
 * light/dark choice persists to localStorage and overrides it — both take
 * effect immediately by writing data-theme directly to <html>, no reload.
 * Applies across every Dashboard page since it wraps the whole [locale]
 * layout, not a single route.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(subscribeToPreference, readStoredPreference, getServerPreference);
  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, readSystemTheme, getServerSystemTheme);
  const resolvedTheme: ResolvedTheme = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    if (next === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    }
    notifyPreferenceListeners();
  }, []);

  return <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
