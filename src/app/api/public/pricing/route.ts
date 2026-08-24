import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { executeDuePricingPublications } from "@/lib/content/scheduler";

interface LocaleText {
  name: string;
  description: string;
  priceSuffix: string;
  featureList: string[];
  ctaLabel: string;
  badgeLabel?: string;
}

/**
 * SRS §29 Public Read: "Published PricingPlan set for the live calculator
 * (FR-WEB-006)." Service-token authenticated (same contract as the Pages
 * public read route) — System A's own request carries the shared token,
 * never a browser-facing endpoint. Resolves the requested locale's
 * PricingVersion.translations and each PricingVersionFeature into the
 * exact PricingPlan/ComparisonRow shape System A's pricing page already
 * expects (src/types/content.ts), so wiring System A only means swapping
 * its data *source*, not its rendering.
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  await executeDuePricingPublications();

  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  // Pricing is direct-save (see the admin PATCH handler's docstring): the
  // admin's chosen status is the definitive, immediate live/offline
  // decision, so this reads PricingPlan.status/currentVersion directly
  // rather than "last published version" — a plan the admin just set to
  // Draft must disappear now, not keep showing an older Published copy.
  const allPlans = await prisma.pricingPlan.findMany({
    where: { status: "PUBLISHED", visibility: "PUBLIC" },
    orderBy: { order: "asc" },
    include: {
      currentVersion: {
        include: { features: { include: { feature: true }, orderBy: { feature: { order: "asc" } } } },
      },
      promotionLinks: {
        include: { promotion: true },
      },
    },
  });
  const plans = allPlans.filter((plan) => plan.currentVersion !== null);

  const now = new Date();
  const responsePlans = plans
    .map((plan) => {
      const version = plan.currentVersion!;
      const text = (version.translations as unknown as Record<"en" | "ar", LocaleText>)[locale];
      const activePromotion = plan.promotionLinks
        .map((link) => link.promotion)
        .find((promo) => (!promo.startDate || promo.startDate <= now) && (!promo.endDate || promo.endDate >= now));

      return {
        id: plan.slug,
        name: text.name,
        description: text.description,
        monthlyPrice: version.monthlyPrice,
        annualPrice: version.annualPrice,
        currency: version.currency,
        priceSuffix: text.priceSuffix,
        featureList: text.featureList,
        ctaLabel: text.ctaLabel,
        ctaHref: version.ctaTarget,
        isFeatured: plan.featured,
        recommended: plan.recommended,
        badgeLabel: text.badgeLabel ?? null,
        trialPeriodDays: version.trialPeriodDays,
        promotion: activePromotion
          ? {
              name: (activePromotion.translations as unknown as Record<"en" | "ar", { name: string }>)[locale].name,
              discountType: activePromotion.discountType,
              discountValue: activePromotion.discountValue,
            }
          : null,
      };
    });

  // Comparison-table rows: one row per PricingFeature, in its own display
  // order, with one value per plan (in the same plan order above) — this
  // is the exact shape ComparisonRow (src/types/content.ts) expects.
  const featureIds = new Set<string>();
  const featureOrder: { id: string; category: string; feature: string; order: number }[] = [];
  for (const plan of plans) {
    for (const link of plan.currentVersion?.features ?? []) {
      if (featureIds.has(link.pricingFeatureId)) continue;
      featureIds.add(link.pricingFeatureId);
      const text = (link.feature.translations as unknown as Record<"en" | "ar", { category: string; feature: string }>)[locale];
      featureOrder.push({ id: link.pricingFeatureId, category: text.category, feature: text.feature, order: link.feature.order });
    }
  }
  featureOrder.sort((a, b) => a.order - b.order);

  const comparisonMatrix = featureOrder.map((f) => ({
    category: f.category,
    feature: f.feature,
    values: plans.map((plan) => {
      const link = plan.currentVersion?.features.find((fl) => fl.pricingFeatureId === f.id);
      if (!link) return "";
      if (link.value === "true") return true;
      if (link.value === "false") return false;
      return link.value;
    }),
  }));

  return NextResponse.json({ plans: responsePlans, comparisonMatrix });
}
