# Restore at Home Lead Tracker

A mobile-friendly lead/admin tracker for the Restore at Home mobile physiotherapy clinic. It is **not** a clinical chart or medical-record system.

## Security and data model

The production application is a Vercel application backed by PostgreSQL. Authentication is checked by every create, read, update, delete, activity, import, and export route. The browser receives only an `HttpOnly`, `Secure`, `SameSite=Strict` signed session cookie; it does not decide whether a user is authorized. Passwords are represented only by a server-side scrypt hash.

This is intentionally a minimal, single-owner authentication model. Use a managed identity provider before adding multiple users or roles. Do not enter treatment, assessment, clinical, or protected medical information.

Leads and activity history live in PostgreSQL. The schema indexes owner-scoped normalized status, follow-up date, normalized phone, and normalized email. Apply it before deployment:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

## Deploy to Vercel

1. Import the repository into Vercel and attach a managed PostgreSQL database.
2. In **Project Settings → Environment Variables**, add the values shown in `.env.example`. These are server-only secrets and must not be exposed as public/client variables.
3. Generate a session secret, for example with `openssl rand -base64 48`.
4. Generate the password hash locally (replace the final argument with the desired password), then save the printed value as `AUTH_PASSWORD_HASH`:

   ```bash
   node -e 'const c=require("node:crypto"),s=c.randomBytes(16);console.log(`scrypt$${s.toString("base64url")}$${c.scryptSync(process.argv[1],s,32).toString("base64url")}`)' 'choose-a-long-unique-password'
   ```

5. Apply `db/schema.sql` to the production database, then deploy. Vercel serves the static frontend and routes `/api/*` to the serverless API.

For local development, copy `.env.example` to `.env.local`, supply real values, apply the schema, then run:

```bash
npm install
npx vercel dev
```

## Browser-data import

Earlier versions stored leads under `restoreAtHomeLeads` in browser `localStorage`. The app never uploads those records automatically. After signing in, **Import browser backup** performs an authenticated server preview showing total, valid, and invalid counts. Import requires explicit confirmation and first downloads a dated JSON backup. The original browser value is retained after import. Resolve invalid records before importing; the import endpoint rejects partial/invalid batches.

## CSV export

**Export all CSV** downloads server data through an authenticated export endpoint. **Export filtered CSV** serializes the already-authorized records currently loaded into the signed-in view.

## Tests

```bash
npm test
```
