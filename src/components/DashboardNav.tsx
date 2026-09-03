"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

interface DashboardNavProps {
  canManageUsers: boolean;
  canViewAudit: boolean;
  canViewLeads: boolean;
  canManageSettings: boolean;
  canViewMedia: boolean;
  canViewPricing: boolean;
  canViewBlog: boolean;
  canViewResources: boolean;
  canViewCustomerStories: boolean;
  canViewWebinars: boolean;
  canViewCareers: boolean;
  canViewFaq: boolean;
}

/**
 * Permission-aware nav shell — every SCR-0xx screen in the SRS assumes a
 * left navigation entry point ("Entry Point: Left navigation ..."), which
 * is now literal: this renders inside the sidebar (DashboardSidebar), not
 * a top bar. Links are hidden (not just disabled) for roles lacking the
 * permission, matching the existing pattern of hiding rather than
 * exposing-then-blocking (e.g. RecentLeadsWidget returning null on 403).
 * The API routes behind each link independently re-check the same
 * permission — this is a navigation convenience, not the authorization
 * boundary.
 *
 * Client component (not the async server component this used to be) so it
 * can read the current route via usePathname and highlight the matching
 * link — a real control-center sidebar needs to show which section you're
 * in, not just which sections exist. `/blog/{id}` still highlights
 * "Blog" via startsWith, not just an exact match on `/blog`.
 *
 * The Pages/CMS module itself (routes, API, DB) is intentionally still
 * live — only its sidebar entry point was removed on request. Direct
 * navigation to /pages still works for anyone with the content:view
 * permission; it's just no longer surfaced in the nav.
 */
export function DashboardNav({
  canManageUsers,
  canViewAudit,
  canViewLeads,
  canManageSettings,
  canViewMedia,
  canViewPricing,
  canViewBlog,
  canViewResources,
  canViewCustomerStories,
  canViewWebinars,
  canViewCareers,
  canViewFaq,
}: DashboardNavProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  }

  function linkClass(href: string): string {
    const base = "block rounded-md border px-3 py-2 text-sm font-medium";
    return isActive(href)
      ? `${base} border-sidebar-accent-border bg-sidebar-accent-bg text-sidebar-accent`
      : `${base} border-transparent text-sidebar-text-muted hover:bg-sidebar-hover hover:text-sidebar-text`;
  }

  return (
    <nav className="flex flex-col items-stretch gap-1" aria-label={t("dashboard")}>
      <Link href="/dashboard" className={linkClass("/dashboard")} aria-current={isActive("/dashboard") ? "page" : undefined}>
        {t("dashboard")}
      </Link>
      {canViewMedia ? (
        <Link href="/media" className={linkClass("/media")} aria-current={isActive("/media") ? "page" : undefined}>
          {t("media")}
        </Link>
      ) : null}
      {canViewPricing ? (
        <Link href="/pricing" className={linkClass("/pricing")} aria-current={isActive("/pricing") ? "page" : undefined}>
          {t("pricing")}
        </Link>
      ) : null}
      {canViewBlog ? (
        <Link href="/blog" className={linkClass("/blog")} aria-current={isActive("/blog") ? "page" : undefined}>
          {t("blog")}
        </Link>
      ) : null}
      {canViewResources ? (
        <Link href="/resources" className={linkClass("/resources")} aria-current={isActive("/resources") ? "page" : undefined}>
          {t("resources")}
        </Link>
      ) : null}
      {canViewCustomerStories ? (
        <Link href="/customer-stories" className={linkClass("/customer-stories")} aria-current={isActive("/customer-stories") ? "page" : undefined}>
          {t("customerStories")}
        </Link>
      ) : null}
      {canViewWebinars ? (
        <Link href="/webinars" className={linkClass("/webinars")} aria-current={isActive("/webinars") ? "page" : undefined}>
          {t("webinars")}
        </Link>
      ) : null}
      {canViewBlog ? (
        <Link href="/taxonomy" className={linkClass("/taxonomy")} aria-current={isActive("/taxonomy") ? "page" : undefined}>
          {t("taxonomy")}
        </Link>
      ) : null}
      {canViewCareers ? (
        <Link href="/careers" className={linkClass("/careers")} aria-current={isActive("/careers") ? "page" : undefined}>
          {t("careers")}
        </Link>
      ) : null}
      {canViewFaq ? (
        <Link href="/faq" className={linkClass("/faq")} aria-current={isActive("/faq") ? "page" : undefined}>
          {t("faq")}
        </Link>
      ) : null}
      {canManageUsers ? (
        <Link href="/users" className={linkClass("/users")} aria-current={isActive("/users") ? "page" : undefined}>
          {t("users")}
        </Link>
      ) : null}
      {canManageUsers ? (
        <Link href="/roles" className={linkClass("/roles")} aria-current={isActive("/roles") ? "page" : undefined}>
          {t("roles")}
        </Link>
      ) : null}
      {canViewAudit ? (
        <Link href="/audit" className={linkClass("/audit")} aria-current={isActive("/audit") ? "page" : undefined}>
          {t("auditLog")}
        </Link>
      ) : null}
      {canViewLeads ? (
        <Link href="/leads" className={linkClass("/leads")} aria-current={isActive("/leads") ? "page" : undefined}>
          {t("leads")}
        </Link>
      ) : null}
      {canViewLeads ? (
        <Link
          href="/contact-requests"
          className={linkClass("/contact-requests")}
          aria-current={isActive("/contact-requests") ? "page" : undefined}
        >
          {t("contactRequests")}
        </Link>
      ) : null}
      {canViewLeads ? (
        <Link href="/subscribers" className={linkClass("/subscribers")} aria-current={isActive("/subscribers") ? "page" : undefined}>
          {t("subscribers")}
        </Link>
      ) : null}
      {canManageSettings ? (
        <Link href="/settings" className={linkClass("/settings")} aria-current={isActive("/settings") ? "page" : undefined}>
          {t("settings")}
        </Link>
      ) : null}
    </nav>
  );
}
