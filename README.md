# Chill Rental

A modular, framework-less, backend-less **single-page app** for motorbike rental management. Built with vanilla JavaScript (ES modules), it runs entirely in the browser and persists data to `localStorage` — no build step, no server, no dependencies.

## Features

- **Dashboard** — active rentals, revenue, alerts (estimates past due, cut-off reminders)
- **Rentals** — full lifecycle with a multi-flag model: `active → returned → (paid) → (owner-settled) → (damage-resolved)`, plus cancel, undo check-out, admin correction, and a passport-hold workflow
- **Motors** — inventory with category, CC, surfrack/accessories, per-motor pay-to-owner (PTO)
- **Owners** & **Staff** — directory management with audit trail
- **Reports** — revenue, commission, pay-to-owner, damage recovery; CSV export
- **Audit log** — every create/update/delete recorded with actor, with filtering and CSV export
- **Damages** — per-motor damage records and recovery charges
- **Backup / Restore** — export and import all data as JSON
- **Dark mode**, collapsible sidebar, and **bilingual UI** (Bahasa Indonesia default + English)

## Run locally

No build required — just serve the folder over HTTP (ES modules need `http://`, not `file://`).

**Windows:** double-click `start-server.bat` (auto-detects Python or Node), then open <http://localhost:3000>.

**Manual:**

```bash
# Python
python -m http.server 3000

# or Node
npx http-server -p 3000 -c-1
```

Then open <http://localhost:3000>. On first run, use **Load Demo Data** in Settings to populate sample owners, motors, and rentals.

## Tests

Open <http://localhost:3000/smoke-test.html> — an in-browser smoke test covering the manager modules and rental lifecycle (101 assertions).

## Project structure

```
index.html            App shell (loads modules/app.js as an ES module)
modules/
  app.js              Entry point: hash router, boot, migrations, global wiring
  state.js            Observer store over localStorage
  storage.js          Versioned localStorage persistence
  rentals.js          RentalManager — core transaction logic
  motors.js           MotorManager — inventory CRUD + queries
  owners.js           OwnerManager
  staff.js            StaffManager + roles (Manager / Admin / Staff)
  damages.js          DamageManager
  audit.js            AuditManager — change tracking
  reports.js          ReportEngine — aggregates
  seed.js             Demo data loader
  i18n.js             Bilingual string table (ID/EN) + helpers
  utils.js            Formatting, dates, currency, CSV helpers
  ui/
    forms.js          Modal form builders (rental, motor, owner, check-out)
    notify.js         Modal & Toast primitives
pages/                One render module per route (dashboard, rentals, motors, ...)
styles/               CSS tokens, base, components, layout
```

## Architecture

Layered and one-directional:

```
storage (localStorage, versioned)
  → state (observer pattern)
    → manager modules (rentals, motors, owners, …)
      → pages (render functions)
        → router (hash-based, in app.js)
```

`migrate()` in `app.js` runs on boot and is non-destructive — it upgrades older saved data to the current schema in place.

## Roadmap

**Phase B (planned):** user roles with PIN authentication. The data model already carries staff roles, and `audit.js` exposes `setActorResolver()` plus auth audit actions (`LOGIN`, `ROLE_CHANGE`, `RESET_PIN`) as the integration points for a future `SessionManager`.

## License

[MIT](LICENSE)
