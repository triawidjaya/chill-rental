# Chill Rental

A modular, framework-less **single-page app** for motorbike rental management. Built with vanilla JavaScript (ES modules), it runs entirely in the browser and persists data to `localStorage` — no build step, no bundler, no `node_modules`. An **optional** offline-first Supabase backend adds multi-device sync on top, without changing the local-first behavior (drop in `modules/config.js` to enable it; leave it out and the app runs 100% locally as before).

## Features

- **Dashboard** — an operational cockpit: an **Action Queue** ("what needs doing now" — overdue, awaiting payment, owner-settle, damage) plus a slim status strip (available / rented / active / passports held). Financial analytics live on Reports.
- **Rentals** — full lifecycle with a multi-flag model: `active → returned → (paid) → (owner-settled) → (damage-resolved)`, plus cancel, undo check-out, admin correction, and a passport-hold workflow
- **Online guest booking** — public, tokenless booking page (`booking.html`, scan a QR / open a link) with a binding Terms & Conditions gate; submissions land in a staff review queue (confirm / reject / cancel) and convert to a real check-in. Guest writes go through a `SECURITY DEFINER` Supabase RPC — anon never touches tables.
- **WhatsApp receipts** — copy-paste, phone-friendly plain-text messages for guests (check-in, final invoice) and owners (motor returned + PTO, settlement), with a Copy + Open-WA flow
- **Motors** — inventory with category, CC, surfrack/accessories, per-motor pay-to-owner (PTO); the new-rental motor picker recommends the longest-idle bike (fair LRU allocation, soft hint)
- **Owners** & **Staff** — directory management with audit trail
- **Auth & roles** — PIN/email login (`SessionManager`) with Manager / Admin / Staff roles gating sensitive actions
- **Reports** — revenue, commission, pay-to-owner, damage recovery, plus the 14-day volume chart and top-motors analytics; CSV export
- **Audit log** — every create/update/delete (and login/role change) recorded with actor, with filtering and CSV export
- **Damages** — per-motor damage records and recovery charges
- **Backup / Restore** — export and import all data as JSON
- **Optional Supabase sync** — offline-first multi-device sync (localStorage stays the synchronous working store; a background engine pushes/pulls + Realtime)
- **Configurable property name**, **dark mode**, collapsible sidebar, and **bilingual UI** (Bahasa Indonesia default + English)

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

Then open <http://localhost:3000>. The app starts empty — add your owners, motors, and rentals from each section. The public guest booking page is at <http://localhost:3000/booking.html> (and a printable QR for it at `booking-qr.html`).

### Optional: Supabase sync

Sync is off until you supply credentials. To enable multi-device sync:

1. Run `supabase/schema.sql` (and `supabase/auth-rls.sql`) in your project's SQL Editor.
2. Copy `modules/config.example.js` → `modules/config.js` and fill in `SUPABASE_URL` / `SUPABASE_ANON_KEY` (`config.js` is gitignored). Set `SYNC_ENABLED = false` to keep the app fully local.

The anon key is safe to expose in the browser — security lives in Row Level Security, not in key secrecy.

## Tests

Open <http://localhost:3000/smoke-test.html> — an in-browser smoke test covering the manager modules, rental lifecycle, WA-receipt builders, and fair-allocation logic (100+ assertions).

## Project structure

```
index.html            App shell (loads modules/app.js as an ES module)
booking.html          Public guest booking page (standalone, anon Supabase)
booking-qr.html       Printable QR poster linking to booking.html
smoke-test.html       In-browser test runner
modules/
  app.js              Entry point: hash router, boot, migrations, global wiring
  state.js            Observer store over localStorage (+ sync dirty-tracking)
  storage.js          Versioned localStorage persistence
  rentals.js          RentalManager — core transaction logic
  motors.js           MotorManager — inventory CRUD + queries
  owners.js           OwnerManager
  staff.js            StaffManager + roles (Manager / Admin / Staff)
  session.js          SessionManager — PIN/email login, current actor
  damages.js          DamageManager
  audit.js            AuditManager — change tracking
  reports.js          ReportEngine — aggregates
  booking.js          BookingManager — staff-side review queue / lifecycle
  booking-guest.js    Public guest-page logic (agreement gate + submit RPC)
  allocation.js       Fair LRU motor-allocation recommendation
  receipts.js         WhatsApp receipt/invoice builders (pure, no DOM)
  pricing.js          Per-CC public price table + booking CC options
  terms.js            Binding T&C + ride tips (English) + property name
  property.js         Configurable property name (settings → fallback)
  supabase.js         Offline-first sync engine (initSync + pull/push/realtime)
  config.js           Supabase credentials (gitignored; see config.example.js)
  crypto.js           PIN/password hashing + salt
  i18n.js             Bilingual string table (ID/EN) + helpers
  utils.js            Formatting, dates, currency, CSV, WA/clipboard helpers
  ui/
    forms.js          Modal form builders (rental, motor, owner, check-out)
    login.js          Login gate UI
    receipt-modal.js  WA receipt preview + Copy / Open-WA modal
    notify.js         Modal & Toast primitives
pages/                One render module per route (dashboard, rentals, booking, ...)
styles/               CSS tokens, base, components, layout, auth
supabase/             schema.sql + auth-rls.sql (run in the SQL Editor)
docs/                 Feature plans (booking, WA receipt, dashboard revamp)
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

**Sync (optional):** localStorage stays the synchronous working store — the UI never awaits the network. A background engine (`supabase.js`) mirrors six collections (motors, rentals, owners, damages, staff, audit_log) to Postgres as `jsonb` blobs and subscribes to Realtime. Conflicts resolve last-write-wins by `updatedAt`; deletes propagate via soft-delete tombstones. `settings` stays per-device (theme/lang) and is not synced.

## Roadmap

The originally planned phases have all shipped:

- **WhatsApp receipts** — guest + owner copy-paste messages (`receipts.js`).
- **Dashboard revamp** — operational Action Queue + analytics re-homed to Reports, plus fair LRU motor allocation (`allocation.js`).
- **Online guest booking** — public booking page, agreement gate, staff review queue, and check-in conversion; configurable property name + consistent WA branding.
- **Fase B.1 — Supabase sync** — offline-first multi-device sync (`supabase.js`).
- **Fase B.2 — Auth & roles** — PIN/email login (`session.js`) with Manager / Admin / Staff gating on sensitive actions.

**Deferred / future:** per-date motor reservation & availability locking, passport-photo upload / e-signature, public price classes 155/160, and in-UI editors for pricing and the T&C. See [`docs/`](docs/) for the detailed feature plans.

## License

[MIT](LICENSE)
