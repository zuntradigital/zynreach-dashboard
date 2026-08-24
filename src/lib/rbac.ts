import { prisma } from "@/lib/db";

/**
 * SRS §8: "Permission dimensions (module × action)... Permissions are
 * additive and role-composable: an account may hold more than one role,
 * and the effective permission set is the union."
 *
 * Naming convention: a permission is displayed/checked as the string
 * "module:action" (e.g. "leads:view"), composed from the Permission
 * model's two columns — never stored pre-joined, so each half stays
 * independently queryable (see schema.prisma's Permission model doc).
 */
export function permissionKey(module: string, action: string): string {
  return `${module}:${action}`;
}

export interface EffectivePermissions {
  roleNames: string[];
  permissions: Set<string>;
  /** SRS §30: true if any held role requires MFA (data-driven via
   * Role.mfaRequired — see schema.prisma). */
  mfaRequired: boolean;
}

/**
 * Computes an AdminUser's effective permission set: the union of every
 * permission granted by every role they hold (§8). This is the single
 * place that union logic lives — every API route's authorization check
 * (lib/auth/guards.ts) goes through this function rather than
 * re-deriving it, so a later "explicit deny" extensibility point (§8,
 * flagged [PROPOSED] in the SRS) has exactly one place to be added.
 */
export async function getEffectivePermissions(adminUserId: string): Promise<EffectivePermissions> {
  const userRoles = await prisma.adminUserRole.findMany({
    where: { adminUserId },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });

  const permissions = new Set<string>();
  const roleNames: string[] = [];
  let mfaRequired = false;

  for (const userRole of userRoles) {
    roleNames.push(userRole.role.name);
    if (userRole.role.mfaRequired) mfaRequired = true;
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(permissionKey(rolePermission.permission.module, rolePermission.permission.action));
    }
  }

  return { roleNames, permissions, mfaRequired };
}

export function hasPermission(effective: EffectivePermissions, module: string, action: string): boolean {
  return effective.permissions.has(permissionKey(module, action));
}
