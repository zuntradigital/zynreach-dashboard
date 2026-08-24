import { PrismaClient } from "@prisma/client";

/**
 * Standard Next.js-dev-mode-safe Prisma singleton: without this, every
 * hot-reload in `next dev` would create a fresh PrismaClient (and a
 * fresh connection pool) on top of the previous one, eventually
 * exhausting MySQL's connection limit. Production (one process, no
 * HMR) is unaffected either way.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
