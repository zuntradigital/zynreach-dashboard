# ZynReach Admin

## Project Overview

`zynreach-admin` is the administrative/backend control system for the ZynReach platform. It is an internal, authenticated-only dashboard used by staff to manage the platform's content and operational data — including blog posts, pages, pricing, careers/job listings, resources, media assets, leads, website chat conversations, site settings, and administrator accounts/roles/permissions.

It is not a public-facing site: every route other than login is protected by session authentication, and the app is built to be reachable only by authorized staff, not by end users or visitors of the wider ZynReach platform.

## Technology Stack

- **[Next.js](https://nextjs.org/) 16.2.12** — App Router, route handlers, middleware
- **[React](https://react.dev/) 19.2.4**
- **TypeScript** (`^5`)
- **[Prisma ORM](https://www.prisma.io/)** (`^6.2.1`) with **MySQL** as the database (migrated from PostgreSQL — see `scripts/migrate-pg-to-mysql.ts` and `prisma/migrations-postgresql-archive/` for the migration history)
- **Authentication / sessions** — custom email + password login with server-side, database-backed sessions (httpOnly cookies); no third-party auth provider
- **RBAC / permissions** — a `Role` × `Permission` model (module × action), with an account's effective permissions computed as the union of every role it holds
- **MFA** — TOTP-based multi-factor authentication (`otplib` + `qrcode` for enrollment QR codes) for roles that require it
- **Tailwind CSS** (`^4`, via `@tailwindcss/postcss`)
- **[next-intl](https://next-intl.dev/)** — localization/i18n, with English and Arabic (including RTL) supported
- **[Vitest](https://vitest.dev/)** (`^4`) — configured with `jsdom` and Testing Library, see [Testing Status](#testing-status) below
- Other notable dependencies: `argon2` (password hashing), `zod` (request validation), `sharp` (image processing for uploaded media), Tiptap (`@tiptap/*`, rich text editing for blog content)

## Requirements

- **Node.js 20 or newer** (the project's TypeScript types target Node 20; developed and verified on more recent Node releases as well)
- **npm**
- **A MySQL 8+ (or MariaDB) database** — a local install, Hostinger-provided MySQL, PlanetScale, or any compatible server
- The environment variables listed in [Environment Setup](#environment-setup) below

## Installation

```
npm install
```

## Environment Setup

Copy the example environment file to create your local configuration:

**Windows (Command Prompt):**
```
copy .env.example .env
```

**macOS/Linux (or Git Bash on Windows):**
```
cp .env.example .env
```

Then fill in real values for the required variables in `.env`:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | MySQL connection string (`mysql://user:password@host:port/database`) |
| `SESSION_SECRET` | Yes | Random secret used to sign/derive session-related values. Generate with `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | Has a default | Base URL the app is served from (defaults to `http://localhost:3001`) |
| `SERVICE_INGEST_TOKEN` | Needed to exercise service-to-service endpoints | Bearer token used by server-to-server callers (e.g. lead ingestion, chat ingestion) instead of a session login. Generate the same way as `SESSION_SECRET` |
| `SEED_SUPER_ADMIN_EMAIL` | Optional | Overrides the seeded Super Administrator's email (defaults to `admin@zynreach.local`) |
| `DEV_DISABLE_MFA` | Optional, local dev only | Skips the MFA step on login for manual testing. Only takes effect when `NODE_ENV` is not `production`, and only when explicitly set to `"true"`. Never set this in a deployed environment |

Using a single `.env` file (rather than `.env.local`) means both Next.js and the Prisma CLI (`migrate`, `db seed`, `generate`) read the same file automatically — no need to keep two files in sync.

Real secrets must only ever exist in your local `.env` file. This file is excluded from version control by `.gitignore` and must never be committed — see [Security](#security) below.

## Database Setup

With `DATABASE_URL` set, run the Prisma migration workflow:

```
npm run prisma:migrate
```

This applies the schema in `prisma/schema.prisma` (via `prisma migrate dev`) and also generates the Prisma Client.

If you need to regenerate the Prisma Client on its own (e.g. after pulling schema changes without a new migration):

```
npm run prisma:generate
```

Seed the database (creates the Role/Permission catalog and an initial Super Administrator account, whose randomly generated password is printed once to the console):

```
npm run db:seed
```

## Development

Start the local development server:

```
npm run dev
```

## Validation

```
npm run typecheck
```
Runs `tsc --noEmit` to verify the project compiles with no type errors.

```
npm run lint
```
Runs ESLint against the project.

```
npm run build
```
Runs `next build` — a production build, which also surfaces any build-time errors across the app.

## Runtime Verification

```
npx tsx scripts/verify-runtime.ts
```

This is **a scripted end-to-end runtime/API verification script, not a unit test suite.** It exercises the real HTTP API against a running dev server and a real MySQL database, using its own deterministic test fixtures (it does not depend on or modify the seeded Super Administrator account).

Prerequisites, per the script itself:
- `DATABASE_URL` set and `npx prisma migrate dev` already run
- `npx prisma db seed` already run (the script depends on the seeded Role/Permission catalog)
- A dev server running at `VERIFY_BASE_URL` (defaults to `http://localhost:3001`), with the same `DATABASE_URL` / `SESSION_SECRET` / `SERVICE_INGEST_TOKEN` loaded as the script's own environment

The script exits non-zero if any check fails.

## Testing Status

Vitest is configured (`vitest.config.ts`, `vitest.setup.ts`) with a `jsdom` environment and Testing Library, and `npm test` / `npm run test:watch` scripts exist. **However, there are currently no test files matching the configured pattern (`src/**/*.test.{ts,tsx}`).** Running `npm test` currently reports "No test files found" and exits non-zero — there is no automated unit/component test suite in place yet.

The available form of verification today is the runtime/API verification script described above (`scripts/verify-runtime.ts`), along with `npm run typecheck`, `npm run lint`, and `npm run build`.

## Security

- **Never commit `.env`, `.env.local`, or any other environment file containing real values.** `.gitignore` excludes all `.env*` files except `.env.example`, which must only ever contain placeholders.
- **Use strong, randomly generated secrets** for `SESSION_SECRET` and `SERVICE_INGEST_TOKEN`, both locally and in any deployed environment — never reuse example or default values.
- **Authentication and authorization are enforced at the API layer**, not just in the UI: every mutating route checks the caller's session and specific `module:action` permission before proceeding, and denied attempts are written to an audit log.
- **RBAC/permissions**: access is governed by a Role × Permission model; an account's effective permissions are the union of every role it holds.
- **MFA (TOTP)** is enforced for roles configured to require it (see `Role.mfaRequired` in the Prisma schema), independent of the local-dev-only bypass described above.
- **Passwords are hashed with argon2id**; session and MFA-challenge tokens are stored in the database only as hashes, never in plaintext.
- **Production secrets must be provided through your hosting platform's secure environment variable configuration** (e.g. Vercel project environment variables), never through a committed file.

## Important — Before Pushing to GitHub

**Real secrets must never be committed to this repository.** This includes, but is not limited to:

- Passwords (admin, database, or otherwise)
- Database connection strings / credentials (`DATABASE_URL`)
- Session secrets (`SESSION_SECRET`)
- Service tokens (`SERVICE_INGEST_TOKEN`)
- API keys or access tokens of any kind
- MFA/TOTP secrets
- `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.test`, or any other environment file containing real values

Only `.env.example`, containing placeholders, should ever be committed.
