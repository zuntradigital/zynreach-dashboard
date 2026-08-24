import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { updateSettingsGroupSchema } from "@/lib/validation";
import { isValidSettingsGroup } from "@/lib/settings-groups";

/**
 * M8 Global Website Settings (SRS §22, FR-ADM-019, SCR-039–041/043,
 * §29's `GET/PATCH /api/admin/settings/{group} — Session +
 * Settings:View/ManageSettings`). One settings:manage permission covers
 * both verbs in Phase 1's still-module-level permission catalog — see
 * prisma/seed.ts's comment on this simplification.
 */
export async function GET(request: Request, context: { params: Promise<{ group: string }> }) {
  const auth = await requirePermission(request, "settings", "manage");
  if (!auth.ok) return auth.response;

  const { group } = await context.params;
  if (!isValidSettingsGroup(group)) {
    return NextResponse.json({ error: "Unknown settings group." }, { status: 404 });
  }

  const rows = await prisma.siteSetting.findMany({ where: { group } });
  const values: Record<string, unknown> = {};
  let updatedAt: Date | null = null;
  for (const row of rows) {
    values[row.key] = row.value;
    if (!updatedAt || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
  }

  return NextResponse.json({ group, values, updatedAt });
}

export async function PATCH(request: Request, context: { params: Promise<{ group: string }> }) {
  const auth = await requirePermission(request, "settings", "manage");
  if (!auth.ok) return auth.response;

  const { group } = await context.params;
  if (!isValidSettingsGroup(group)) {
    return NextResponse.json({ error: "Unknown settings group." }, { status: 404 });
  }

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = updateSettingsGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings values." }, { status: 400 });
  }
  const { values } = parsed.data;

  // SRS §22: Maintenance Mode is "restricted to Super Administrator/
  // Website Administrator given the blast radius; Audit Logged with
  // mandatory reason field" — enforced here, not just as a client hint,
  // since the API is the real authorization/validation boundary (§31).
  if (group === "maintenanceMode" && values.enabled === true) {
    const reason = values.reason;
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "A reason is required to enable maintenance mode." }, { status: 400 });
    }
  }

  const existingRows = await prisma.siteSetting.findMany({ where: { group } });
  const before: Record<string, unknown> = {};
  for (const row of existingRows) before[row.key] = row.value;

  await prisma.$transaction(
    Object.entries(values).map(([key, value]) => {
      const jsonValue: Prisma.InputJsonValue | Prisma.JsonNullValueInput =
        value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
      return prisma.siteSetting.upsert({
        where: { group_key: { group, key } },
        update: { value: jsonValue, updatedByUserId: auth.context.adminUser.id },
        create: { group, key, value: jsonValue, updatedByUserId: auth.context.adminUser.id },
      });
    })
  );

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "settings.update",
    resourceType: "SiteSetting",
    resourceId: group,
    before: before as Prisma.InputJsonValue,
    after: values as Prisma.InputJsonValue,
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", group, values });
}
