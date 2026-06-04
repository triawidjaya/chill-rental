# Dashboard Revamp — Operational Cockpit for Staff

Status: **planning / notes** (no code yet).

## Goal
Turn the dashboard from an info board (mostly retrospective analytics) into an
**operational cockpit** that answers the only question front-desk staff care about:
*"What do I need to DO right now?"* Analytics (revenue, trends, rankings) move to
the **Reports** page, where the audience and — in Fase B — the role gating fit.

## Audience principle
- **Dashboard** = operational staff → today's actionable work.
- **Reports** = manager/owner → money, trends, rankings (role-gated in Fase B).

---

## Findings — current dashboard, scored for operational staff

| Element | Source | Value to staff | Decision |
|---------|--------|----------------|----------|
| Alert banner: expired estimate + past cut-off | `isEstimateExpired`, dashboard.js:33 | 🟢 High, actionable | **Keep**, merge into Action Queue |
| KPI **Motor Disewa** + utilization % | `ov.motorsRented`, `ov.utilizationPct` | 🟡 Count ok; **%** is a manager metric | Simplify (drop %) |
| KPI **Tersedia** | `ov.motorsAvailable` | 🟢 High — answers "any bike ready?" for walk-ins | **Keep** |
| KPI **Paspor Ditahan** | `ov.passportsKept` | 🟡 Count only, not clickable | Convert to **actionable row** in queue |
| KPI **Pendapatan + Komisi** | `ov.revenueMonth`, `ov.commissionMonth` | 🔴 Financial, not a staff task + privacy | **Move to Reports** (manager-only in Fase B) |
| **Volume chart** (span-8, dominant) | `rentalsByDay(14)` | 🔴 Retrospective analytics | **Move to Reports** |
| **By Category** (fleet mix) | `motorsByCategory` | 🟢 Encodes the rental **priority rule** (Properti → Staf → Non-staf) | **Keep** (operational, per user) |
| **Active Rentals** (recent 5) | `RentalManager.active()` | 🟢 High — who's out now, click→detail | **Keep** |
| **Top Motors** (by revenue) | `topMotors(5)` | 🔴 Analytics/management | **Move to Reports** |

### Why the revenue KPI is wrong on the dashboard
1. **Not a staff task** — monthly revenue/commission is an owner/manager figure;
   staff take no action on it.
2. **Privacy / role** — it exposes total turnover + commission to anyone who opens
   the dashboard. This conflicts with the Fase B plan (PIN auth + sensitive-action
   gating). Financials belong on Reports, gated to managers.

---

## Proposed new dashboard layout

1. **Action Queue — "Tugas Hari Ini"** (replaces the volume chart as the hero block)
   Clickable rows, each `data-action="open-rental"`, showing a count + opening the
   rental detail to be worked. Hide a row when its count is 0.

   | Row | Source | Meaning |
   |-----|--------|---------|
   | 🔴 Jatuh tempo / telat | active + `isEstimateExpired(finishDate)` (+ 11:00 cut-off) | Motor harus di-checkout hari ini / sudah lewat |
   | 🟡 Menunggu pembayaran | `RentalManager.awaitingPayment()` | Sudah returned, belum dibayar |
   | 🔵 Menunggu settle owner | `RentalManager.awaitingOwnerSettle()` | Sudah dibayar, owner belum disettle |
   | 🟠 Damage belum beres | `RentalManager.damagePending()` | Ada kerusakan belum di-resolve |
   | 📘 Paspor dikembalikan | active + `passportHeld` | Paspor jaminan menunggu dikembalikan |

   Merge today's existing expired-estimate banner into the 🔴 row (avoid duplication).

2. **Slim status strip** (small KPIs that ARE operational)
   - Tersedia (motors available) — for walk-ins.
   - Motor disewa (count, no % ).
   - Rental aktif (count).

3. **Active Rentals list** — keep (recent active, click→detail).

### Moved to Reports (not deleted — just re-homed to the right audience)
- Volume chart (14-day trend).
- Top Motors by revenue.
- Monthly revenue + commission KPI.
- (Optional) By-category fleet mix.

---

## Open decisions (confirm before building)
1. ~~Today's-revenue number?~~ → **decided: NO money at all on the dashboard.**
   All financial figures (revenue, commission, PTO, damage) live on Reports only,
   to be role-gated to managers in Fase B.
2. ~~By-category~~ → **decided: keep on dashboard** (encodes the priority rule).
3. ~~Action Queue ordering~~ → **decided: fixed priority**, top to bottom:
   🔴 jatuh tempo/telat → 🟡 menunggu bayar → 🔵 settle owner → 🟠 damage → 📘 paspor.
   A row is hidden when its count is 0. Most-urgent always on top (not by count).

---

## Related feature: fair rental allocation (separate from dashboard)

Two-tier rental priority:
- **Tier 1 — category:** Properti (A) → Staf (B) → Non-staf (C). Already the rule;
  the by-category widget visualizes it.
- **Tier 2 — within Staf motors:** when several staff own different motor counts
  (e.g. A=5, B=3, C=1), which staff's motor to rent next, fairly?

"Fewest motors owned" is a static proxy that breaks for the 3-vs-5 middle and over
time (it would rent C's single motor to death). The fix is to sort by a **dynamic
fairness metric** that updates with actual usage, not by raw ownership count.

### Decided
- **Ownership:** staff buy their own motors → fairness is **asset-proportional**.
- **Metric: least-recently-rented (LRU) per motor.** Each motor competes by idle
  time, so a staff with 5 motors earns ~5× one with 1 — proportional to investment.
- **Enforcement: soft recommendation** (sort + "⭐ disarankan" badge), never a hard
  lock. Customer can still request a specific bike; staff override freely.

> Note: this intentionally **replaces** the old "fewest-motors-first" habit (that was
> income-equality logic). With staff-owned motors, equal *per-motor* turns is the fair
> rule; the 1-motor owner still gets their proportional 1/9 share, just no special
> priority.

### Algorithm (Tier 2 sort, applied to the new-rental motor picker)
Runs **after** the form's existing filters (cc, surfrack) and **within** the category
priority — it never lifts a Non-staf motor above an available Properti one.

1. Candidates = available motors matching the current filter.
2. For each, compute `lastRentedAt` = latest rental date for that `motorId`
   (`actualFinishDate` or `createdAt`); never-rented = epoch 0 (treated as most idle).
3. Sort by **(category rank A→B→C, then lastRentedAt ascending)** — longest-idle first
   within each tier.
4. Badge the top candidate "⭐ disarankan"; staff may pick any other.

All derivable from existing rental data (`motorId`, dates) — **no schema change**.

### Where it lives
The new-rental form motor picker in `modules/ui/forms.js` (`openRentalForm`) — a
separate change from the dashboard revamp, but recorded here since it shares the
category-priority rule.

## Implementation plan (phased)

Two independent workstreams. **A (dashboard)** is the priority; **B (allocation)**
can follow later. Each part is small and shippable on its own. Pure-logic parts are
unit-tested in Node (isolated copy, like the WA-receipt work); UI parts are
browser-QA only.

### Workstream A — Dashboard revamp

**A1 · Data layer (pure, Node-testable)**
- Add `RentalManager.dueOrOverdue()` → active rentals whose `finishDate` estimate has
  passed (reuse `isEstimateExpired`; factor in the 11:00 cut-off for "due today").
- Add `RentalManager.passportsToReturn()` → `active().filter(r => r.passportHeld)`.
- Add aggregator `RentalManager.actionQueue()` → returns the 5 buckets (items + count)
  in fixed priority order. Reuses existing `awaitingPayment` / `awaitingOwnerSettle` /
  `damagePending`.
- Tests: counts/membership for each bucket; cancelled excluded; 0-count buckets present
  but empty.

**A2 · Action Queue UI (browser)**
- Render the queue block in `pages/dashboard.js` as the hero (replaces the volume
  chart slot). Rows use `list-item` + `data-action="open-rental"` (wiring already
  exists). Hide rows with count 0.
- Merge the existing expired-estimate banner ([dashboard.js:33]) into the 🔴 row to
  avoid duplication.

**A3 · Slim status strip (browser)**
- Reduce the KPI row to operational counts only: **Tersedia**, **Motor disewa** (no %),
  **Rental aktif**. Remove the **Pendapatan + Komisi** KPI entirely (no money).

**A4 · Move analytics to Reports (browser)**
- Add the 14-day **volume chart** and **Top Motors** rendering to `pages/reports.js`
  (logic already in `ReportEngine.rentalsByDay` / `topMotors` — reuse, just re-home).
- Remove volume chart + top motors from `pages/dashboard.js`.
- Keep **By-Category** on the dashboard (priority rule).

**A5 · i18n + QA**
- ID/EN strings for queue rows, status strip, moved-widget headers.
- Browser QA: empty state (no pending work), each bucket clickable → opens rental.

### Workstream B — Fair rental allocation (separate feature)

**B1 · Data layer (pure, Node-testable)**
- `MotorManager.lastRentedAt(motorId)` (or a rentals helper) → latest rental date for a
  motor (`actualFinishDate` || `createdAt`); never-rented = 0.
- `recommendMotorOrder(candidates)` → stable sort by **(category rank A→B→C, then
  lastRentedAt ascending)**; expose the top id as the recommendation.
- Tests: 5/3/1 ownership scenario converges to per-motor proportional turns; category
  rank never violated; never-rented sorts first within its tier.

**B2 · Motor-picker UI (browser)**
- In `openRentalForm` ([modules/ui/forms.js]) sort the motor options via
  `recommendMotorOrder` and badge the top one "⭐ disarankan". Soft only — any motor
  still selectable.

**B3 · i18n + QA**
- ID/EN for the badge + hint. Browser QA on the new-rental flow.

### Suggested order
A1 → A2 → A3 → A4 → A5, then B1 → B2 → B3. A1 and B1 are the safe, test-first starting
points for each workstream.

## Related
- Fase B role gating ([memory: phase-b-user-roles]) — financial widgets on Reports
  should be manager-only once roles land.
