/**
 * Phase 1 bootstrap seed.
 *
 * Seeds exactly two things:
 *  1. The SRS §8 role catalog, by name and description, verbatim from
 *     the SRS's own table — these are SRS-named roles, not invented
 *     ones. Only Super Administrator is granted a permission right now,
 *     because "leads:view" is the only permission that exists in Phase
 *     1 — every other module's permissions get added by that module's
 *     own later-phase seed/migration, not invented here ahead of need.
 *  2. One initial Super Administrator AdminUser, so there is a way to
 *     log in at all. Its password is randomly generated and printed
 *     once — never hardcoded, never committed.
 *
 * Re-runnable: every create is upsert-by-unique-key, so running this
 * again after a later phase adds more roles/permissions won't duplicate
 * or reset what's already there.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/lib/auth/password";
// One-time Careers migration source: importing directly from zynreach-website's
// own source (a sibling repo checked out alongside this one) instead of
// retyping 6 full job listings + their EN/AR translations by hand — the exact
// same live content, read at its source of truth, not re-transcribed.
import { jobListings as careersJobListings } from "../../zynreach-website/src/lib/content/careers";
import careersEnMessages from "../../zynreach-website/messages/en.json" with { type: "json" };
import careersArMessages from "../../zynreach-website/messages/ar.json" with { type: "json" };

const prisma = new PrismaClient();

/** SRS §30: "MFA available and required for Super Administrator and
 * Publisher roles." Every other role authenticates with email + password
 * alone so day-to-day content staff (Editors, Reviewers, etc., who cannot
 * themselves make anything go live) aren't forced through MFA — only the
 * two roles that can actually publish to the live site require it. */
const ROLE_CATALOG: { name: string; description: string; mfaRequired?: boolean }[] = [
  { name: "Super Administrator", description: "Full system access; manages roles, permissions, integrations, and global settings.", mfaRequired: true },
  { name: "Content Editor", description: "Create and edit drafts across content types; submit for review. Cannot publish by default." },
  { name: "Writer", description: "Writes and submits new content for review; can archive content. Cannot edit existing drafts or publish by default." },
  { name: "Sales Operations", description: "Views, exports, and reassigns Leads / Potential Customers. No content-authoring rights by default." },
];

/**
 * Roles retired on request — no longer assignable anywhere in the system.
 * Deleting the Role row cascades its RolePermission and AdminUserRole join
 * rows (see their onDelete: Cascade in schema.prisma), so this alone is
 * enough to make the role disappear from Users/Roles management, the
 * permission matrix, and every authorization check — there is no separate
 * "hidden but still assignable" state to worry about.
 */
const RETIRED_ROLE_NAMES = [
  "Legal & Compliance Reviewer",
  "Website Administrator",
  "Media Manager",
  "Publisher",
  "Read Only",
  "Reviewer",
  "Content Manager",
  "SEO Manager",
  "Marketing Manager",
  "Analyst",
];

async function main() {
  // One-time role rename: "Pricing Manager" -> "Sales" (broadened scope:
  // Pricing + Leads + Chatbot Reply). Renamed in place (same row id, same
  // RolePermission/AdminUserRole relations) rather than created fresh —
  // an account already holding this role keeps it, under its new name,
  // instead of being silently dropped to no role.
  const legacyPricingManager = await prisma.role.findUnique({ where: { name: "Pricing Manager" } });
  if (legacyPricingManager) {
    await prisma.role.update({ where: { id: legacyPricingManager.id }, data: { name: "Sales" } });
    console.log('Renamed role "Pricing Manager" -> "Sales".');
  }

  // One-time role rename: "Sales" -> "Sales Operations" (narrowed scope:
  // Leads only, per the approved final role structure — Pricing and Chat
  // Reply are no longer part of this role's default grant). Renamed in
  // place for the same reason as the rename above; the old Pricing/Chat
  // grants are explicitly stripped below rather than left dangling on a
  // role whose description no longer mentions them.
  const legacySales = await prisma.role.findUnique({ where: { name: "Sales" } });
  if (legacySales) {
    await prisma.role.update({ where: { id: legacySales.id }, data: { name: "Sales Operations" } });
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: legacySales.id,
        permission: { module: { in: ["pricing", "chat"] } },
      },
    });
    console.log('Renamed role "Sales" -> "Sales Operations" and removed its Pricing/Chat grants (out of scope for the new role definition).');
  }

  // One-time retired-role cleanup. Any account left holding zero roles
  // once its retired role(s) are gone is deactivated rather than left
  // "Active" with nothing it can access — an Active account with no
  // permissions at all is a confusing dead end, not a safe default.
  const retiredRoles = await prisma.role.findMany({ where: { name: { in: RETIRED_ROLE_NAMES } } });
  if (retiredRoles.length > 0) {
    const retiredRoleIds = retiredRoles.map((r) => r.id);
    const affectedUsers = await prisma.adminUser.findMany({
      where: { roles: { some: { roleId: { in: retiredRoleIds } } } },
      include: { roles: true },
    });
    for (const user of affectedUsers) {
      const leftWithNoRoles = user.roles.every((r) => retiredRoleIds.includes(r.roleId));
      if (leftWithNoRoles && user.status !== "DEACTIVATED") {
        await prisma.adminUser.update({ where: { id: user.id }, data: { status: "DEACTIVATED" } });
        console.log(`Deactivated ${user.email} — held only retired role(s), no access left after cleanup.`);
      }
    }
    await prisma.role.deleteMany({ where: { id: { in: retiredRoleIds } } });
    console.log(`Removed ${retiredRoles.length} retired role(s): ${RETIRED_ROLE_NAMES.join(", ")}.`);
  }

  console.log("Seeding role catalog (SRS §8)...");
  const roleIdByName = new Map<string, string>();
  for (const role of ROLE_CATALOG) {
    const record = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description, mfaRequired: role.mfaRequired ?? false },
      create: {
        name: role.name,
        description: role.description,
        mfaRequired: role.mfaRequired ?? false,
        isSystemDefault: true,
      },
    });
    roleIdByName.set(role.name, record.id);
  }

  console.log("Seeding Phase 1 permission catalog...");

  // Backs PUT /api/admin/admin-users/[id]/roles — the minimal RBAC-admin
  // surface that makes §30's session-invalidation-on-role-change actually
  // reachable. Granted only to Super Administrator, matching its SRS §8
  // description ("manages roles, permissions...").
  const rbacManage = await prisma.permission.upsert({
    where: { module_action: { module: "rbac", action: "manage" } },
    update: {},
    create: { module: "rbac", action: "manage" },
  });

  // Backs GET /api/admin/audit-log (SCR-051). SRS: "View — Analyst, Super
  // Administrator, Read Only, and any role with explicit Audit Log View
  // permission granted." Per-role module-scoping ("except for Super
  // Administrator, who sees all unscoped") is not implemented yet — there
  // is no other module-permission catalog to scope against until later
  // phases add one, so every role holding this permission currently sees
  // the same (Phase 1-sized) audit trail. Documented as a known
  // simplification, not silently done.
  const auditView = await prisma.permission.upsert({
    where: { module_action: { module: "audit", action: "view" } },
    update: {},
    create: { module: "audit", action: "view" },
  });

  // Backs GET/PATCH /api/admin/settings/[group] (M8, §22, FR-ADM-019).
  // SRS lists per-group actor variation (e.g. "SEO Manager,
  // Website Administrator" for Default SEO; "Super Administrator,
  // Website Administrator" for Maintenance Mode) — Phase 1's permission
  // catalog is still module-level (module:action), not per-group, so
  // this single permission covers the whole module for the two roles
  // every group's actor list has in common: Super Administrator and
  // Website Administrator. Documented simplification, same pattern as
  // audit:view's per-role scoping note above.
  const settingsManage = await prisma.permission.upsert({
    where: { module_action: { module: "settings", action: "manage" } },
    update: {},
    create: { module: "settings", action: "manage" },
  });

  const superAdminRoleId = roleIdByName.get("Super Administrator")!;
  for (const permission of [rbacManage, auditView, settingsManage]) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdminRoleId, permissionId: permission.id } },
      update: {},
      create: { roleId: superAdminRoleId, permissionId: permission.id },
    });
  }

  // Chatbot management was removed from the Dashboard entirely — the
  // chatbot now belongs solely to the website (its own widget + Tawk.to),
  // and no admin role should be able to view or reply to conversations
  // from here. Prior seed runs created chat:view/chat:reply and granted
  // them to Super Administrator; that upsert-based grant is additive-only
  // and would never remove them on its own, so this explicit delete is the
  // cleanup step (mirrors the stale Delete-grant cleanup below). Deleting
  // the Permission rows cascades their RolePermission grants. The public,
  // service-token-gated chat ingest endpoint and the ChatConversation/
  // ChatMessage tables are untouched — those belong to the website's own
  // chatbot backend, not to Dashboard RBAC.
  const { count: staleChatPermissionCount } = await prisma.permission.deleteMany({ where: { module: "chat" } });
  if (staleChatPermissionCount > 0) {
    console.log(`Removed ${staleChatPermissionCount} chat:* permission(s) — Chatbot management is no longer part of the Dashboard.`);
  }

  // Leads / Potential Customers (§20.2, SCR-034/035). Independent actions
  // per the approved final role structure — Sales Operations gets
  // View/Edit/Export by default (Edit backs Reassign Owner via PATCH
  // /api/admin/leads/[id]); Delete/Archive exist as real, working actions
  // (PATCH .../archive, DELETE) but stay OFF for every role by default,
  // configurable later from the Roles & Permissions matrix. There is no
  // real CRM integration in this codebase to "sync" against — no
  // leads:crmSync permission is created, since a permission with nothing
  // behind it would be exactly the visual-only toggle this system must
  // never have; the existing crmSyncStatus/crmSyncedAt fields remain
  // display-only until that integration is actually built.
  const leadsActions = ["view", "edit", "archive", "delete", "export"] as const;
  const leadsPermissions = new Map<string, { id: string }>();
  for (const action of leadsActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "leads", action } },
      update: {},
      create: { module: "leads", action },
    });
    leadsPermissions.set(action, permission);
  }
  async function grantLeads(roleName: string, actions: (typeof leadsActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = leadsPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantLeads("Sales Operations", ["view", "edit", "export"]);
  // Super Administrator: Delete stays OFF by default across every module,
  // per the approved final role structure — configurable later, not a
  // permanent restriction.
  await grantLeads("Super Administrator", ["view", "edit", "archive", "export"]);

  // One-time action rename, run once per governed content module before
  // the upsert-based catalog below: "review" -> "approve", freeing
  // "review" to no longer conflate Approve with Request Changes (they
  // were previously the same permission — see the actions route's own
  // comment). Renamed in place so any existing grant (Super
  // Administrator's) carries over under the new name rather than being
  // silently dropped.
  for (const moduleName of ["content", "blog", "resources", "careers"]) {
    const legacyReview = await prisma.permission.findUnique({ where: { module_action: { module: moduleName, action: "review" } } });
    if (legacyReview) {
      await prisma.permission.update({ where: { id: legacyReview.id }, data: { action: "approve" } });
      console.log(`Renamed permission "${moduleName}:review" -> "${moduleName}:approve".`);
    }
  }

  // Content Management (§13.1, §16, SCR-002/003/017/019, actions route).
  // Eleven independent actions (twelve on Pages, which alone carries
  // reviewLegal) because the approved final role structure requires each
  // stage of Draft -> Submit -> Approve/Request Changes -> Publish/
  // Schedule -> Archive, plus Create distinct from Edit and Rollback
  // distinct from Edit, to be independently grantable — no action implies
  // another (having Create does not grant Edit; having Approve does not
  // grant Publish; having Publish does not grant Schedule). reviewLegal
  // stays its own action, not folded into approve — it's the §13.3
  // "mandatory additional Approval step from a Legal & Compliance
  // Reviewer role" gate; a Content Manager's ordinary `approve` can never
  // satisfy it for a Legal/Security-classified Page.
  const contentActions = [
    "view",
    "create",
    "edit",
    "delete",
    "archive",
    "submit",
    "requestChanges",
    "approve",
    "publish",
    "schedule",
    "rollback",
    "reviewLegal",
  ] as const;
  const contentPermissions = new Map<string, { id: string }>();
  for (const action of contentActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "content", action } },
      update: {},
      create: { module: "content", action },
    });
    contentPermissions.set(action, permission);
  }

  async function grantContent(roleName: string, actions: (typeof contentActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = contentPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }

  // Defaults per the approved final role structure (Delete/Archive are
  // real, working actions for every role below but stay OFF by default,
  // configurable later from the Roles & Permissions matrix — see the
  // Permission catalog's own comment for why they still exist as rows
  // even when nobody is granted them yet).
  await grantContent("Content Editor", ["view", "create", "edit", "submit"]);
  await grantContent("Writer", ["view", "create", "archive", "submit"]);
  // Super Administrator: Delete stays OFF by default (see the seed's own
  // top-level note) — every other action is granted.
  await grantContent("Super Administrator", [
    "view",
    "create",
    "edit",
    "archive",
    "submit",
    "requestChanges",
    "approve",
    "publish",
    "schedule",
    "rollback",
    "reviewLegal",
  ]);

  // Media Library (§18, FR-ADM-010/011). "Media Manager: Full authority
  // over Media Library: upload, tag, replace, archive assets" (§8) —
  // archive/delete stay Media-Manager-and-above only (higher blast
  // radius: archiving/deleting an asset affects every page referencing
  // it). §8 doesn't name Media permissions for Content Editor/Manager,
  // but the Page Builder's image fields need *some* way to pick media
  // while editing a page — granting view+upload (not edit/archive/
  // delete) is the minimum that makes that screen usable without
  // widening who can reorganize or remove the shared library. Disclosed
  // gap-filling, not an SRS requirement, same pattern as every other
  // permission-catalog decision in this codebase.
  const mediaActions = ["view", "upload", "edit", "archive", "delete"] as const;
  const mediaPermissions = new Map<string, { id: string }>();
  for (const action of mediaActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "media", action } },
      update: {},
      create: { module: "media", action },
    });
    mediaPermissions.set(action, permission);
  }

  async function grantMedia(roleName: string, actions: (typeof mediaActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = mediaPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }

  // Media Manager/Content Manager/Read Only were retired above.
  await grantMedia("Content Editor", ["view", "upload"]);
  // Super Administrator: Delete stays OFF by default.
  await grantMedia("Super Administrator", ["view", "upload", "edit", "archive"]);

  // Pricing Management (§3, §15). "Pricing Manager: Full authority over
  // the Pricing module lifecycle, subject to the same reviewer-approval
  // gate as other Pricing actors" (§8) — view+edit only, deliberately no
  // review/publish, since §23/§13.1 make Pricing self-publish a hard
  // system rule ("never permits self-publish, regardless of role
  // configuration"), not a role-configurable default like Blog/Resources.
  // Reviewer/Publisher reuse the same generic roles Content already uses
  // — Pricing has no Legal-style stricter reviewer carve-out of its own.
  const pricingActions = ["view", "edit", "review", "publish", "delete"] as const;
  const pricingPermissions = new Map<string, { id: string }>();
  for (const action of pricingActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "pricing", action } },
      update: {},
      create: { module: "pricing", action },
    });
    pricingPermissions.set(action, permission);
  }

  async function grantPricing(roleName: string, actions: (typeof pricingActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = pricingPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }

  // No role holds Pricing by default under the approved final role
  // structure — Sales Operations' default grant is Leads-only (its old
  // Pricing grant, from when it was named "Sales", was stripped above
  // when the role was renamed), and Pricing Manager remains retired.
  // Super Administrator: Delete stays OFF by default.
  await grantPricing("Super Administrator", ["view", "edit", "review", "publish"]);

  // Blog, Resources, Careers — same eleven-action independent catalog as
  // Content (no reviewLegal: none of these three models carry a
  // classification field, so there is no Legal/Security carve-out for
  // them to gate). §16's "Blog and Resources exception" (self-publish
  // permitted for standard content, unlike Pricing) is expressed simply
  // by these three modules' `publish` action being independently
  // grantable at all — there is no Pricing-style hard block on it.
  const blogActions = [
    "view", "create", "edit", "delete", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ] as const;
  const blogPermissions = new Map<string, { id: string }>();
  for (const action of blogActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "blog", action } },
      update: {},
      create: { module: "blog", action },
    });
    blogPermissions.set(action, permission);
  }
  async function grantBlog(roleName: string, actions: (typeof blogActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = blogPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantBlog("Content Editor", ["view", "create", "edit", "submit"]);
  await grantBlog("Writer", ["view", "create", "archive", "submit"]);
  await grantBlog("Super Administrator", [
    "view", "create", "edit", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ]);

  const resourcesActions = [
    "view", "create", "edit", "delete", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ] as const;
  const resourcesPermissions = new Map<string, { id: string }>();
  for (const action of resourcesActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "resources", action } },
      update: {},
      create: { module: "resources", action },
    });
    resourcesPermissions.set(action, permission);
  }
  async function grantResources(roleName: string, actions: (typeof resourcesActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = resourcesPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantResources("Content Editor", ["view", "create", "edit", "submit"]);
  await grantResources("Writer", ["view", "create", "archive", "submit"]);
  await grantResources("Super Administrator", [
    "view", "create", "edit", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ]);

  // Careers (§16 "Careers override layer", FR-ADM-029) — see the
  // JobListing model's own schema comment for why this is modeled as a
  // governed content type rather than the SRS's literal ATS-override framing.
  const careersActions = [
    "view", "create", "edit", "delete", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ] as const;
  const careersPermissions = new Map<string, { id: string }>();
  for (const action of careersActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "careers", action } },
      update: {},
      create: { module: "careers", action },
    });
    careersPermissions.set(action, permission);
  }
  async function grantCareers(roleName: string, actions: (typeof careersActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = careersPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantCareers("Content Editor", ["view", "create", "edit", "submit"]);
  await grantCareers("Writer", ["view", "create", "archive", "submit"]);
  await grantCareers("Super Administrator", [
    "view", "create", "edit", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ]);

  // Customer Stories, Webinars — Knowledge Center content types (file 2
  // §23 groups these with Blog under "Marketing/Knowledge Content"), so
  // they get the exact same eleven-action governed-workflow catalog and
  // default grants as Blog/Resources/Careers above.
  const customerStoriesActions = [
    "view", "create", "edit", "delete", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ] as const;
  const customerStoriesPermissions = new Map<string, { id: string }>();
  for (const action of customerStoriesActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "customerStories", action } },
      update: {},
      create: { module: "customerStories", action },
    });
    customerStoriesPermissions.set(action, permission);
  }
  async function grantCustomerStories(roleName: string, actions: (typeof customerStoriesActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = customerStoriesPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantCustomerStories("Content Editor", ["view", "create", "edit", "submit"]);
  await grantCustomerStories("Writer", ["view", "create", "archive", "submit"]);
  await grantCustomerStories("Super Administrator", [
    "view", "create", "edit", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ]);

  const webinarsActions = [
    "view", "create", "edit", "delete", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ] as const;
  const webinarsPermissions = new Map<string, { id: string }>();
  for (const action of webinarsActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "webinars", action } },
      update: {},
      create: { module: "webinars", action },
    });
    webinarsPermissions.set(action, permission);
  }
  async function grantWebinars(roleName: string, actions: (typeof webinarsActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = webinarsPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantWebinars("Content Editor", ["view", "create", "edit", "submit"]);
  await grantWebinars("Writer", ["view", "create", "archive", "submit"]);
  await grantWebinars("Super Administrator", [
    "view", "create", "edit", "archive", "submit", "requestChanges", "approve", "publish", "schedule", "rollback",
  ]);

  // Documentation, API Reference — Technical/Developer Content (file 2
  // §23 separates these from Marketing/Knowledge Content; their own §19
  // CMS field lists don't mention submit/approve/schedule verbs), so
  // these get the simpler direct-edit action set matching DocArticle/
  // ApiEndpoint's simpler ContentStatus-only model (see schema.prisma's
  // comment on those models) — no submit/requestChanges/approve/schedule/
  // rollback actions exist for these two modules at all.
  const docsActions = ["view", "create", "edit", "delete", "publish", "archive"] as const;
  const docsPermissions = new Map<string, { id: string }>();
  for (const action of docsActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "docs", action } },
      update: {},
      create: { module: "docs", action },
    });
    docsPermissions.set(action, permission);
  }
  async function grantDocs(roleName: string, actions: (typeof docsActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = docsPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantDocs("Content Editor", ["view", "create", "edit"]);
  // Super Administrator: Delete stays OFF by default (see the seed's own
  // top-level note).
  await grantDocs("Super Administrator", ["view", "create", "edit", "publish", "archive"]);

  const apiActions = ["view", "create", "edit", "delete", "publish", "archive"] as const;
  const apiPermissions = new Map<string, { id: string }>();
  for (const action of apiActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "api", action } },
      update: {},
      create: { module: "api", action },
    });
    apiPermissions.set(action, permission);
  }
  async function grantApi(roleName: string, actions: (typeof apiActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = apiPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantApi("Content Editor", ["view", "create", "edit"]);
  await grantApi("Super Administrator", ["view", "create", "edit", "publish", "archive"]);

  // Knowledge Center FAQ — same simpler direct-edit action set as
  // Docs/API (no submit/requestChanges/approve/schedule/rollback verbs):
  // an admin picks Draft/Published/Archived on every save.
  const faqActions = ["view", "create", "edit", "delete", "publish", "archive"] as const;
  const faqPermissions = new Map<string, { id: string }>();
  for (const action of faqActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "faq", action } },
      update: {},
      create: { module: "faq", action },
    });
    faqPermissions.set(action, permission);
  }
  async function grantFaq(roleName: string, actions: (typeof faqActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = faqPermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantFaq("Content Editor", ["view", "create", "edit"]);
  // Super Administrator: Delete stays OFF by default (see the seed's own top-level note).
  await grantFaq("Super Administrator", ["view", "create", "edit", "publish", "archive"]);

  // grantContent/grantBlog/grantResources/grantCareers/grantMedia/grantPricing
  // are additive-only (upsert, never delete) — a prior seed run had already
  // granted Super Administrator `delete` on every one of these modules, and
  // simply omitting "delete" from the lists above does not revoke it. The
  // approved role definition requires Delete to start OFF (disabled) for
  // Super Administrator across the board, so it must be explicitly stripped
  // here rather than left to silently persist from before this rewrite.
  const { count: staleDeleteGrantCount } = await prisma.rolePermission.deleteMany({
    where: {
      roleId: superAdminRoleId,
      permission: { action: "delete", module: { in: ["content", "blog", "resources", "careers", "media", "pricing", "leads"] } },
    },
  });
  if (staleDeleteGrantCount > 0) {
    console.log(`Removed ${staleDeleteGrantCount} stale "delete" grant(s) from Super Administrator (Delete starts OFF by default).`);
  }

  // One-time content migration: the Pricing module replaces System A's
  // previously-hardcoded pricing.ts, and that hardcoded content was
  // already live, already-approved production copy — not a new editorial
  // change needing a fresh Draft→Review cycle. Seeded directly as
  // PUBLISHED (status + publishedAt/publishedByUserId set), matching how
  // a real CMS migration backfills existing live content rather than
  // re-submitting it for review it already effectively had. Idempotent
  // (skipped entirely if any PricingPlan already exists), same guard
  // style as the Super Administrator bootstrap below.
  const existingPricingPlan = await prisma.pricingPlan.findFirst();
  if (existingPricingPlan) {
    console.log("Pricing content already exists — skipping pricing seed.");
  } else {
    const superAdminForSeed = await prisma.adminUser.findFirst({ where: { roles: { some: { roleId: superAdminRoleId } } } });
    const seededByUserId = superAdminForSeed?.id;

    const featureCatalog: { key: string; category: { en: string; ar: string }; feature: { en: string; ar: string }; order: number }[] = [
      { key: "activityLogging", category: { en: "CRM", ar: "إدارة علاقات العملاء" }, feature: { en: "Automated activity logging", ar: "تسجيل نشاط تلقائي" }, order: 0 },
      { key: "aiDealScoring", category: { en: "CRM", ar: "إدارة علاقات العملاء" }, feature: { en: "AI deal scoring", ar: "تصنيف صفقات بالذكاء الاصطناعي" }, order: 1 },
      { key: "customPipelineStages", category: { en: "CRM", ar: "إدارة علاقات العملاء" }, feature: { en: "Custom pipeline stages", ar: "مراحل خط أنابيب مخصّصة" }, order: 2 },
      { key: "automationWorkflows", category: { en: "Marketing", ar: "التسويق" }, feature: { en: "Automation workflows", ar: "مسارات الأتمتة" }, order: 3 },
      { key: "aiLeadScoring", category: { en: "Marketing", ar: "التسويق" }, feature: { en: "AI lead scoring", ar: "تصنيف عملاء محتملين بالذكاء الاصطناعي" }, order: 4 },
      { key: "aiAssistants", category: { en: "AI", ar: "الذكاء الاصطناعي" }, feature: { en: "AI Assistants", ar: "مساعدون ذكيون" }, order: 5 },
      { key: "customAiGrounding", category: { en: "AI", ar: "الذكاء الاصطناعي" }, feature: { en: "Custom AI grounding", ar: "تأصيل مخصّص للذكاء الاصطناعي" }, order: 6 },
      { key: "ssoSaml", category: { en: "Security", ar: "الأمان" }, feature: { en: "Advanced access controls (RBAC/ABAC)", ar: "ضوابط وصول متقدّمة (RBAC/ABAC)" }, order: 7 },
      { key: "auditLogs", category: { en: "Security", ar: "الأمان" }, feature: { en: "Audit logs", ar: "سجلات التدقيق" }, order: 8 },
      { key: "supportLevel", category: { en: "Support", ar: "الدعم" }, feature: { en: "Support level", ar: "مستوى الدعم" }, order: 9 },
    ];

    const featureIdByKey = new Map<string, string>();
    for (const f of featureCatalog) {
      const created = await prisma.pricingFeature.create({
        data: {
          key: f.key,
          order: f.order,
          translations: { en: { category: f.category.en, feature: f.feature.en }, ar: { category: f.category.ar, feature: f.feature.ar } },
        },
      });
      featureIdByKey.set(f.key, created.id);
    }

    // [starter, growth, enterprise] values per feature, matching the
    // exact comparisonMatrix order System A's pricing.ts already shipped.
    const featureValuesByPlan: Record<string, [string, string, string]> = {
      activityLogging: ["true", "true", "true"],
      aiDealScoring: ["false", "true", "true"],
      customPipelineStages: ["1", "Unlimited", "Unlimited"],
      automationWorkflows: ["3", "Unlimited", "Unlimited"],
      aiLeadScoring: ["false", "true", "true"],
      aiAssistants: ["false", "true", "true"],
      customAiGrounding: ["false", "false", "true"],
      ssoSaml: ["false", "false", "true"],
      auditLogs: ["false", "false", "true"],
      supportLevel: ["Community", "Priority", "Dedicated CSM"],
    };

    const plans: {
      slug: string;
      order: number;
      featured: boolean;
      ctaTarget: string;
      monthlyPrice: number | null;
      annualPrice: number | null;
      planIndex: 0 | 1 | 2;
      en: { name: string; description: string; priceSuffix: string; featureList: string[]; ctaLabel: string };
      ar: { name: string; description: string; priceSuffix: string; featureList: string[]; ctaLabel: string };
    }[] = [
      {
        slug: "starter",
        order: 0,
        featured: false,
        ctaTarget: "/trial",
        monthlyPrice: 29,
        annualPrice: 24,
        planIndex: 0,
        en: {
          name: "Starter",
          description: "For small teams getting off spreadsheets.",
          priceSuffix: "/ user / month",
          featureList: ["CRM with automated activity logging", "Up to 3 marketing automation workflows", "Email & calendar sync", "Standard integrations", "Community support"],
          ctaLabel: "Start Free Trial",
        },
        ar: {
          name: "Starter",
          description: "للفرق الصغيرة التي تتخلّى عن جداول البيانات.",
          priceSuffix: "/ للمستخدم / شهريًا",
          featureList: ["إدارة علاقات عملاء مع تسجيل نشاط تلقائي", "حتى 3 مسارات أتمتة تسويقية", "مزامنة البريد الإلكتروني والتقويم", "تكاملات قياسية", "دعم المجتمع"],
          ctaLabel: "ابدأ نسخة تجريبية مجانية",
        },
      },
      {
        slug: "growth",
        order: 1,
        featured: true,
        ctaTarget: "/trial",
        monthlyPrice: 79,
        annualPrice: 64,
        planIndex: 1,
        en: {
          name: "Growth",
          description: "For teams ready to unify sales and marketing.",
          priceSuffix: "/ user / month",
          featureList: ["Everything in Starter", "Unlimited automation workflows", "AI Assistants (drafts, summaries, scoring)", "Lead routing & qualification", "Advanced analytics dashboards", "Priority support"],
          ctaLabel: "Start Free Trial",
        },
        ar: {
          name: "Growth",
          description: "للفرق الجاهزة لتوحيد المبيعات والتسويق.",
          priceSuffix: "/ للمستخدم / شهريًا",
          featureList: ["كل ما في خطة Starter", "مسارات أتمتة غير محدودة", "مساعدون ذكيون (مسودات، ملخصات، تصنيف)", "توجيه وتأهيل العملاء المحتملين", "لوحات تحليلات متقدّمة", "دعم ذو أولوية"],
          ctaLabel: "ابدأ نسخة تجريبية مجانية",
        },
      },
      {
        slug: "enterprise",
        order: 2,
        featured: false,
        ctaTarget: "/enterprise",
        monthlyPrice: null,
        annualPrice: null,
        planIndex: 2,
        en: {
          name: "Enterprise",
          description: "For organizations that need scale, security, and SLAs.",
          priceSuffix: "custom quote",
          featureList: ["Everything in Growth", "Two-factor authentication (TOTP) & advanced access controls", "Audit logs & data residency controls", "Dedicated CSM & onboarding", "Custom SLA"],
          ctaLabel: "Talk to Sales",
        },
        ar: {
          name: "Enterprise",
          description: "للمؤسسات التي تحتاج نطاقًا وأمانًا واتفاقيات مستوى خدمة.",
          priceSuffix: "عرض سعر مخصّص",
          featureList: ["كل ما في خطة Growth", "مصادقة ثنائية (TOTP) وضوابط وصول متقدّمة", "سجلات تدقيق وضوابط إقامة البيانات", "مدير نجاح عملاء مخصّص وتأهيل مرافق", "اتفاقية مستوى خدمة مخصّصة"],
          ctaLabel: "التواصل مع المبيعات",
        },
      },
    ];

    const now = new Date();
    for (const p of plans) {
      const plan = await prisma.pricingPlan.create({
        data: { slug: p.slug, order: p.order, featured: p.featured, visibility: "PUBLIC", status: "PUBLISHED", createdByUserId: seededByUserId },
      });
      const version = await prisma.pricingVersion.create({
        data: {
          pricingPlanId: plan.id,
          versionNumber: 1,
          monthlyPrice: p.monthlyPrice,
          annualPrice: p.annualPrice,
          currency: "USD",
          ctaTarget: p.ctaTarget,
          translations: { en: p.en, ar: p.ar },
          publishedAt: now,
          publishedByUserId: seededByUserId,
          createdByUserId: seededByUserId,
          features: {
            create: Object.entries(featureValuesByPlan).map(([key, values]) => ({
              pricingFeatureId: featureIdByKey.get(key)!,
              value: values[p.planIndex],
            })),
          },
        },
      });
      await prisma.pricingPlan.update({ where: { id: plan.id }, data: { currentVersionId: version.id } });
    }
    console.log("Seeded initial Pricing content (Starter/Growth/Enterprise, EN+AR, Published).");
  }

  // One-time content migration: Blog and Resources replace System A's
  // previously-hardcoded blog.ts/authors.ts/resources.ts, and that content
  // was already live, already-published copy — same reasoning as the
  // Pricing migration above, seeded directly as PUBLISHED rather than
  // routed through Draft→Review. Idempotent (skipped if any BlogPost
  // already exists).
  const existingBlogPost = await prisma.blogPost.findFirst();
  if (existingBlogPost) {
    console.log("Blog content already exists — skipping blog/resources seed.");
  } else {
    const superAdminForBlogSeed = await prisma.adminUser.findFirst({ where: { roles: { some: { roleId: superAdminRoleId } } } });
    const blogSeededByUserId = superAdminForBlogSeed?.id;
    const now = new Date();

    const authorCatalog: { id: string; en: { name: string; role: string; bio: string }; ar: { name: string; role: string; bio: string } }[] = [
      { id: "product-marketing-team", en: { name: "Product Marketing Team", role: "ZynReach Product Marketing", bio: "Writes about platform capabilities, positioning, and what's shipping next." }, ar: { name: "فريق تسويق المنتج", role: "تسويق منتج ZynReach", bio: "يكتب عن إمكانات المنصة والتموضع وما سيُطرح قريبًا." } },
      { id: "revops-editorial", en: { name: "RevOps Editorial", role: "ZynReach Editorial", bio: "Covers sales and marketing operations practices for growing revenue teams." }, ar: { name: "فريق تحرير عمليات الإيرادات", role: "تحرير ZynReach", bio: "يغطي ممارسات عمليات المبيعات والتسويق لفرق الإيرادات المتنامية." } },
      { id: "engineering-team", en: { name: "Engineering Team", role: "ZynReach Engineering", bio: "Writes about how ZynReach is built, including AI architecture and platform design." }, ar: { name: "فريق الهندسة", role: "هندسة ZynReach", bio: "يكتب عن كيفية بناء ZynReach، بما في ذلك بنية الذكاء الاصطناعي وتصميم المنصة." } },
    ];
    const authorIdBySlug = new Map<string, string>();
    for (const a of authorCatalog) {
      const created = await prisma.author.create({ data: { translations: { en: a.en, ar: a.ar } } });
      authorIdBySlug.set(a.id, created.id);
    }

    const categoryCatalog: { slug: string; en: string; ar: string }[] = [
      { slug: "product", en: "Product", ar: "المنتج" },
      { slug: "sales-strategy", en: "Sales Strategy", ar: "استراتيجية المبيعات" },
      { slug: "marketing-ops", en: "Marketing Ops", ar: "عمليات التسويق" },
      { slug: "ai-automation", en: "AI & Automation", ar: "الذكاء الاصطناعي والأتمتة" },
    ];
    const categoryIdBySlug = new Map<string, string>();
    for (const c of categoryCatalog) {
      const created = await prisma.category.create({ data: { slug: c.slug, translations: { en: { name: c.en }, ar: { name: c.ar } } } });
      categoryIdBySlug.set(c.slug, created.id);
    }
    const categorySlugByName: Record<string, string> = { Product: "product", "Sales Strategy": "sales-strategy", "Marketing Ops": "marketing-ops", "AI & Automation": "ai-automation" };

    // System A never shipped an Arabic tag dictionary (only category labels
    // were translated) — ar equals en here, a disclosed gap, not a silent
    // mistranslation, matching the "Starter" brand-name precedent in the
    // Pricing seed.
    const allTags = ["CRM", "Data Quality", "Sales Ops", "SMB", "Lead Generation", "Benchmarks", "Tool Consolidation", "Attribution", "Analytics", "AI", "Product", "Automation", "Workflow", "Product Update"];
    const tagIdByName = new Map<string, string>();
    for (const name of allTags) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const created = await prisma.tag.create({ data: { slug, translations: { en: { name }, ar: { name } } } });
      tagIdByName.set(name, created.id);
    }

    type SeedBlockEn = { type: "paragraph"; text: string } | { type: "heading"; id: string; text: string } | { type: "quote"; text: string } | { type: "list"; items: string[] };
    const posts: { slug: string; category: string; tags: string[]; authorId: string; publishedDate: string; featured?: boolean; relatedSlugs: string[]; en: { title: string; excerpt: string; body: SeedBlockEn[] }; ar: { title: string; excerpt: string; body: SeedBlockEn[] } }[] = [
      { slug: "why-crm-data-goes-stale", category: "Sales Strategy", tags: ["CRM", "Data Quality", "Sales Ops"], authorId: "revops-editorial", publishedDate: "2026-07-28", featured: true, relatedSlugs: ["ai-crm-vs-spreadsheets", "lead-response-time-benchmark"],
        en: { title: "Why CRM data goes stale — and what actually fixes it", excerpt: "Most CRM data isn't wrong because reps are careless. It's wrong because logging it is extra work with no immediate payoff.", body: [
          { type: "paragraph", text: "Ask any sales leader what they'd fix first about their CRM and \"data quality\" comes up almost every time. But the usual response — more mandatory fields, stricter validation, quarterly \"CRM hygiene\" pushes — treats the symptom, not the cause." },
          { type: "heading", id: "the-real-problem", text: "The real problem: logging is a tax on selling" },
          { type: "paragraph", text: "Every manual CRM update is time a rep isn't spending with a prospect. When updating a deal stage requires opening a separate tab, finding the record, and typing a summary, reps do it inconsistently — not because they don't care, but because the system asks them to context-switch away from the thing they're paid to do." },
          { type: "paragraph", text: "The fix isn't more process. It's removing the manual step entirely." },
          { type: "heading", id: "what-actually-works", text: "What actually works" },
          { type: "list", items: ["Automated activity logging from email and calendar, so the record updates itself", "AI-drafted call summaries attached to the deal automatically", "Deal stage suggestions based on real signals, not a dropdown a rep forgets to change"] },
          { type: "paragraph", text: "Teams that make this shift don't just get cleaner data — they get pipeline visibility that reflects what's actually happening, not what got typed in during a Friday afternoon cleanup." },
        ] },
        ar: { title: "لماذا تصبح بيانات إدارة علاقات العملاء قديمة — وما الذي يصلحها فعليًا", excerpt: "معظم بيانات نظام إدارة علاقات العملاء ليست خاطئة بسبب إهمال المندوبين. إنها خاطئة لأن تسجيلها عمل إضافي دون فائدة فورية.", body: [
          { type: "paragraph", text: "اسأل أي قائد مبيعات عمّا سيصلحه أولًا في نظام إدارة علاقات العملاء لديه، وستجد أن «جودة البيانات» تتصدر الإجابة في كل مرة تقريبًا. لكن الاستجابة المعتادة — حقول إلزامية أكثر، تحقق أكثر صرامة، حملات ربع سنوية لـ«نظافة البيانات» — تعالج العرَض لا السبب." },
          { type: "heading", id: "the-real-problem", text: "المشكلة الحقيقية: التسجيل ضريبة على البيع" },
          { type: "paragraph", text: "كل تحديث يدوي في نظام إدارة العملاء هو وقت لا يقضيه المندوب مع عميل محتمل. فعندما يتطلب تحديث مرحلة صفقة فتح تبويب منفصل والبحث عن السجل وكتابة ملخص، يقوم المندوبون بذلك بشكل غير منتظم — ليس لأنهم لا يهتمون، بل لأن النظام يطلب منهم التوقف عن المهمة التي يُدفع لهم أساسًا للقيام بها." },
          { type: "paragraph", text: "الحل ليس مزيدًا من الإجراءات، بل إزالة الخطوة اليدوية بالكامل." },
          { type: "heading", id: "what-actually-works", text: "ما الذي ينجح فعليًا" },
          { type: "list", items: ["تسجيل النشاط تلقائيًا من البريد الإلكتروني والتقويم، بحيث يُحدَّث السجل من تلقاء نفسه", "ملخصات مكالمات تُصاغ بالذكاء الاصطناعي وتُرفق بالصفقة تلقائيًا", "اقتراحات لمرحلة الصفقة استنادًا إلى إشارات حقيقية، لا إلى قائمة منسدلة ينسى المندوب تغييرها"] },
          { type: "paragraph", text: "الفرق التي تقوم بهذا التحول لا تحصل فقط على بيانات أنظف — بل تحصل على رؤية واضحة لخط الأنابيب تعكس ما يحدث فعليًا، لا ما كُتب أثناء تنظيف عشية يوم جمعة." },
        ] } },
      { slug: "ai-crm-vs-spreadsheets", category: "Sales Strategy", tags: ["CRM", "SMB", "Sales Ops"], authorId: "revops-editorial", publishedDate: "2026-07-15", relatedSlugs: ["why-crm-data-goes-stale", "smb-tooling-checklist"],
        en: { title: "AI CRM vs. spreadsheets: what changes when you switch", excerpt: "Spreadsheets are flexible until they aren't. Here's what actually breaks first as a sales team scales past them.", body: [
          { type: "paragraph", text: "Spreadsheets are a genuinely good tool for a two-person sales team. The trouble starts around the fifth or sixth rep, when two people are editing the same tab, formulas break silently, and \"who owns this lead\" becomes a Slack thread instead of a field." },
          { type: "heading", id: "where-it-breaks", text: "Where it breaks first" },
          { type: "paragraph", text: "Ownership conflicts and version drift are usually the first cracks. The second is reporting: a spreadsheet can show you today's pipeline, but reconstructing last month's isn't something most teams bother doing, which makes forecast accuracy nearly impossible to improve." },
          { type: "quote", text: "We didn't switch because the spreadsheet broke. We switched because nobody trusted the numbers in it anymore." },
          { type: "paragraph", text: "That's the real trigger for most teams — not a technical failure, but a trust failure. Once forecast numbers stop matching reality, the spreadsheet stops being useful even if it still technically works." },
        ] },
        ar: { title: "نظام إدارة علاقات العملاء بالذكاء الاصطناعي مقابل جداول البيانات: ماذا يتغيّر عند التبديل", excerpt: "جداول البيانات مرنة إلى أن تتوقف عن ذلك. إليك ما ينهار فعليًا أولًا عندما يتوسع فريق المبيعات ويتجاوزها.", body: [
          { type: "paragraph", text: "جداول البيانات أداة جيدة فعلًا لفريق مبيعات من شخصين. تبدأ المشكلة عند وصول المندوب الخامس أو السادس، حين يعدّل شخصان نفس التبويب، وتنكسر الصيغ بصمت، ويتحول «من يملك هذا العميل المحتمل» إلى محادثة على Slack بدلًا من حقل بيانات." },
          { type: "heading", id: "where-it-breaks", text: "أين تنهار أولًا" },
          { type: "paragraph", text: "تعارضات الملكية وانحراف النسخ عادة ما تكون الشروخ الأولى. أما الثانية فهي التقارير: يمكن لجدول البيانات أن يُظهر خط الأنابيب اليوم، لكن إعادة بناء خط أنابيب الشهر الماضي ليس أمرًا تكلّف معظم الفرق نفسها عناء القيام به، ما يجعل تحسين دقة التوقعات أمرًا شبه مستحيل." },
          { type: "quote", text: "لم ننتقل لأن جدول البيانات تعطّل. انتقلنا لأن لا أحد عاد يثق بالأرقام الموجودة فيه." },
          { type: "paragraph", text: "هذا هو المحفّز الحقيقي لمعظم الفرق — ليس عطلًا تقنيًا، بل أزمة ثقة. فبمجرد أن تتوقف أرقام التوقعات عن مطابقة الواقع، يتوقف جدول البيانات عن أن يكون مفيدًا حتى لو ظلّ يعمل تقنيًا." },
        ] } },
      { slug: "lead-response-time-benchmark", category: "Marketing Ops", tags: ["Lead Generation", "Benchmarks"], authorId: "revops-editorial", publishedDate: "2026-07-08", relatedSlugs: ["why-crm-data-goes-stale", "ai-assistants-explained"],
        en: { title: "What's a good lead response time in 2026?", excerpt: "\"Respond fast\" is common advice. Here's what the actual numbers look like, and why the first five minutes matter more than the next five hours.", body: [
          { type: "paragraph", text: "Lead response time gets cited constantly, but the benchmark itself is often misquoted. The consistent finding across response-time research: conversion likelihood drops sharply after the first five minutes, then drops again after the first hour." },
          { type: "heading", id: "why-five-minutes", text: "Why five minutes, specifically" },
          { type: "paragraph", text: "It's not magic — it's attention. A visitor who just filled out a form is still on your site, still thinking about the problem they came to solve. An hour later, they've moved on to three other tabs and two other vendors." },
          { type: "heading", id: "what-slows-teams-down", text: "What actually slows teams down" },
          { type: "list", items: ["Manual lead qualification before routing", "Leads sitting in a shared inbox instead of being assigned automatically", "No clear ownership rule for territory or company size"] },
          { type: "paragraph", text: "None of these are people problems — they're routing problems. Automating qualification and assignment is usually the single highest-leverage fix." },
        ] },
        ar: { title: "ما هو وقت الاستجابة الجيد للعملاء المحتملين في 2026؟", excerpt: "«استجب بسرعة» نصيحة شائعة. إليك كيف تبدو الأرقام الفعلية، ولماذا الدقائق الخمس الأولى أهم من الساعات الخمس التالية.", body: [
          { type: "paragraph", text: "يُستشهد بوقت استجابة العملاء المحتملين باستمرار، لكن المعيار نفسه غالبًا ما يُقتبس بشكل غير دقيق. النتيجة الثابتة عبر أبحاث وقت الاستجابة: احتمالية التحويل تنخفض بشكل حاد بعد الدقائق الخمس الأولى، ثم تنخفض مجددًا بعد الساعة الأولى." },
          { type: "heading", id: "why-five-minutes", text: "لماذا خمس دقائق تحديدًا" },
          { type: "paragraph", text: "الأمر ليس سحرًا — إنه انتباه. الزائر الذي ملأ نموذجًا للتو لا يزال على موقعك، ولا يزال يفكر في المشكلة التي جاء ليحلّها. بعد ساعة، يكون قد انتقل إلى ثلاثة تبويبات أخرى ومزوَّدين آخرَين." },
          { type: "heading", id: "what-slows-teams-down", text: "ما الذي يبطئ الفرق فعليًا" },
          { type: "list", items: ["التأهيل اليدوي للعملاء المحتملين قبل التوجيه", "بقاء العملاء المحتملين في صندوق وارد مشترك بدلًا من تعيينهم تلقائيًا", "غياب قاعدة واضحة لملكية المنطقة أو حجم الشركة"] },
          { type: "paragraph", text: "لا شيء من هذا مشكلة بشرية — إنها مشكلة توجيه. أتمتة التأهيل والتعيين عادة ما تكون الإصلاح الأعلى تأثيرًا." },
        ] } },
      { slug: "smb-tooling-checklist", category: "Sales Strategy", tags: ["SMB", "Tool Consolidation"], authorId: "product-marketing-team", publishedDate: "2026-06-30", relatedSlugs: ["ai-crm-vs-spreadsheets", "marketing-attribution-explained"],
        en: { title: "The 5-tool checklist every growing SMB outgrows", excerpt: "Spreadsheet CRM, separate email tool, separate forms, separate analytics, separate automation — here's when each one starts costing more than it saves.", body: [
          { type: "paragraph", text: "Most SMBs don't set out to run five disconnected tools. It happens gradually: a spreadsheet for leads, an email tool for campaigns, a forms plugin for the website, a separate analytics dashboard, and eventually a Zapier chain trying to hold it all together." },
          { type: "heading", id: "the-tell", text: "The tell that it's time to consolidate" },
          { type: "paragraph", text: "The clearest signal isn't cost — it's the moment someone asks \"how many leads did we get from last week's campaign\" and the honest answer requires checking three different tools and reconciling them by hand." },
          { type: "paragraph", text: "At that point, the integration tax (time spent connecting and reconciling tools) usually exceeds what a unified platform would cost outright." },
        ] },
        ar: { title: "قائمة الأدوات الخمس التي تتجاوزها كل شركة صغيرة ومتوسطة نامية", excerpt: "جدول بيانات كنظام إدارة عملاء، أداة بريد إلكتروني منفصلة، نماذج منفصلة، تحليلات منفصلة، أتمتة منفصلة — إليك متى تبدأ كل واحدة بتكليف أكثر مما توفّر.", body: [
          { type: "paragraph", text: "لا تخطط معظم الشركات الصغيرة والمتوسطة لتشغيل خمس أدوات منفصلة. يحدث ذلك تدريجيًا: جدول بيانات للعملاء المحتملين، أداة بريد إلكتروني للحملات، إضافة نماذج للموقع، لوحة تحليلات منفصلة، وفي النهاية سلسلة Zapier تحاول ربط كل ذلك." },
          { type: "heading", id: "the-tell", text: "العلامة على أن الوقت حان للتوحيد" },
          { type: "paragraph", text: "الإشارة الأوضح ليست التكلفة — بل اللحظة التي يسأل فيها أحدهم «كم عدد العملاء المحتملين الذين حصلنا عليهم من حملة الأسبوع الماضي» وتتطلب الإجابة الصادقة فحص ثلاث أدوات مختلفة وتوفيقها يدويًا." },
          { type: "paragraph", text: "عند تلك النقطة، عادة ما تتجاوز «ضريبة التكامل» (الوقت المُنفق في ربط الأدوات وتوفيقها) ما كانت ستكلّفه منصة موحّدة مباشرة." },
        ] } },
      { slug: "marketing-attribution-explained", category: "Marketing Ops", tags: ["Attribution", "Analytics"], authorId: "product-marketing-team", publishedDate: "2026-06-20", relatedSlugs: ["smb-tooling-checklist", "lead-response-time-benchmark"],
        en: { title: "Marketing attribution, explained without the jargon", excerpt: "First-touch, last-touch, multi-touch — the terminology is confusing, but the underlying question is simple: what actually drove this deal?", body: [
          { type: "paragraph", text: "Attribution models exist to answer one question: when a deal closes, which marketing touches deserve credit? The honest answer is usually \"several of them,\" which is why single-touch models (first-touch, last-touch) tend to mislead more than they help." },
          { type: "heading", id: "why-multi-touch", text: "Why multi-touch models tend to win" },
          { type: "paragraph", text: "A prospect might read a blog post, ignore three emails, attend a webinar, and finally convert after a demo. Crediting only the demo (last-touch) makes top-of-funnel content look worthless — even though it's what got the prospect there in the first place." },
          { type: "paragraph", text: "The practical requirement for multi-touch attribution isn't a fancier model — it's a single data model where marketing touches and CRM deal data actually live together, instead of being reconciled after the fact." },
        ] },
        ar: { title: "إسناد التسويق، بشرح مبسّط دون مصطلحات معقّدة", excerpt: "اللمسة الأولى، اللمسة الأخيرة، متعددة اللمسات — المصطلحات مربكة، لكن السؤال الأساسي بسيط: ما الذي دفع هذه الصفقة فعليًا؟", body: [
          { type: "paragraph", text: "توجد نماذج الإسناد للإجابة عن سؤال واحد: عند إغلاق صفقة، أي لمسات تسويقية تستحق الفضل؟ الإجابة الصادقة عادة ما تكون «عدة لمسات»، وهذا سبب ميل النماذج أحادية اللمسة (اللمسة الأولى، اللمسة الأخيرة) إلى التضليل أكثر مما تساعد." },
          { type: "heading", id: "why-multi-touch", text: "لماذا تميل نماذج اللمسات المتعددة إلى الفوز" },
          { type: "paragraph", text: "قد يقرأ عميل محتمل منشور مدونة، ويتجاهل ثلاث رسائل بريدية، ويحضر ندوة عبر الإنترنت، ثم يتحول أخيرًا بعد عرض توضيحي. منح الفضل للعرض التوضيحي وحده (اللمسة الأخيرة) يجعل محتوى أعلى القمع يبدو عديم القيمة — رغم أنه ما أوصل العميل المحتمل إلى هناك أساسًا." },
          { type: "paragraph", text: "المتطلب العملي للإسناد متعدد اللمسات ليس نموذجًا أكثر تطورًا — بل نموذج بيانات واحد تتعايش فيه اللمسات التسويقية وبيانات صفقات إدارة العملاء فعليًا، بدلًا من توفيقها لاحقًا." },
        ] } },
      { slug: "ai-assistants-explained", category: "AI & Automation", tags: ["AI", "Product"], authorId: "engineering-team", publishedDate: "2026-06-10", featured: true, relatedSlugs: ["why-crm-data-goes-stale", "lead-response-time-benchmark"],
        en: { title: "What \"AI Assistants embedded in your CRM\" actually means", excerpt: "Not a chatbot bolted onto the sidebar. Here's what it looks like when AI is grounded in your actual pipeline data.", body: [
          { type: "paragraph", text: "\"AI-powered\" has become a label nearly every SaaS product claims, which makes it worth being specific about what it actually means in a CRM context." },
          { type: "heading", id: "grounded-vs-generic", text: "Grounded vs. generic" },
          { type: "paragraph", text: "A generic AI assistant answers questions using general knowledge. A grounded assistant answers using your actual deal history, your actual email threads, and your actual pipeline data — which is the difference between a plausible-sounding follow-up email and one that references the right proposal, the right objection, and the right next step." },
          { type: "heading", id: "where-it-fits", text: "Where it fits in the workflow" },
          { type: "list", items: ["Drafting follow-up emails from real call and email context", "Summarizing calls automatically into the CRM record", "Flagging deals with declining engagement before they go cold"] },
          { type: "paragraph", text: "The common thread: the AI works inside the tools reps already use, on data that's already there — not as a separate destination they have to remember to check." },
        ] },
        ar: { title: "ماذا يعني فعليًا «مساعدو الذكاء الاصطناعي المدمجون في نظام إدارة علاقات العملاء»", excerpt: "ليس روبوت محادثة مُلحقًا بالشريط الجانبي. إليك كيف يبدو الأمر عندما يكون الذكاء الاصطناعي مبنيًا على بيانات خط الأنابيب الفعلية لديك.", body: [
          { type: "paragraph", text: "أصبحت عبارة «مدعوم بالذكاء الاصطناعي» تصنيفًا يدّعيه كل منتج SaaS تقريبًا، ما يجعل من المفيد التحديد بدقة ما تعنيه فعليًا في سياق إدارة علاقات العملاء." },
          { type: "heading", id: "grounded-vs-generic", text: "المبني على بيانات مقابل العام" },
          { type: "paragraph", text: "يجيب المساعد العام باستخدام معرفة عامة. أما المساعد المبني على بيانات فيجيب باستخدام سجل صفقاتك الفعلي، ومحادثات بريدك الفعلية، وبيانات خط أنابيبك الفعلية — وهذا هو الفرق بين بريد متابعة يبدو معقولًا وآخر يشير إلى العرض الصحيح والاعتراض الصحيح والخطوة التالية الصحيحة." },
          { type: "heading", id: "where-it-fits", text: "أين يندمج في سير العمل" },
          { type: "list", items: ["صياغة رسائل متابعة من سياق مكالمات وبريد إلكتروني حقيقي", "تلخيص المكالمات تلقائيًا في سجل إدارة العملاء", "تنبيه الصفقات ذات التفاعل المتراجع قبل أن تبرد"] },
          { type: "paragraph", text: "القاسم المشترك: يعمل الذكاء الاصطناعي داخل الأدوات التي يستخدمها المندوبون أصلًا، على بيانات موجودة أصلًا — وليس كوجهة منفصلة عليهم تذكّر مراجعتها." },
        ] } },
      { slug: "no-code-workflow-patterns", category: "AI & Automation", tags: ["Automation", "Workflow"], authorId: "engineering-team", publishedDate: "2026-05-28", relatedSlugs: ["ai-assistants-explained", "smb-tooling-checklist"],
        en: { title: "Five no-code workflow patterns worth stealing", excerpt: "Practical automation patterns that connect CRM, marketing, and support without a single engineering ticket.", body: [
          { type: "paragraph", text: "The best workflow automations aren't clever — they're the boring hand-offs that used to require someone remembering to do them manually." },
          { type: "list", items: ["Auto-create an onboarding task list the moment a deal closes", "Route a support ticket to sales when a churn-risk keyword appears", "Trigger a re-engagement campaign after 30 days of no activity", "Escalate a deal for approval when a discount exceeds a threshold", "Notify a CSM automatically when usage drops below a baseline"] },
          { type: "paragraph", text: "None of these require custom code — they require a trigger, a condition, and an action, chained together once and left to run." },
        ] },
        ar: { title: "خمسة أنماط سير عمل بلا برمجة تستحق التبني", excerpt: "أنماط أتمتة عملية تربط إدارة علاقات العملاء والتسويق والدعم دون تذكرة هندسية واحدة.", body: [
          { type: "paragraph", text: "أفضل أتمتة سير العمل ليست معقّدة — إنها المهام الروتينية المملة التي كانت تتطلب سابقًا أن يتذكر أحدهم القيام بها يدويًا." },
          { type: "list", items: ["إنشاء قائمة مهام تأهيل تلقائيًا لحظة إغلاق الصفقة", "توجيه تذكرة دعم إلى المبيعات عند ظهور كلمة مفتاحية تشير لخطر فقدان العميل", "تشغيل حملة إعادة تفاعل بعد 30 يومًا من عدم النشاط", "تصعيد صفقة للموافقة عند تجاوز خصم لحد معيّن", "إشعار مدير نجاح العملاء تلقائيًا عند انخفاض الاستخدام عن خط الأساس"] },
          { type: "paragraph", text: "لا يتطلب أي من هذا برمجة مخصصة — بل يتطلب مُحفّزًا وشرطًا وإجراءً، مرتبطين معًا مرة واحدة ومتروكين ليعملا." },
        ] } },
      { slug: "product-update-ai-assistants-ga", category: "Product", tags: ["Product Update", "AI"], authorId: "product-marketing-team", publishedDate: "2026-05-15", relatedSlugs: ["ai-assistants-explained"],
        en: { title: "Product update: AI Assistants is now generally available", excerpt: "AI Assistants moves from early access to general availability, with drafting, summarization, and deal-risk flagging available on the Growth plan.", body: [
          { type: "paragraph", text: "AI Assistants is now generally available on the Growth and Enterprise plans, following several months of early access with a limited set of customers." },
          { type: "heading", id: "whats-included", text: "What's included at GA" },
          { type: "list", items: ["AI-drafted follow-up emails grounded in deal context", "Automatic call and meeting summarization", "Deal-risk flagging based on engagement signals"] },
          { type: "paragraph", text: "See the full breakdown on the AI Assistants capability page, or check the Changelog for the complete release history." },
        ] },
        ar: { title: "تحديث المنتج: مساعدو الذكاء الاصطناعي متاحون الآن للجميع", excerpt: "ينتقل مساعدو الذكاء الاصطناعي من الوصول المبكر إلى الإتاحة العامة، مع إمكانيات الصياغة والتلخيص وتنبيه مخاطر الصفقات المتاحة في خطة Growth.", body: [
          { type: "paragraph", text: "أصبح مساعدو الذكاء الاصطناعي متاحين الآن بشكل عام في خطتَي Growth وEnterprise، بعد عدة أشهر من الوصول المبكر مع مجموعة محدودة من العملاء." },
          { type: "heading", id: "whats-included", text: "ما المُتضمَّن عند الإتاحة العامة" },
          { type: "list", items: ["رسائل متابعة تُصاغ بالذكاء الاصطناعي ومبنية على سياق الصفقة", "تلخيص تلقائي للمكالمات والاجتماعات", "تنبيه لمخاطر الصفقات استنادًا إلى إشارات التفاعل"] },
          { type: "paragraph", text: "طالع التفصيل الكامل في صفحة إمكانية مساعدي الذكاء الاصطناعي، أو راجع سجل التغييرات لتاريخ الإصدارات الكامل." },
        ] } },
    ];

    for (const p of posts) {
      const post = await prisma.blogPost.create({
        data: { slug: p.slug, authorId: authorIdBySlug.get(p.authorId), featured: p.featured ?? false, status: "PUBLISHED", createdByUserId: blogSeededByUserId },
      });
      const version = await prisma.blogPostVersion.create({
        data: {
          blogPostId: post.id,
          versionNumber: 1,
          publishedDate: new Date(p.publishedDate),
          relatedPostSlugs: p.relatedSlugs,
          translations: { en: p.en, ar: p.ar },
          publishedAt: now,
          publishedByUserId: blogSeededByUserId,
          createdByUserId: blogSeededByUserId,
          categories: { create: [{ categoryId: categoryIdBySlug.get(categorySlugByName[p.category])! }] },
          tags: { create: p.tags.map((t) => ({ tagId: tagIdByName.get(t)! })) },
        },
      });
      await prisma.blogPost.update({ where: { id: post.id }, data: { currentVersionId: version.id } });
    }
    console.log("Seeded initial Blog content (8 posts, 3 authors, 4 categories, EN+AR, Published).");

    const guides: { slug: string; format: "GUIDE" | "TEMPLATE" | "WHITEPAPER"; en: { title: string; description: string }; ar: { title: string; description: string } }[] = [
      { slug: "crm-migration-checklist", format: "TEMPLATE", en: { title: "CRM Migration Checklist", description: "A step-by-step checklist for migrating off spreadsheets or a legacy CRM without losing data." }, ar: { title: "قائمة تحقق ترحيل نظام إدارة العملاء", description: "قائمة تحقق تفصيلية للترحيل من جداول البيانات أو نظام إدارة عملاء قديم دون فقدان البيانات." } },
      { slug: "lead-scoring-playbook", format: "GUIDE", en: { title: "Lead Scoring Playbook", description: "A practical framework for building a lead scoring model your sales team will actually trust." }, ar: { title: "دليل تسجيل نقاط العملاء المحتملين", description: "إطار عملي لبناء نموذج تسجيل نقاط للعملاء المحتملين سيثق به فريق مبيعاتك فعليًا." } },
      { slug: "revops-maturity-whitepaper", format: "WHITEPAPER", en: { title: "The RevOps Maturity Model", description: "A whitepaper on the four stages of revenue operations maturity, and how to know which one you're in." }, ar: { title: "نموذج نضج عمليات الإيرادات", description: "ورقة بيضاء حول المراحل الأربع لنضج عمليات الإيرادات، وكيفية معرفة أي مرحلة أنت فيها." } },
      { slug: "onboarding-email-templates", format: "TEMPLATE", en: { title: "Onboarding Email Templates", description: "Five ready-to-use email templates for customer onboarding sequences." }, ar: { title: "قوالب بريد إلكتروني للتأهيل", description: "خمسة قوالب بريد إلكتروني جاهزة للاستخدام في تسلسلات تأهيل العملاء." } },
    ];
    for (const g of guides) {
      const resource = await prisma.resource.create({ data: { slug: g.slug, resourceFormat: g.format, gated: true, status: "PUBLISHED", createdByUserId: blogSeededByUserId } });
      const version = await prisma.resourceVersion.create({ data: { resourceId: resource.id, versionNumber: 1, translations: { en: g.en, ar: g.ar }, publishedAt: now, publishedByUserId: blogSeededByUserId, createdByUserId: blogSeededByUserId } });
      await prisma.resource.update({ where: { id: resource.id }, data: { currentVersionId: version.id } });
    }

    // Webinar moved to its own model (see schema.prisma's Webinar/
    // WebinarVersion comment) — historic speaker string now maps to
    // speakerName, with speakerTitle/speakerCompany left blank (System A
    // never had structured fields for those either), same mapping used by
    // scripts/migrate-webinars-to-webinar-model.ts for the live data.
    const webinars: { slug: string; date: string; en: { title: string; description: string; speaker: string }; ar: { title: string; description: string; speaker: string } }[] = [
      { slug: "ai-assistants-deep-dive", date: "2026-06-18", en: { title: "AI Assistants: A Deep Dive", description: "A walkthrough of how AI Assistants draft, summarize, and score inside your existing CRM workflow.", speaker: "ZynReach Product Team" }, ar: { title: "مساعدو الذكاء الاصطناعي: استعراض معمّق", description: "استعراض لكيفية صياغة مساعدي الذكاء الاصطناعي وتلخيصهم وتقييمهم داخل سير عمل نظام إدارة العملاء لديك.", speaker: "فريق منتج ZynReach" } },
      { slug: "scaling-revops-panel", date: "2026-05-22", en: { title: "Scaling RevOps Without Adding Headcount", description: "A panel discussion on automation patterns that let lean RevOps teams support fast-growing sales orgs.", speaker: "ZynReach & Customer Panel" }, ar: { title: "توسيع عمليات الإيرادات دون زيادة عدد الموظفين", description: "حلقة نقاش حول أنماط الأتمتة التي تتيح لفرق عمليات الإيرادات المصغّرة دعم مؤسسات مبيعات سريعة النمو.", speaker: "ZynReach ولجنة عملاء" } },
    ];
    for (const w of webinars) {
      const webinar = await prisma.webinar.create({ data: { slug: w.slug, gated: true, status: "PUBLISHED", createdByUserId: blogSeededByUserId } });
      const version = await prisma.webinarVersion.create({
        data: {
          webinarId: webinar.id,
          versionNumber: 1,
          scheduledAt: new Date(w.date),
          isOnDemand: true,
          translations: {
            en: { title: w.en.title, description: w.en.description, speakerName: w.en.speaker, speakerTitle: "", speakerCompany: "" },
            ar: { title: w.ar.title, description: w.ar.description, speakerName: w.ar.speaker, speakerTitle: "", speakerCompany: "" },
          },
          publishedAt: now,
          publishedByUserId: blogSeededByUserId,
          createdByUserId: blogSeededByUserId,
        },
      });
      await prisma.webinar.update({ where: { id: webinar.id }, data: { currentVersionId: version.id } });
    }
    console.log("Seeded initial Resources content (4 guides, 2 webinars, EN+AR, Published).");
  }

  // One-time content migration: Careers replaces System A's previously-
  // hardcoded careers.ts job listings — already-live, already-published
  // copy, seeded directly as PUBLISHED (same reasoning as the Pricing/Blog
  // migrations above). Idempotent (skipped if any JobListing already exists).
  const existingJobListing = await prisma.jobListing.findFirst();
  if (existingJobListing) {
    console.log("Careers content already exists — skipping careers seed.");
  } else {
    const superAdminForCareersSeed = await prisma.adminUser.findFirst({ where: { roles: { some: { roleId: superAdminRoleId } } } });
    const careersSeededByUserId = superAdminForCareersSeed?.id;
    const careersNow = new Date();

    const enJobs = careersEnMessages.careersPage.jobs as Record<
      string,
      { title: string; team: string; location: string; employmentType: string; description: string; responsibilities: string[]; qualifications: string[]; preferredSkills: string[] }
    >;
    const arJobs = careersArMessages.careersPage.jobs as typeof enJobs;

    for (const raw of careersJobListings) {
      const en = enJobs[raw.id];
      const ar = arJobs[raw.id];
      const listing = await prisma.jobListing.create({
        data: { slug: raw.id, status: "PUBLISHED", createdByUserId: careersSeededByUserId },
      });
      const version = await prisma.jobListingVersion.create({
        data: {
          jobListingId: listing.id,
          versionNumber: 1,
          datePosted: new Date(raw.datePosted),
          translations: { en, ar },
          publishedAt: careersNow,
          publishedByUserId: careersSeededByUserId,
          createdByUserId: careersSeededByUserId,
        },
      });
      await prisma.jobListing.update({ where: { id: listing.id }, data: { currentVersionId: version.id } });
    }
    console.log(`Seeded initial Careers content (${careersJobListings.length} job listings, EN+AR, Published).`);
  }

  // One-time content migration: the FAQ module replaces System A's
  // previously-hardcoded messages/*.json faqPage.items content — that
  // content was already live, already-approved production copy, so it's
  // seeded directly as PUBLISHED, same reasoning/idempotency guard as the
  // Pricing migration above. The stale "SSO and SAML-based authentication"
  // claim in the original Security-category answer is corrected here to
  // match the real auth mechanism (email/password + TOTP 2FA), the same
  // fix already applied to the Trust Center page and this same FAQ answer
  // in messages/en.json/ar.json.
  const existingFaqItem = await prisma.faqItem.findFirst();
  if (existingFaqItem) {
    console.log("FAQ content already exists — skipping FAQ seed.");
  } else {
    const faqSuperAdmin = await prisma.adminUser.findFirst({ where: { roles: { some: { roleId: superAdminRoleId } } } });
    const faqSeededByUserId = faqSuperAdmin?.id;

    const faqSeedData: { category: string; order: number; en: { question: string; answer: string }; ar: { question: string; answer: string } }[] = [
      {
        category: "Product",
        order: 0,
        en: { question: "What's included in the free trial?", answer: "The free trial includes full access to Starter-plan features for 14 days, no credit card required." },
        ar: { question: "ماذا تتضمّن النسخة التجريبية المجانية؟", answer: "تتضمّن النسخة التجريبية المجانية وصولًا كاملًا لميزات خطة Starter لمدة 14 يومًا، دون الحاجة لبطاقة ائتمان." },
      },
      {
        category: "Product",
        order: 1,
        en: { question: "Can I import data from my current CRM?", answer: "Yes — CSV import is available on every plan, and guided migration assistance is included with Enterprise." },
        ar: { question: "هل يمكنني استيراد بيانات من نظام إدارة العملاء الحالي؟", answer: "نعم — استيراد CSV متاح في كل خطة، وتتضمّن خطة Enterprise مساعدة ترحيل موجَّهة." },
      },
      {
        category: "Product",
        order: 2,
        en: { question: "Does ZynReach work on mobile?", answer: "Yes, the ZynReach application is fully responsive and works in any modern mobile browser." },
        ar: { question: "هل تعمل ZynReach على الجوال؟", answer: "نعم، تطبيق ZynReach متجاوب بالكامل ويعمل في أي متصفح جوال حديث." },
      },
      {
        category: "Pricing",
        order: 0,
        en: { question: "Can I switch plans later?", answer: "Yes — you can upgrade or downgrade at any time from account settings." },
        ar: { question: "هل يمكنني تغيير الخطة لاحقًا؟", answer: "نعم — يمكنك الترقية أو خفض الخطة في أي وقت من إعدادات الحساب." },
      },
      {
        category: "Pricing",
        order: 1,
        en: { question: "Is there a discount for annual billing?", answer: "Yes, annual billing saves approximately 20% compared to monthly billing." },
        ar: { question: "هل يوجد خصم للفوترة السنوية؟", answer: "نعم، توفّر الفوترة السنوية حوالي 20% مقارنة بالفوترة الشهرية." },
      },
      {
        category: "Pricing",
        order: 2,
        en: { question: "Do you offer nonprofit or startup discounts?", answer: "Yes — contact sales with proof of eligibility and we'll apply the appropriate discount." },
        ar: { question: "هل تقدّمون خصومات للجمعيات غير الربحية أو الشركات الناشئة؟", answer: "نعم — تواصل مع فريق المبيعات مع إثبات الأهلية وسنطبّق الخصم المناسب." },
      },
      {
        category: "Security",
        order: 0,
        en: { question: "Is ZynReach SOC 2 certified?", answer: "Yes, ZynReach maintains SOC 2 Type II certification. See our Security page for details." },
        ar: { question: "هل ZynReach معتمَدة وفق SOC 2؟", answer: "نعم، تحتفظ ZynReach باعتماد SOC 2 Type II. راجع صفحة الأمان لدينا للتفاصيل." },
      },
      {
        category: "Security",
        order: 1,
        en: { question: "Where is my data hosted?", answer: "Customer data is hosted in United States-based data centers by default; region-specific residency is available on Enterprise." },
        ar: { question: "أين تُستضاف بياناتي؟", answer: "تُستضاف بيانات العملاء افتراضيًا في مراكز بيانات داخل الولايات المتحدة؛ وتتوفر إقامة بيانات خاصة بمنطقة معينة في خطة Enterprise." },
      },
      {
        category: "Security",
        order: 2,
        en: { question: "Do you support SSO?", answer: "ZynReach uses email and password authentication with two-factor authentication (TOTP) required for administrator and Enterprise accounts, plus role-based and attribute-based access controls — see our Security page for details." },
        ar: { question: "هل تدعمون تسجيل الدخول الموحّد (SSO)؟", answer: "تستخدم ZynReach المصادقة عبر البريد الإلكتروني وكلمة المرور مع المصادقة الثنائية (TOTP) المطلوبة لحسابات المسؤولين وخطة Enterprise، إضافة إلى ضوابط وصول قائمة على الأدوار والسمات — راجع صفحة الأمان لدينا للتفاصيل." },
      },
      {
        category: "Support",
        order: 0,
        en: { question: "What support is included on each plan?", answer: "Starter includes community support, Growth includes priority support, and Enterprise includes a dedicated CSM." },
        ar: { question: "ما الدعم المتضمَّن في كل خطة؟", answer: "تتضمّن خطة Starter دعم المجتمع، وGrowth دعمًا ذا أولوية، وEnterprise مدير نجاح عملاء مخصّصًا." },
      },
      {
        category: "Support",
        order: 1,
        en: { question: "What are your support hours?", answer: "Priority and Enterprise support is available Monday–Friday, 6am–8pm ET, with 24/7 coverage for critical incidents." },
        ar: { question: "ما ساعات الدعم لديكم؟", answer: "يتوفر الدعم ذو الأولوية ودعم Enterprise من الاثنين إلى الجمعة، 6 صباحًا حتى 8 مساءً بتوقيت شرق أمريكا، مع تغطية على مدار الساعة للحوادث الحرجة." },
      },
    ];

    for (const entry of faqSeedData) {
      await prisma.faqItem.create({
        data: {
          category: entry.category,
          order: entry.order,
          status: "PUBLISHED",
          translations: { en: entry.en, ar: entry.ar },
          createdByUserId: faqSeededByUserId,
        },
      });
    }
    console.log(`Seeded initial FAQ content (${faqSeedData.length} items across 4 categories, EN+AR, Published).`);
  }

  // ZynReach Marketplace — module:action permissions, same faqActions/
  // grantFaq shape. Only two actions: this module never has a
  // Draft->Review->Publish workflow (see the model comment), it's a
  // flat view/manage split like Redirects.
  const marketplaceActions = ["view", "manage"] as const;
  const marketplacePermissions = new Map<string, { id: string }>();
  for (const action of marketplaceActions) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: "marketplace", action } },
      update: {},
      create: { module: "marketplace", action },
    });
    marketplacePermissions.set(action, permission);
  }
  async function grantMarketplace(roleName: string, actions: (typeof marketplaceActions)[number][]) {
    const roleId = roleIdByName.get(roleName)!;
    for (const action of actions) {
      const permission = marketplacePermissions.get(action)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }
  await grantMarketplace("Content Editor", ["view"]);
  await grantMarketplace("Super Administrator", ["view", "manage"]);

  // One row per real tool slug already defined in zynreach-website's
  // capabilities.ts (src/lib/content/capabilities.ts) — the Marketplace
  // Suite/Tool Catalog is these same ~30 capabilities, admin-curated for
  // visibility/featured/plan-gating rather than a separate content type.
  // Idempotent (skipped if any row already exists), same guard style as
  // the Pricing seed above.
  const existingMarketplaceListing = await prisma.marketplaceListing.findFirst();
  if (existingMarketplaceListing) {
    console.log("Marketplace listings already exist — skipping marketplace seed.");
  } else {
    const marketplaceToolSlugs = [
      "ai-assistants",
      "crm",
      "marketing-automation",
      "lead-generation",
      "workflow-automation",
      "analytics",
      "sales-pipeline",
      "campaigns",
      "contact-360",
      "business-data",
      "ai-workspace",
      "ai-agents",
      "ai-insights",
      "automation-center",
      "reports",
      "business-intelligence",
      "executive-dashboards",
      "scheduled-reports",
      "project-management",
      "task-management",
      "hr-management",
      "attendance-leave",
      "teams-departments",
      "finance-accounting",
      "document-center",
      "customer-portal",
      "subscription-billing",
      "notifications",
      "marketplace",
      "plugin-sdk",
      "organization-management",
      "branch-management",
      "audit",
    ];
    for (const [index, toolSlug] of marketplaceToolSlugs.entries()) {
      await prisma.marketplaceListing.create({
        data: { toolSlug, order: index, visible: true, featured: false, minPlanTier: "STARTER" },
      });
    }
    console.log(`Seeded ${marketplaceToolSlugs.length} Marketplace listings.`);
  }

  const existingSuperAdmin = await prisma.adminUser.findFirst({
    where: { roles: { some: { roleId: superAdminRoleId } } },
  });

  if (existingSuperAdmin) {
    console.log(`A Super Administrator account already exists (${existingSuperAdmin.email}) — skipping user creation.`);
  } else {
    const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? "admin@zynreach.local";
    const generatedPassword = randomBytes(12).toString("base64url");
    const passwordHash = await hashPassword(generatedPassword);

    const user = await prisma.adminUser.create({
      data: {
        name: "Super Administrator",
        email,
        passwordHash,
        status: "ACTIVE",
      },
    });

    await prisma.adminUserRole.create({
      data: { adminUserId: user.id, roleId: superAdminRoleId },
    });

    console.log("");
    console.log("=".repeat(72));
    console.log("Initial Super Administrator account created:");
    console.log(`  email:    ${email}`);
    console.log(`  password: ${generatedPassword}`);
    console.log("This password is shown once and is not stored anywhere in plaintext.");
    console.log("MFA enrollment will be required on first sensitive-role login.");
    console.log("=".repeat(72));
    console.log("");
  }

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
