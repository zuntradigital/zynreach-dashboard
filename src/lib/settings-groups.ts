/**
 * M8 Global Website Settings (SRS §22) — the canonical group/field list,
 * shared between the API route (to validate the `group` path segment)
 * and the Settings page (to render each group's form). One definition,
 * not duplicated between server and client.
 *
 * Covers 9 of the 10 flat/scalar-valued §22 groups (Localization is a
 * read-only info panel, handled separately in the Settings page). Global
 * Banners is a genuinely dynamic list-of-records group (individually
 * created/deleted entries with their own date ranges) and lives in its
 * own AnnouncementBanner table + /api/admin/settings/banners route
 * instead of here — see that model's schema comment for the reasoning.
 *
 * The `consent` group's key matches the SRS's own traceability table
 * (§34: "§19 — cookie consent ... | /api/admin/settings/consent |
 * SiteSetting") exactly, including the endpoint path.
 */

export type SettingFieldType = "text" | "email" | "url" | "textarea" | "toggle" | "multiselect";

export interface SettingField {
  key: string;
  type: SettingFieldType;
  /** i18n key suffix under dashboard.settings.fields.{group}.{key} */
  labelKey: string;
  options?: string[];
}

export interface SettingGroupDef {
  group: string;
  /** i18n key under dashboard.settings.groups.{group} */
  titleKey: string;
  fields: SettingField[];
}

export const SETTINGS_GROUPS: SettingGroupDef[] = [
  {
    group: "identity",
    titleKey: "identity",
    fields: [
      { key: "siteName", type: "text", labelKey: "siteName" },
      { key: "logoUrl", type: "url", labelKey: "logoUrl" },
      { key: "faviconUrl", type: "url", labelKey: "faviconUrl" },
    ],
  },
  {
    group: "contact",
    titleKey: "contact",
    fields: [
      { key: "supportEmail", type: "email", labelKey: "supportEmail" },
      { key: "salesEmail", type: "email", labelKey: "salesEmail" },
      { key: "phone", type: "text", labelKey: "phone" },
      { key: "mailingAddress", type: "textarea", labelKey: "mailingAddress" },
    ],
  },
  {
    group: "social",
    titleKey: "social",
    fields: [
      { key: "linkedinUrl", type: "url", labelKey: "linkedinUrl" },
      { key: "twitterUrl", type: "url", labelKey: "twitterUrl" },
      { key: "facebookUrl", type: "url", labelKey: "facebookUrl" },
      { key: "instagramUrl", type: "url", labelKey: "instagramUrl" },
      { key: "youtubeUrl", type: "url", labelKey: "youtubeUrl" },
    ],
  },
  {
    group: "seo",
    titleKey: "seo",
    fields: [
      { key: "titleSuffix", type: "text", labelKey: "titleSuffix" },
      { key: "defaultMetaDescription", type: "textarea", labelKey: "defaultMetaDescription" },
      { key: "defaultOgImageUrl", type: "url", labelKey: "defaultOgImageUrl" },
      { key: "defaultOrgStructuredData", type: "textarea", labelKey: "defaultOrgStructuredData" },
    ],
  },
  {
    group: "analytics",
    titleKey: "analytics",
    fields: [
      { key: "ga4MeasurementId", type: "text", labelKey: "ga4MeasurementId" },
      { key: "gtmContainerId", type: "text", labelKey: "gtmContainerId" },
      { key: "clarityProjectId", type: "text", labelKey: "clarityProjectId" },
      { key: "metaPixelId", type: "text", labelKey: "metaPixelId" },
      { key: "linkedinInsightTagId", type: "text", labelKey: "linkedinInsightTagId" },
    ],
  },
  {
    group: "legal",
    titleKey: "legal",
    fields: [
      { key: "privacyPolicyUrl", type: "url", labelKey: "privacyPolicyUrl" },
      { key: "termsOfServiceUrl", type: "url", labelKey: "termsOfServiceUrl" },
      { key: "cookiePolicyUrl", type: "url", labelKey: "cookiePolicyUrl" },
      { key: "dpaUrl", type: "url", labelKey: "dpaUrl" },
    ],
  },
  {
    group: "footer",
    titleKey: "footer",
    fields: [
      { key: "showPlatformColumn", type: "toggle", labelKey: "showPlatformColumn" },
      { key: "showSolutionsColumn", type: "toggle", labelKey: "showSolutionsColumn" },
      { key: "showIndustriesColumn", type: "toggle", labelKey: "showIndustriesColumn" },
      { key: "showResourcesColumn", type: "toggle", labelKey: "showResourcesColumn" },
      { key: "showCompanyColumn", type: "toggle", labelKey: "showCompanyColumn" },
      { key: "showLegalColumn", type: "toggle", labelKey: "showLegalColumn" },
      {
        key: "trustBadges",
        type: "multiselect",
        labelKey: "trustBadges",
        options: ["SOC2", "GDPR", "ISO27001"],
      },
    ],
  },
  {
    group: "navigation",
    titleKey: "navigation",
    fields: [
      { key: "showPlatformNav", type: "toggle", labelKey: "showPlatformNav" },
      { key: "showSolutionsNav", type: "toggle", labelKey: "showSolutionsNav" },
      { key: "showIndustriesNav", type: "toggle", labelKey: "showIndustriesNav" },
      { key: "showPricingNav", type: "toggle", labelKey: "showPricingNav" },
      { key: "showKnowledgeCenterNav", type: "toggle", labelKey: "showKnowledgeCenterNav" },
      { key: "showCompanyNav", type: "toggle", labelKey: "showCompanyNav" },
    ],
  },
  {
    group: "maintenanceMode",
    titleKey: "maintenanceMode",
    fields: [
      { key: "enabled", type: "toggle", labelKey: "enabled" },
      { key: "reason", type: "textarea", labelKey: "reason" },
    ],
  },
  {
    group: "consent",
    titleKey: "consent",
    fields: [
      { key: "essentialDefault", type: "toggle", labelKey: "essentialDefault" },
      { key: "analyticsDefault", type: "toggle", labelKey: "analyticsDefault" },
      { key: "advertisingDefault", type: "toggle", labelKey: "advertisingDefault" },
      { key: "functionalDefault", type: "toggle", labelKey: "functionalDefault" },
      { key: "bannerCopy", type: "textarea", labelKey: "bannerCopy" },
    ],
  },
];

export const SETTINGS_GROUP_NAMES = SETTINGS_GROUPS.map((g) => g.group);

export function isValidSettingsGroup(group: string): boolean {
  return SETTINGS_GROUP_NAMES.includes(group);
}
