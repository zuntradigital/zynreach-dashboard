import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guards";
import { getEffectivePermissions } from "@/lib/rbac";

/** Used by the dashboard shell to check "am I logged in, and as whom" on
 * load — read-only, no audit entry (viewing your own session state isn't
 * a state-changing action per SRS §25's action list). */
export async function GET() {
  const result = await requireSession();
  if (!result.ok) return result.response;

  const { adminUser } = result.context;
  const effective = await getEffectivePermissions(adminUser.id);

  return NextResponse.json({
    user: {
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      roles: effective.roleNames,
      permissions: Array.from(effective.permissions),
    },
  });
}
