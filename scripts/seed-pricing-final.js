// One-time seed: replaces the live Pricing content with the Pricing spec
// v2.0 final configuration (4 plans, EGP, included-users model). Run once;
// safe to re-run (idempotent — always creates a fresh version/catalog).
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const FEATURES = [
  { key: "crmContact360", order: 0, en: { category: "CRM", feature: "CRM & Contact 360" }, ar: { category: "CRM", feature: "CRM وContact 360" } },
  { key: "aiDealScoring", order: 1, en: { category: "CRM", feature: "AI deal scoring" }, ar: { category: "CRM", feature: "تصنيف صفقات بالذكاء الاصطناعي" } },
  { key: "marketingAutomation", order: 2, en: { category: "Marketing", feature: "Marketing Automation & Campaigns" }, ar: { category: "التسويق", feature: "Marketing Automation وCampaigns" } },
  { key: "aiLeadScoring", order: 3, en: { category: "Marketing", feature: "AI lead scoring" }, ar: { category: "التسويق", feature: "تصنيف عملاء محتملين بالذكاء الاصطناعي" } },
  { key: "businessData", order: 4, en: { category: "Data", feature: "Business Data" }, ar: { category: "البيانات", feature: "Business Data" } },
  { key: "aiAssistants", order: 5, en: { category: "AI", feature: "AI Assistants" }, ar: { category: "الذكاء الاصطناعي", feature: "مساعدون ذكيون" } },
  { key: "aiAgents", order: 6, en: { category: "AI", feature: "AI Agents" }, ar: { category: "الذكاء الاصطناعي", feature: "AI Agents" } },
  { key: "workflowAutomation", order: 7, en: { category: "Automation", feature: "Workflow automation" }, ar: { category: "الأتمتة", feature: "أتمتة سير العمل" } },
  { key: "advancedPermissions", order: 8, en: { category: "Security", feature: "Advanced roles & permissions" }, ar: { category: "الأمان", feature: "أدوار وصلاحيات متقدّمة" } },
  { key: "ssoSaml", order: 9, en: { category: "Security", feature: "SSO / SAML" }, ar: { category: "الأمان", feature: "SSO / SAML" } },
  { key: "apiWebhooks", order: 10, en: { category: "Platform", feature: "API access & webhooks" }, ar: { category: "المنصة", feature: "API وWebhooks" } },
  { key: "auditLogs", order: 11, en: { category: "Platform", feature: "Advanced audit logs" }, ar: { category: "المنصة", feature: "سجلات تدقيق متقدّمة" } },
  { key: "supportLevel", order: 12, en: { category: "Support", feature: "Support level" }, ar: { category: "الدعم", feature: "مستوى الدعم" } },
];

// values per feature key, in plan order [starter, professional, business, enterprise]
const FEATURE_VALUES = {
  crmContact360: ["true", "true", "true", "true"],
  aiDealScoring: ["false", "true", "true", "true"],
  marketingAutomation: ["false", "true", "true", "true"],
  aiLeadScoring: ["false", "true", "true", "true"],
  businessData: ["false", "false", "true", "true"],
  aiAssistants: ["Basic", "Advanced", "Advanced", "Custom"],
  aiAgents: ["false", "false", "true", "true"],
  workflowAutomation: ["Basic", "Advanced", "Advanced", "Custom"],
  advancedPermissions: ["false", "false", "true", "true"],
  ssoSaml: ["false", "false", "false", "true"],
  apiWebhooks: ["false", "false", "true", "true"],
  auditLogs: ["false", "false", "true", "true"],
  supportLevel: ["Standard", "Priority", "Dedicated Onboarding", "Dedicated Support & SLA"],
};

const PLANS = [
  {
    slug: "starter",
    order: 0,
    recommended: false,
    monthlyPrice: 1990,
    annualPrice: 1592,
    trialPeriodDays: 14,
    includedUsers: 3,
    additionalUserPrice: 500,
    en: {
      name: "Starter",
      description: "For small teams getting started with ZynReach.",
      priceSuffix: "/ month",
      featureList: ["CRM & Contact 360", "Lead Generation", "Sales Pipeline", "Tasks & Activities", "Basic Automation", "Basic AI Assistants", "Basic Reports", "Email & Calendar Sync", "Standard Support"],
      ctaLabel: "Start 14-Day Free Trial",
    },
    ar: {
      name: "Starter",
      description: "للفرق الصغيرة التي تبدأ مع ZynReach.",
      priceSuffix: "/ شهريًا",
      featureList: ["CRM وContact 360", "Lead Generation", "Sales Pipeline", "المهام والأنشطة", "أتمتة أساسية", "مساعدون ذكيون أساسيون", "تقارير أساسية", "مزامنة البريد الإلكتروني والتقويم", "دعم قياسي"],
      ctaLabel: "ابدأ تجربة 14 يومًا مجانية",
    },
  },
  {
    slug: "professional",
    order: 1,
    recommended: true,
    monthlyPrice: 3990,
    annualPrice: 3192,
    trialPeriodDays: 7,
    includedUsers: 10,
    additionalUserPrice: 400,
    en: {
      name: "Professional",
      description: "For growing teams that need advanced automation and AI.",
      priceSuffix: "/ month",
      featureList: ["Everything in Starter", "Marketing Automation", "Campaigns", "AI Lead Scoring", "AI Deal Scoring", "Advanced Automation", "Advanced Analytics & Dashboards", "Team Collaboration", "Advanced Permissions", "Email Automation", "Priority Support"],
      ctaLabel: "Start 7-Day Free Trial",
      badgeLabel: "MOST POPULAR",
    },
    ar: {
      name: "Professional",
      description: "للفرق النامية التي تحتاج أتمتة وذكاءً اصطناعيًا متقدّمين.",
      priceSuffix: "/ شهريًا",
      featureList: ["كل ما في خطة Starter", "Marketing Automation", "Campaigns", "AI Lead Scoring", "AI Deal Scoring", "أتمتة متقدّمة", "تحليلات ولوحات متقدّمة", "تعاون الفريق", "صلاحيات متقدّمة", "أتمتة البريد الإلكتروني", "دعم ذو أولوية"],
      ctaLabel: "ابدأ تجربة 7 أيام مجانية",
      badgeLabel: "الأكثر شيوعًا",
    },
  },
  {
    // repurposes the existing "growth" plan (old $89 test data) as Business —
    // slug changes to "business" so it matches the spec's final 4-plan set.
    existingSlug: "growth",
    slug: "business",
    order: 2,
    recommended: false,
    monthlyPrice: 7990,
    annualPrice: 6392,
    trialPeriodDays: 7,
    includedUsers: 25,
    additionalUserPrice: 350,
    en: {
      name: "Business",
      description: "For growing and multi-team organizations.",
      priceSuffix: "/ month",
      featureList: ["Everything in Professional", "Business Data", "AI Agents", "Advanced Workflow Automation", "Multi-Team & Department Management", "Advanced Roles & Permissions", "Executive Dashboards", "API Access & Webhooks", "Advanced Integrations", "Advanced Audit Logs & Data Export", "Advanced Security", "Dedicated Onboarding"],
      ctaLabel: "Start 7-Day Free Trial",
    },
    ar: {
      name: "Business",
      description: "للمؤسسات النامية متعددة الفرق.",
      priceSuffix: "/ شهريًا",
      featureList: ["كل ما في خطة Professional", "Business Data", "AI Agents", "أتمتة سير عمل متقدّمة", "إدارة فرق وأقسام متعددة", "أدوار وصلاحيات متقدّمة", "لوحات تنفيذية", "API وWebhooks", "تكاملات متقدّمة", "سجلات تدقيق متقدّمة وتصدير بيانات", "أمان متقدّم", "تأهيل مخصّص"],
      ctaLabel: "ابدأ تجربة 7 أيام مجانية",
    },
  },
  {
    slug: "enterprise",
    order: 3,
    recommended: false,
    monthlyPrice: null,
    annualPrice: null,
    trialPeriodDays: null,
    includedUsers: null,
    additionalUserPrice: null,
    en: {
      name: "Enterprise",
      description: "Built for organizations that require enterprise-grade capabilities.",
      priceSuffix: "Custom Pricing",
      featureList: ["Custom users & workspaces", "Enterprise Security", "SSO & SAML", "Custom API & Integrations", "Custom AI & Workflows", "Advanced Governance", "SLA", "Dedicated Customer Success & Support", "Migration & Enterprise Onboarding"],
      ctaLabel: "Talk to Sales",
    },
    ar: {
      name: "Enterprise",
      description: "مصمَّمة للمؤسسات التي تحتاج قدرات على مستوى المؤسسات.",
      priceSuffix: "Custom Pricing",
      featureList: ["مستخدمون ومساحات عمل مخصّصة", "أمان على مستوى المؤسسات", "SSO وSAML", "API وتكاملات مخصّصة", "ذكاء اصطناعي وسير عمل مخصّص", "حوكمة متقدّمة", "SLA", "نجاح عملاء ودعم مخصّص", "ترحيل وتأهيل مؤسسي"],
      ctaLabel: "تحدث مع المبيعات",
    },
  },
];

async function main() {
  console.log("=== Rebuilding PricingFeature catalog ===");
  await prisma.pricingFeature.deleteMany({});
  const featureByKey = new Map();
  for (const f of FEATURES) {
    const created = await prisma.pricingFeature.create({
      data: { key: f.key, order: f.order, translations: { en: f.en, ar: f.ar } },
    });
    featureByKey.set(f.key, created.id);
  }
  console.log(`Created ${featureByKey.size} features.`);

  console.log("\n=== Upserting plans ===");
  for (let i = 0; i < PLANS.length; i++) {
    const p = PLANS[i];
    const lookupSlug = p.existingSlug ?? p.slug;
    let plan = await prisma.pricingPlan.findUnique({ where: { slug: lookupSlug }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });

    if (!plan) {
      plan = await prisma.pricingPlan.create({
        data: { slug: p.slug, visibility: "PUBLIC", featured: false, recommended: p.recommended, order: p.order, status: "PUBLISHED" },
        include: { versions: true },
      });
      console.log(`Created new plan "${p.slug}".`);
    } else {
      plan = await prisma.pricingPlan.update({
        where: { id: plan.id },
        data: { slug: p.slug, visibility: "PUBLIC", recommended: p.recommended, order: p.order, status: "PUBLISHED" },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      console.log(`Updated existing plan "${lookupSlug}" -> "${p.slug}".`);
    }

    const nextVersionNumber = (plan.versions[0]?.versionNumber ?? 0) + 1;
    const version = await prisma.pricingVersion.create({
      data: {
        pricingPlanId: plan.id,
        versionNumber: nextVersionNumber,
        monthlyPrice: p.monthlyPrice,
        annualPrice: p.annualPrice,
        currency: "EGP",
        trialPeriodDays: p.trialPeriodDays,
        includedUsers: p.includedUsers,
        additionalUserPrice: p.additionalUserPrice,
        ctaTarget: p.slug === "enterprise" ? "/enterprise" : "/trial",
        translations: { en: p.en, ar: p.ar },
        publishedAt: new Date(),
        features: {
          create: FEATURES.map((f) => ({ pricingFeatureId: featureByKey.get(f.key), value: FEATURE_VALUES[f.key][i] })),
        },
      },
    });
    await prisma.pricingPlan.update({ where: { id: plan.id }, data: { currentVersionId: version.id } });
    console.log(`  -> version ${nextVersionNumber}: ${p.monthlyPrice ?? "custom"} EGP/mo, includedUsers=${p.includedUsers}, trial=${p.trialPeriodDays}d`);
  }

  console.log("\n=== Final state ===");
  const finalPlans = await prisma.pricingPlan.findMany({ orderBy: { order: "asc" }, include: { currentVersion: true } });
  for (const p of finalPlans) {
    console.log(p.slug, "| recommended:", p.recommended, "| price:", p.currentVersion.monthlyPrice, p.currentVersion.currency, "| includedUsers:", p.currentVersion.includedUsers);
  }
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
