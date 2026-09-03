"use client";

import { useState } from "react";
import Image from "next/image";
import { LogoutButton } from "@/components/LogoutButton";

interface DashboardSidebarProps {
  appName: string;
  openMenuLabel: string;
  closeMenuLabel: string;
  children: React.ReactNode;
}

/**
 * Navigation lives in a fixed inline-start sidebar rather than a top bar.
 * Below md, the sidebar becomes an off-canvas drawer (slid out via `rtl:`
 * so it opens from the correct edge in both directions) toggled by a slim
 * top strip, since a full-height sidebar can't stay permanently visible on
 * a phone viewport without covering the page content. The theme toggle and
 * language switcher live in `DashboardNavbar` instead (see
 * (dashboard)/layout.tsx); `LogoutButton` stays here, pinned to the bottom
 * of the `flex-col` aside below the `flex-1` nav area, so it stays fixed
 * at the bottom regardless of how long the nav list scrolls.
 */
export function DashboardSidebar({ appName, openMenuLabel, closeMenuLabel, children }: DashboardSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar-bg px-4 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={openMenuLabel}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-md text-sidebar-text-muted hover:bg-sidebar-hover hover:text-sidebar-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="flex items-center gap-2">
          <Image src="/logo-mark.png" alt="" aria-hidden="true" width={471} height={312} className="h-6 w-auto shrink-0" />
          <span className="font-serif text-sm font-semibold text-sidebar-text">{appName}</span>
        </span>
      </div>

      {open ? (
        <button
          type="button"
          aria-label={closeMenuLabel}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-neutral-900/40 md:hidden"
        />
      ) : null}

      {/* md:!translate-x-0 must be !important: Tailwind emits .rtl\:translate-x-full
          after .md\:translate-x-0 in the generated stylesheet, so at equal
          specificity the rtl variant silently wins the cascade even on desktop
          widths — pinning the sidebar fully off-screen for every RTL user. The
          !important pin makes "always open at md+" win regardless of that
          variant-ordering detail. */}
      <aside
        className={`fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-sidebar-border bg-sidebar-bg transition-transform duration-200 ease-in-out md:!translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <span className="flex items-center gap-2">
            <Image src="/logo-mark.png" alt="" aria-hidden="true" width={471} height={312} className="h-7 w-auto shrink-0" priority />
            <span className="font-serif text-sm font-semibold text-sidebar-text">{appName}</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={closeMenuLabel}
            className="flex min-h-9 min-w-9 items-center justify-center rounded-md text-sidebar-text-muted hover:bg-sidebar-hover hover:text-sidebar-text md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">{children}</div>

        <div className="flex items-center border-t border-sidebar-border px-3 py-2.5">
          <LogoutButton />
        </div>
      </aside>
    </>
  );
}
