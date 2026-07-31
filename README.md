# Restore at Home Lead Tracker

A mobile-friendly, **browser-only** lead tracker for Restore at Home. It is a completely static application: there is no login, account system, server API, or server-side database.

> **Important:** This is an administrative lead tracker, not a clinical chart or medical-record system. Do not use it for sensitive patient, health, treatment, assessment, clinical, or protected medical information.

## Data storage and backups

Lead records and activity history are stored in `localStorage` in the current browser profile. Data does **not** automatically sync across browsers, profiles, devices, or team members. Clearing browser storage, resetting the browser profile, or using browser cleanup tools can permanently erase the data.

Use **Export JSON** regularly to download a complete backup, including activity history. **Import JSON** validates the backup format and every lead before offering to replace or merge the current data. Invalid files are rejected without changing stored data. Merge matches records by lead ID; an imported record with the same ID replaces the current version. CSV exports remain available for all leads or the currently filtered list, but JSON is the format intended for restoration.

Because browser storage has no server recovery or automatic synchronization, keep exported backups in an appropriately secured location. The app intentionally provides no cosmetic frontend password: access is controlled only by access to the browser profile and device.

### Backup routine

1. Export JSON at the end of every work session when leads change. For occasional use, export at least weekly.
2. Move the downloaded file out of Downloads into an encrypted, access-controlled folder that is included in an organization's backed-up storage. Keep at least the latest three dated exports. Do not commit operational backups to this repository.
3. Once a month, restore the newest export in a separate browser profile (or a temporary, different origin). First test **Replace** against disposable data, then reset the disposable profile, add one distinct lead, and test **Merge**. Confirm notes, next actions, follow-up dates, contact details, statuses, and complete activity histories.
4. Record the export and restore-test dates in the team's normal operations checklist. Delete test data and downloaded duplicates when the verification is complete.

`test/fixtures/fictional-leads-backup.json` is a version-controlled, fictional test export for restore drills only. It is not an operational backup and contains no real lead data.

## Use

Open `index.html` from a static web server. For local development:

```bash
npm install
npm run build
npx serve dist
```

The built `dist/` directory can be deployed to any static-file host, including Vercel, GitHub Pages, or Netlify. No environment variables are required.

## Features

- Create, edit, and delete leads.
- Track status, priority, lead type, referral source, notes, next action, follow-up dates, and contact activity.
- Search, filter, and sort leads.
- View daily follow-up queues, open/overdue/booked metrics, and conversion rate.
- Export all or filtered records to CSV.
- Export and import validated, versioned JSON backups.

## Development

The project uses browser-native JavaScript with no runtime dependencies, bundler, transpiler, authentication service, or database. Business rules live in ES modules under `business/`.

| Command | Purpose |
| --- | --- |
| `npm test` | Run the business-logic and backup-validation tests. |
| `npm run lint` | Run ESLint over browser code, modules, tests, and tooling. |
| `npm run check` | Parse-check all JavaScript modules. |
| `npm run build` | Validate entry points and create fingerprinted static assets in `dist/`. |
