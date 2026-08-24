import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/auth/guards";
import { resolveSession } from "@/lib/auth/session";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { RecentLeadsWidget } from "@/components/RecentLeadsWidget";

/**
 * Real, DB-backed control-center view — every count and activity row below
 * is read straight from the same tables each content module's own list
 * page reads, in the same request (no cached/precomputed snapshot), so
 * this can never drift from what the Dashboard's other screens show. A
 * card only renders for modules the signed-in admin actually holds
 * view permission for, matching how the sidebar nav already hides links
 * the admin can't use.
 */

interface StatCard {
  key: string;
  label: string;
  href: string;
  total: number;
  published: number;
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value;
  const resolved = rawToken ? await resolveSession(rawToken) : null;

  if (!resolved) {
    redirect({ href: "/login", locale });
    return;
  }

  const { adminUser } = resolved;
  const effective = await getEffectivePermissions(adminUser.id);
  const t = await getTranslations({ locale, namespace: "dashboard.home" });
  const tDashboard = await getTranslations({ locale, namespace: "dashboard" });
  const tUsers = await getTranslations({ locale, namespace: "dashboard.users" });
  // Role names are stored in the DB as their canonical English label (see
  // prisma/seed.ts's ROLE_CATALOG) — the Users/Roles pages already
  // translate through dashboard.users.roleNames rather than showing that
  // raw value, so this reuses the same lookup instead of displaying the
  // untranslated DB string here.
  const roleLabels = effective.roleNames.map((name) => tUsers(`roleNames.${name}` as Parameters<typeof tUsers>[0]));
  const tAudit = await getTranslations({ locale, namespace: "dashboard.audit" });

  const canViewPages = hasPermission(effective, "content", "view");
  const canViewBlog = hasPermission(effective, "blog", "view");
  const canViewPricing = hasPermission(effective, "pricing", "view");
  const canViewResources = hasPermission(effective, "resources", "view");
  const canViewCareers = hasPermission(effective, "careers", "view");
  const canViewMedia = hasPermission(effective, "media", "view");
  const canViewAudit = hasPermission(effective, "audit", "view");

  const [
    pagesTotal,
    pagesPublished,
    blogTotal,
    blogPublished,
    pricingTotal,
    pricingPublished,
    resourcesTotal,
    resourcesPublished,
    careersTotal,
    careersPublished,
    mediaTotal,
    mediaActive,
    recentActivity,
  ] = await Promise.all([
    canViewPages ? prisma.page.count() : Promise.resolve(0),
    canViewPages ? prisma.page.count({ where: { status: "PUBLISHED" } }) : Promise.resolve(0),
    canViewBlog ? prisma.blogPost.count() : Promise.resolve(0),
    canViewBlog ? prisma.blogPost.count({ where: { status: "PUBLISHED" } }) : Promise.resolve(0),
    canViewPricing ? prisma.pricingPlan.count() : Promise.resolve(0),
    canViewPricing ? prisma.pricingPlan.count({ where: { status: "PUBLISHED" } }) : Promise.resolve(0),
    canViewResources ? prisma.resource.count() : Promise.resolve(0),
    canViewResources ? prisma.resource.count({ where: { status: "PUBLISHED" } }) : Promise.resolve(0),
    canViewCareers ? prisma.jobListing.count() : Promise.resolve(0),
    canViewCareers ? prisma.jobListing.count({ where: { status: "PUBLISHED" } }) : Promise.resolve(0),
    canViewMedia ? prisma.mediaAsset.count() : Promise.resolve(0),
    canViewMedia ? prisma.mediaAsset.count({ where: { archived: false } }) : Promise.resolve(0),
    canViewAudit
      ? prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 })
      : Promise.resolve([]),
  ]);

  const cards: StatCard[] = [
    ...(canViewPages ? [{ key: "pages", label: tDashboard("pages.title"), href: "/pages", total: pagesTotal, published: pagesPublished }] : []),
    ...(canViewBlog ? [{ key: "blog", label: tDashboard("blog.title"), href: "/blog", total: blogTotal, published: blogPublished }] : []),
    ...(canViewPricing ? [{ key: "pricing", label: tDashboard("pricing.title"), href: "/pricing", total: pricingTotal, published: pricingPublished }] : []),
    ...(canViewResources
      ? [{ key: "resources", label: tDashboard("resources.title"), href: "/resources", total: resourcesTotal, published: resourcesPublished }]
      : []),
    ...(canViewCareers ? [{ key: "careers", label: tDashboard("careers.title"), href: "/careers", total: careersTotal, published: careersPublished }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t("welcome", { name: adminUser.name ?? adminUser.email })}</p>
        <p className="mt-1 text-sm text-neutral-500">
          {t("roleLabel")}: {roleLabels.join(", ")}
        </p>
      </div>

      {cards.length > 0 || canViewMedia ? (
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">{t("overviewTitle")}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {cards.map((card) => (
              <Link
                key={card.key}
                href={card.href}
                className="rounded-lg border border-neutral-200 bg-surface p-4 shadow-card transition hover:border-primary-300 hover:shadow-md"
              >
                <p className="text-sm font-medium text-neutral-600">{card.label}</p>
                <p className="mt-1 text-2xl font-semibold text-neutral-900">{card.total}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{t("statPublished", { count: card.published })}</p>
              </Link>
            ))}
            {canViewMedia ? (
              <Link
                href="/media"
                className="rounded-lg border border-neutral-200 bg-surface p-4 shadow-card transition hover:border-primary-300 hover:shadow-md"
              >
                <p className="text-sm font-medium text-neutral-600">{tDashboard("media.title")}</p>
                <p className="mt-1 text-2xl font-semibold text-neutral-900">{mediaTotal}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{t("mediaActiveLabel", { count: mediaActive })}</p>
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentLeadsWidget />

        {canViewAudit ? (
          <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">{t("recentActivityTitle")}</h2>
              <Link href="/audit" className="text-sm font-medium text-primary-600 hover:underline">
                {t("viewAll")}
              </Link>
            </div>
            {recentActivity.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">{t("noActivity")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-100">
                {recentActivity.map((entry) => (
                  <li key={entry.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-neutral-800">{entry.action}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.result === "SUCCESS"
                            ? "bg-success-bg text-success"
                            : entry.result === "DENIED"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-error-bg text-error"
                        }`}
                      >
                        {tAudit(`resultLabels.${entry.result}`)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {entry.actorEmail ?? "—"} · {new Date(entry.createdAt).toLocaleString(locale === "ar" ? "ar" : "en")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
