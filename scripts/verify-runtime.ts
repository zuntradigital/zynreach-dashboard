/**
 * Phase 1 runtime verification — exercises the real HTTP API against a
 * running dev server and a real MySQL database. Not a unit-test
 * suite; a scripted end-to-end walkthrough of every behavior the Phase 1
 * directive requires to be runtime-verified, not just statically typed.
 *
 * Prerequisites:
 *   - DATABASE_URL set (in .env.local) and `npx prisma migrate dev` run.
 *   - `npx prisma db seed` run (creates the Role/Permission catalog this
 *     script depends on — it does NOT depend on the seed's randomly
 *     generated Super Administrator account; it creates its own
 *     deterministic fixtures below so its credentials are reproducible).
 *   - A dev server running at VERIFY_BASE_URL (default
 *     http://localhost:3001), with the same DATABASE_URL/SESSION_SECRET/
 *     SERVICE_INGEST_TOKEN loaded.
 *
 * Run with: npx tsx scripts/verify-runtime.ts
 * Exits non-zero if any check fails.
 */
import { PrismaClient } from "@prisma/client";
import { authenticator } from "otplib";
import { hashPassword } from "../src/lib/auth/password";
import { hashToken } from "../src/lib/auth/tokens";

const prisma = new PrismaClient();
const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:3001";
const SERVICE_INGEST_TOKEN = process.env.SERVICE_INGEST_TOKEN ?? "";
const TEST_IP = "203.0.113.10";

const SUPERADMIN_EMAIL = "verify-superadmin@test.local";  //test
const SUPERADMIN_PASSWORD = "Verify-Runtime-Test-Only-2026!"; //test
const ANALYST_EMAIL = "verify-analyst@test.local";
const ANALYST_PASSWORD = "Verify-Analyst-Test-Only-2026!"
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}

function extractSessionCookie(res: Response): string | null {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    if (raw.startsWith("zynreach_admin_session=")) return raw.split(";")[0];
  }
  return null;
}

function cookieRawToken(cookie: string): string {
  return decodeURIComponent(cookie.split("=")[1]);
}

async function login(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": TEST_IP },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, cookie: extractSessionCookie(res) };
}

async function main() {
  console.log("=== ZynReach Admin (System B) — Phase 1 runtime verification ===");
  console.log(`Target: ${BASE_URL}\n`);

  if (!SERVICE_INGEST_TOKEN) {
    throw new Error("SERVICE_INGEST_TOKEN is not set in the environment this script is running under.");
  }

  // --- Setup ---------------------------------------------------------
  console.log("[Setup] Deterministic test fixtures");
  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: "Super Administrator" } });
  const analystRole = await prisma.role.findUniqueOrThrow({ where: { name: "Analyst" } });
  const readOnlyRole = await prisma.role.findUniqueOrThrow({ where: { name: "Read Only" } });

  await prisma.adminUser.deleteMany({ where: { email: { in: [SUPERADMIN_EMAIL, ANALYST_EMAIL] } } });

  const superAdmin = await prisma.adminUser.create({
    data: {
      name: "Verify SuperAdmin",
      email: SUPERADMIN_EMAIL,
      passwordHash: await hashPassword(SUPERADMIN_PASSWORD),
      status: "ACTIVE",
      roles: { create: { roleId: superAdminRole.id } },
    },
  });
  const analyst = await prisma.adminUser.create({
    data: {
      name: "Verify Analyst",
      email: ANALYST_EMAIL,
      passwordHash: await hashPassword(ANALYST_PASSWORD),
      status: "ACTIVE",
      roles: { create: { roleId: analystRole.id } },
    },
  });
  console.log(`  Super Admin fixture: ${superAdmin.id}`);
  console.log(`  Analyst fixture:     ${analyst.id}`);

  // --- Phase A: MFA end-to-end (Super Administrator) ------------------
  console.log("\n[A] MFA — enrollment, wrong code, expired/single-use challenge, success");
  let superAdminCookie = "";
  {
    const first = await login(SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD);
    check("first login for an MFA role returns mfa_setup_required", first.data.status === "mfa_setup_required");
    check("enrollment response includes a QR code and secret", Boolean(first.data.qrCodeDataUrl && first.data.secret));

    const secret: string = first.data.secret;
    const challengeToken1: string = first.data.challengeToken;

    const wrongCodeRes = await fetch(`${BASE_URL}/api/admin/auth/mfa-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": TEST_IP },
      body: JSON.stringify({ challengeToken: challengeToken1, code: "000000" }),
    });
    check("wrong TOTP code is rejected (401)", wrongCodeRes.status === 401);
    const mfaDeniedRow = await prisma.auditLog.findFirst({
      where: { actorEmail: SUPERADMIN_EMAIL, action: "auth.mfa_verify", result: "DENIED" },
      orderBy: { createdAt: "desc" },
    });
    check("DENIED audit row written for wrong MFA code", mfaDeniedRow !== null);

    const correctCode = authenticator.generate(secret);
    const replayRes = await fetch(`${BASE_URL}/api/admin/auth/mfa-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": TEST_IP },
      body: JSON.stringify({ challengeToken: challengeToken1, code: correctCode }),
    });
    check("challenge is single-use — correct code on the SAME challenge after a failed attempt is rejected", replayRes.status === 401);

    const second = await login(SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD);
    check("second login attempt reuses the same not-yet-enrolled secret", second.data.secret === secret);
    const challengeToken2: string = second.data.challengeToken;
    const code2 = authenticator.generate(secret);

    const verifyRes = await fetch(`${BASE_URL}/api/admin/auth/mfa-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": TEST_IP },
      body: JSON.stringify({ challengeToken: challengeToken2, code: code2 }),
    });
    const verifyData = await verifyRes.json();
    check("correct TOTP code on a fresh challenge completes login", verifyRes.ok && verifyData.status === "success");
    superAdminCookie = extractSessionCookie(verifyRes) ?? "";
    check("session cookie issued on MFA-completed login", superAdminCookie !== "");

    const refreshedUser = await prisma.adminUser.findUniqueOrThrow({ where: { id: superAdmin.id } });
    check("AdminUser.mfaEnabled flips true after first successful verification", refreshedUser.mfaEnabled === true);

    const third = await login(SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD);
    check("subsequent login for an enrolled MFA account returns mfa_required (no QR)", third.data.status === "mfa_required" && !third.data.qrCodeDataUrl);
  }

  // --- Phase B: non-MFA login + session + RBAC denial ------------------
  console.log("\n[B] Authentication (non-MFA role) + RBAC API-level denial");
  let analystCookie = "";
  {
    const { res, data, cookie } = await login(ANALYST_EMAIL, ANALYST_PASSWORD);
    check("correct credentials for a non-MFA role log in directly", res.ok && data.status === "success");
    analystCookie = cookie ?? "";
    check("session cookie issued", analystCookie !== "");

    const successRow = await prisma.auditLog.findFirst({
      where: { actorEmail: ANALYST_EMAIL, action: "auth.login", result: "SUCCESS" },
      orderBy: { createdAt: "desc" },
    });
    check("SUCCESS audit row written for login", successRow !== null);

    const sessionRes = await fetch(`${BASE_URL}/api/admin/auth/session`, { headers: { Cookie: analystCookie } });
    check("GET /api/admin/auth/session succeeds with a fresh cookie", sessionRes.status === 200);

    const leadsRes = await fetch(`${BASE_URL}/api/admin/leads`, {
      headers: { Cookie: analystCookie, "x-forwarded-for": TEST_IP },
    });
    check("GET /api/admin/leads returns 403 for a role without leads:view (Analyst)", leadsRes.status === 403);

    const denyRow = await prisma.auditLog.findFirst({
      where: { actorId: analyst.id, action: "leads:view", result: "DENIED" },
      orderBy: { createdAt: "desc" },
    });
    check("DENIED audit row written for the RBAC-denied request", denyRow !== null);
  }

  // --- Phase C: role change -> session invalidation (SRS §30) ----------
  console.log("\n[C] Role/permission change invalidates existing sessions (SRS §30)");
  {
    const putRes = await fetch(`${BASE_URL}/api/admin/admin-users/${analyst.id}/roles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: superAdminCookie, "x-forwarded-for": TEST_IP },
      body: JSON.stringify({ roleIds: [readOnlyRole.id] }),
    });
    const putData = await putRes.json().catch(() => ({}));
    check("Super Admin can reassign another account's roles", putRes.ok && putData.status === "success");
    check("endpoint reports sessions were invalidated", putData.sessionsInvalidated === true);

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "admin_user.roles_update", resourceId: analyst.id },
      orderBy: { createdAt: "desc" },
    });
    check("audit row records before/after roleIds for the change", auditRow !== null && Array.isArray((auditRow?.after as { roleIds?: unknown[] } | null)?.roleIds));

    const staleSessionRes = await fetch(`${BASE_URL}/api/admin/auth/session`, { headers: { Cookie: analystCookie } });
    check("the analyst's PRE-change session cookie is now rejected (401)", staleSessionRes.status === 401);

    const remainingSessions = await prisma.session.count({ where: { adminUserId: analyst.id } });
    check("no Session rows remain for the analyst after the role change", remainingSessions === 0);

    const selfChangeRes = await fetch(`${BASE_URL}/api/admin/admin-users/${superAdmin.id}/roles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: superAdminCookie },
      body: JSON.stringify({ roleIds: [] }),
    });
    check("a Super Admin cannot modify their own role assignment (self-lockout guard)", selfChangeRes.status === 400);
  }

  // --- Phase D: session inactivity timeout (SRS §30, 30 minutes) -------
  console.log("\n[D] Session inactivity timeout (30 minutes)");
  {
    const { cookie } = await login(ANALYST_EMAIL, ANALYST_PASSWORD);
    if (!cookie) throw new Error("Expected a session cookie for the inactivity-timeout fixture login.");

    const tokenHash = hashToken(cookieRawToken(cookie));
    const before = await prisma.session.findUnique({ where: { tokenHash } });
    check("fixture session row exists before manipulation", before !== null);

    await prisma.session.update({
      where: { tokenHash },
      data: { lastActivityAt: new Date(Date.now() - 31 * 60 * 1000) },
    });

    const res = await fetch(`${BASE_URL}/api/admin/auth/session`, { headers: { Cookie: cookie } });
    check("a session idle for 31 minutes is rejected (401)", res.status === 401);

    const after = await prisma.session.findUnique({ where: { tokenHash } });
    check("the idle-expired session row is deleted, not merely flagged", after === null);
  }

  // --- Phase E: wrong password + per-account rate limiting -------------
  console.log("\n[E] Wrong-password rejection + per-account rate limiting (max 5/min)");
  {
    let sawUnauthorized = false;
    let sawRateLimited = false;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const res = await fetch(`${BASE_URL}/api/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": TEST_IP },
        body: JSON.stringify({ email: ANALYST_EMAIL, password: "still-wrong" }),
      });
      if (res.status === 401) sawUnauthorized = true;
      if (res.status === 429) sawRateLimited = true;
    }
    check("wrong password returns 401 before the limit trips", sawUnauthorized);
    check("repeated attempts against the same account eventually return 429", sawRateLimited);

    const deniedRow = await prisma.auditLog.findFirst({
      where: { actorEmail: ANALYST_EMAIL, action: "auth.login", result: "DENIED" },
      orderBy: { createdAt: "desc" },
    });
    check("DENIED audit row written for a wrong-password attempt", deniedRow !== null);
  }

  // --- Phase F: leads ingestion end-to-end ------------------------------
  console.log("\n[F] Leads ingestion (service-token auth)");
  {
    const badTokenRes = await fetch(`${BASE_URL}/api/admin/leads/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer not-the-real-token" },
      body: JSON.stringify({ formId: "contact", payload: { message: "hi" } }),
    });
    check("ingest rejects an invalid service token (401)", badTokenRes.status === 401);

    const ingestRes = await fetch(`${BASE_URL}/api/admin/leads/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_INGEST_TOKEN}` },
      body: JSON.stringify({
        formId: "contact",
        payload: { name: "Runtime Verify", message: "Automated Phase 1 verification run" },
        utm: { source: "verify-script" },
        source: "verify-script",
        visitorIp: "198.51.100.20",
      }),
    });
    const ingestData = await ingestRes.json().catch(() => ({}));
    check("ingest with a valid service token succeeds (201)", ingestRes.status === 201 && ingestData.status === "success");

    const lead = ingestData.leadId ? await prisma.lead.findUnique({ where: { id: ingestData.leadId }, include: { submission: true } }) : null;
    check("Lead + Submission rows were created", lead !== null && lead?.submission.formId === "contact");
    check("Submission.ipHash was derived (not the raw IP)", Boolean(lead?.submission.ipHash) && lead?.submission.ipHash !== "198.51.100.20");

    const ingestAuditRow = await prisma.auditLog.findFirst({
      where: { action: "leads.ingest", result: "SUCCESS", resourceId: ingestData.leadId },
    });
    check("SUCCESS audit row written for the ingest", ingestAuditRow !== null);

    // Confirm the ingested lead is visible through the session-authenticated list
    // endpoint — reuses superAdminCookie from Phase A directly. Nothing in this
    // script invalidates the Super Admin's own session (Phase C's role change
    // targets the analyst, and the self-lockout guard blocks changing one's own
    // roles), so it is still valid here; no need to log in again.
    const listRes = await fetch(`${BASE_URL}/api/admin/leads?take=5`, { headers: { Cookie: superAdminCookie } });
    const listData = await listRes.json().catch(() => ({ leads: [] }));
    check("Super Admin (leads:view) can list the ingested lead via the session API", listRes.ok && Array.isArray(listData.leads) && listData.leads.some((l: { id: string }) => l.id === ingestData.leadId));

    if (lead) await prisma.lead.delete({ where: { id: lead.id } });
    if (lead) await prisma.submission.delete({ where: { id: lead.submissionId } });
  }

  // --- Cleanup -----------------------------------------------------------
  console.log("\n[Cleanup] Removing test fixtures (AuditLog rows are kept — append-only by design)");
  await prisma.adminUser.deleteMany({ where: { email: { in: [SUPERADMIN_EMAIL, ANALYST_EMAIL] } } });

  // --- Summary -------------------------------------------------------
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log("Failures:");
    for (const name of failures) console.log(`  - ${name}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("\nVerification script crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
