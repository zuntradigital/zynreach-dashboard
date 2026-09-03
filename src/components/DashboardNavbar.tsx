import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Top bar for the dashboard content area, sitting alongside
 * `DashboardSidebar` (see (dashboard)/layout.tsx). Holds the theme
 * toggle and language switcher that previously lived in the sidebar's
 * own bottom row — moved here verbatim (same components, same "dark"
 * LanguageSwitcher variant, no prop/behavior changes) so they're
 * reachable without opening the sidebar at all, including on mobile
 * where the sidebar is an off-canvas drawer. `LogoutButton` stays in
 * `DashboardSidebar` instead, pinned to the bottom of the sidebar.
 * `bg-sidebar-bg`/`border-sidebar-border` reuse the sidebar's own chrome
 * tokens so this bar reads as the same surface, not a newly designed one.
 */
export function DashboardNavbar() {
  return (
    <div className="flex h-14 items-center justify-end gap-2 border-b border-sidebar-border bg-sidebar-bg px-4">
      <ThemeToggle />
      <div className="h-4 w-px bg-sidebar-border" aria-hidden="true" />
      <LanguageSwitcher variant="dark" />
    </div>
  );
}
