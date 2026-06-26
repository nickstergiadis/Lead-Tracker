# Restore at Home Lead Tracker

A simple, mobile-friendly lead/admin tracker for the Restore at Home mobile physiotherapy clinic. It is intentionally scoped to lead management only and is **not** a clinical charting or medical record system.

## Features

- Add, edit, and delete leads
- Track name, phone, email, location, referral source, new/returning lead type, condition/reason for inquiry, status, priority, next follow-up date, and notes
- Search by name, phone, email, location, condition, or notes
- Filter by status, referral source, priority, new/returning lead type, and next follow-up date
- Sort by newest, next follow-up date, status, or priority
- Dashboard cards for total, booked, follow-up needed, overdue follow-ups, and upcoming follow-ups
- Export all leads or the currently filtered list to CSV
- Required-field validation plus basic email and phone formatting checks
- Sample demo data included on first load
- Lightweight demo login gate

## Setup and run

No build step is required.

1. Clone or download this repository.
2. Open `index.html` directly in a browser, or serve the folder with any static file server:

   ```bash
   python3 -m http.server 4173
   ```

3. Visit `http://localhost:4173`.
4. Log in with the demo password:

   ```text
   restore-demo
   ```

## Data storage

Leads are stored in the browser's `localStorage` under the key `restoreAtHomeLeads`. This makes the app easy to run as an MVP, but data stays on the device/browser where it was entered.

## Privacy note

This app is for lead/admin tracking only. Do not use it to document treatment, assessments, clinical notes, or protected medical records. The included static password is a convenience gate for demos and should be replaced with real authentication before production use.

## CSV export

Use **Export all CSV** to download every saved lead. Use **Export filtered CSV** after applying search or filters to download only the visible result set.

## Customizing

- Change the demo password in `app.js` by updating `DEMO_PASSWORD`.
- Edit the sample leads in `app.js` in the `demoLeads` array.
- Update brand colors, badge colors, and layout in `styles.css`.
