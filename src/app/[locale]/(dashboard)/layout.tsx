import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/auth/guards";
import { resolveSession } from "@/lib/auth/session";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac";
import { DashboardNav } from "@/components/DashboardNav";
import { DashboardSidebar } from "@/components/DashboardSidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Server-side session gate for every route under (dashboard) — this is
 * a UX convenience redirect only. It is NOT the authorization boundary:
 * every API route re-checks the session and permissions independently
 * (SRS §31), so a stale/bypassed UI can never reach protected data.
 */
export default async function DashboardLayout({ children, params }: DashboardLayoutProps) {
  const { locale } = await params;
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value;
  const resolved = rawToken ? await resolveSession(rawToken) : null;

  if (!resolved) {
    redirect({ href: "/login", locale });
    return;
  }

  const t = await getTranslations({ locale, namespace: "common" });
  const effective = await getEffectivePermissions(resolved.adminUser.id);

  return (
    <div className="min-h-screen bg-neutral-50">
      <DashboardSidebar appName={t("appName")} openMenuLabel={t("openMenu")} closeMenuLabel={t("closeMenu")}>
        <DashboardNav
          canManageUsers={hasPermission(effective, "rbac", "manage")}
          canViewAudit={hasPermission(effective, "audit", "view")}
          canViewLeads={hasPermission(effective, "leads", "view")}
          canManageSettings={hasPermission(effective, "settings", "manage")}
          canViewMedia={hasPermission(effective, "media", "view")}
          canViewPricing={hasPermission(effective, "pricing", "view")}
          canViewBlog={hasPermission(effective, "blog", "view")}
          canViewResources={hasPermission(effective, "resources", "view")}
          canViewCustomerStories={hasPermission(effective, "customerStories", "view")}
          canViewWebinars={hasPermission(effective, "webinars", "view")}
          canViewCareers={hasPermission(effective, "careers", "view")}
          canViewFaq={hasPermission(effective, "faq", "view")}
        />
      </DashboardSidebar>
      <main className="mx-auto max-w-5xl px-6 py-8 md:ms-64">{children}</main>
    </div>
  );
}
