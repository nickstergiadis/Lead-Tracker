# Restore at Home Lead Tracker

A mobile-friendly lead/admin tracker for the Restore at Home mobile physiotherapy clinic. It is **not** a clinical chart or medical-record system.

## Security and data model

The production application is a Vercel application backed by PostgreSQL. Authentication is checked by every create, read, update, delete, activity, import, and export route. The browser receives only an `HttpOnly`, `Secure`, `SameSite=Strict` signed session cookie; it does not decide whether a user is authorized. Passwords are represented only by a server-side scrypt hash.

Accounts are isolated by UUID ownership enforced in every query. Registration requires a single-use, expiring invitation created by an authenticated administrator. Passwords use salted scrypt hashes; recovery codes contain 128 bits of entropy and only their keyed hashes are stored. Do not enter treatment, assessment, clinical, or protected medical information.

Leads and activity history live in PostgreSQL. The schema indexes owner-scoped normalized status, follow-up date, normalized phone, and normalized email. Apply it before deployment:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

## Deploy to Vercel

1. Import the repository into Vercel and attach a managed PostgreSQL database.
2. In **Project Settings → Environment Variables**, add the values shown in `.env.example`. These are server-only secrets and must not be exposed as public/client variables.
3. Generate a session secret, for example with `openssl rand -base64 48`.
4. Apply `db/schema.sql`, temporarily set matching random `BOOTSTRAP_TOKEN` and `BOOTSTRAP_CONFIRM_TOKEN` values, and bootstrap the first administrator from a trusted terminal:

   ```bash
   node scripts/bootstrap-admin.mjs admin "Administrator" 'a-long-Unique-password!42'
   ```

5. Save the one-time recovery code offline, then immediately remove both bootstrap variables. Bootstrap refuses to run after a usable administrator exists. Sign in and create invitations from authenticated administrator tooling; invitation plaintext is returned only when created.
6. Verify the target database with `npm run verify:migration`, then deploy the exact commit that was verified. Vercel runs the repository build and serves fingerprinted JavaScript/CSS from `dist/`; HTML is marked `no-store`, so authentication markup cannot retain a stale `app.js`. Explicit rewrites keep registration and recovery on the serverless API.

## Migrating an existing installation

Back up the database, then run `psql "$DATABASE_URL" -f db/migrations/001_multi_user.sql`. The transaction creates `legacy-admin`, assigns every legacy `primary` lead and activity to that UUID, aborts if any row has an unexpected owner, and only then installs foreign keys. Run the bootstrap command above immediately; it converts that placeholder into the first usable administrator without changing its UUID, preserving ownership.

Run `npm run verify:migration` against the production `DATABASE_URL` after applying the migration and before deploying. A release must not proceed unless that check confirms the authentication tables, non-null UUID ownership columns, and ownership foreign keys. Run the opt-in database integration suite with `TEST_DATABASE_URL=... npm run test:integration`; it creates and removes an isolated PostgreSQL schema.

## Invitations, recovery, disablement, and lockout

Administrators create short-lived invitations only through authenticated `/api/admin/invitations` routes. Codes are single-use and atomically consumed. Registration and recovery show a new recovery code exactly once with print/download controls; users must acknowledge saving it. Codes are never put in URLs or browser storage. Recovery consumes the old code, changes the password, increments the session version, and revokes every session. Security settings support password changes, recovery-code replacement, session review, and revoking other sessions.

Disabling an account revokes all of its sessions. Server-side role checks protect administrator operations, and the final active administrator cannot disable itself. For total lockout, a database operator must verify identity and either re-enable an existing administrator or, only when no usable active administrator remains, reset the affected row to the documented `bootstrap-required` placeholder and run bootstrap from a trusted terminal. Rotate session, invitation, and recovery peppers after a suspected server-secret compromise; rotating them invalidates sessions and outstanding codes as applicable.

For local development, copy `.env.example` to `.env.local`, supply real values, apply the schema, then run:

```bash
npm install
npx vercel dev
```

## Development toolchain

Development and production validation support **Node.js 20, 22, and 24** (the active
even-numbered releases covered by `>=20 <25`). The application remains browser-native
JavaScript: there is no bundler, transpiler, frontend framework, or added runtime
dependency. Business rules live in separately importable ES modules under `business/`.

Install the existing server dependency and the lint-only development tools:

```bash
npm install
```

The supported commands below all require Node.js 20–24:

| Command | Purpose |
| --- | --- |
| `npm test` | Run the pure business-logic suite with Node's built-in test runner. |
| `npm run lint` | Run ESLint over browser code, server code, modules, tests, and tooling. |
| `npm run check` | Parse-check every JavaScript module and server script with `node --check`; this is the lightweight static check. |
| `npm run build` | Validate the no-bundle entry-point references and copy deployable static files to `dist/`. |
| `npm start` | Start the application through the local Vercel development server. |

`npm run build` deliberately does not compile or bundle the application. Vercel still
serves the repository's static files directly; `dist/` is a disposable validation
artifact suitable for a generic static-file host. The current deployment configuration
does not provide an installed browser, so browser-driven accessibility and responsive
smoke tests are not included. The existing responsive and accessible markup remains
covered by review and can be exercised in a future browser-enabled pipeline without
changing the production architecture.

## Browser-data import

Earlier versions stored leads under `restoreAtHomeLeads` in browser `localStorage`. The app never uploads those records automatically. After signing in, **Import browser backup** performs an authenticated server preview showing total, valid, and invalid counts. Import requires explicit confirmation and first downloads a dated JSON backup. The original browser value is retained after import. Resolve invalid records before importing; the import endpoint rejects partial/invalid batches.

## CSV export

**Export all CSV** downloads server data through an authenticated export endpoint. **Export filtered CSV** serializes the already-authorized records currently loaded into the signed-in view.
