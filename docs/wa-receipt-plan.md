# WhatsApp Receipt / Invoice — Plan & Templates

Plain-text receipts that staff can **copy-paste straight into a WhatsApp chat**.
English language, narrow layout (fits a phone screen), uses WhatsApp markup
(`*bold*`, `_italic_`, ` ```mono``` `). No images, no PDF — just text.

---

## Plan notes (decisions)

### 1. When is the receipt generated?
Three stages, **one per lifecycle moment**:

| Stage | Trigger | Cost shown | Source fields |
|-------|---------|------------|----------------|
| **Booking Confirmation** | Booking approved | _Estimate_ | `startDate`, `finishDate`, `pricePerDay`, estimated `totalDays` |
| **Check-in** | Motor handed over (`checkIn`) | _Estimate_ | same as above + `staffGivesKey` |
| **Check-out (Final Invoice)** | Motor returned (`checkOut`) | **Final** | `actualFinishDate`, final `totalDays`, `totalCost`, `damageCharge`, `paymentMethod` |

### 2. Mandatory details
- **Damage**: if `newDamage` → show description + charge; otherwise print `No Damage`.
- **Passport status**: show **only** if the guest ever pledged a passport
  (`passportNo` set / `passportHeld` was ever true). On the final invoice show
  `Returned ✅` when `passportHeld === false` (released), else `Still held`.
- Always: guest name, motor (plate + description), rental period, day count, totals.

### 3. Unique invoice number
Yes — derived from the rental **id/token** so it is unique and traceable back to
the record. Suggested format:

```
CHILL-<SHORT>        e.g. rnt_lxk2p9_a3f8  ->  CHILL-LXK2P9
```

One number **per rental**; the stage (Confirmation / Check-in / Final) is shown as
the document title, not as a new number.

Helper:

```js
// Derive a human-friendly invoice no from a rental id/token.
export const invoiceNo = (rental) => {
  const core = (rental.id || '').split('_')[1] || (rental.id || '').slice(0, 6);
  return 'CHILL-' + core.toUpperCase();
};
```

---

## Templates

Copy-paste ready. `{placeholders}` map to rental fields (see mapping at the bottom).
Lines are kept short so they don't wrap awkwardly on a phone.

### A. Booking Confirmation (estimate)

```
*CHILL RENTAL*
_Booking Confirmed ✅_
━━━━━━━━━━━━━━━━
No   : {invoiceNo}
Guest: {guestName}

*Motorbike*
{motorPlate} — {motorDescription}

*Rental Period* (estimate)
In   : {startDate}
Out  : {finishDate}
Days : {totalDays} (est.)

*Estimated Cost*
Rate : {pricePerDay} / day
Total: *{totalCost}*  _(estimate)_
━━━━━━━━━━━━━━━━
Final amount is confirmed at
check-out (11 AM cut-off rule).
Thank you & ride safe! 🛵
```

### B. Check-in receipt (estimate)

```
*CHILL RENTAL*
_Check-in Receipt 🛵_
━━━━━━━━━━━━━━━━
No    : {invoiceNo}
Date  : {checkinDateTime}
Guest : {guestName}

*Motorbike*
{motorPlate} — {motorDescription}
Key   : {staffGivesKey}

*Rental Period* (estimate)
In    : {startDate}
Out   : {finishDate}
Days  : {totalDays} (est.)

*Estimated Cost*
Rate  : {pricePerDay} / day
Total : *{totalCost}*  _(estimate)_

{passportLine}
━━━━━━━━━━━━━━━━
Final amount confirmed at
check-out. Enjoy the ride! 🌴
```

### C. Check-out — Final Invoice

```
*CHILL RENTAL*
_FINAL INVOICE 🧾_
━━━━━━━━━━━━━━━━
No    : {invoiceNo}
Guest : {guestName}

*Motorbike*
{motorPlate} — {motorDescription}

*Rental Period*
In    : {startDate}
Out   : {actualFinishDate}
Days  : {totalDays}

*Charges*
Rate  : {pricePerDay} / day
Rental: {totalCost}
Damage: {damageLine}
━━━━━━━━━━━━━━━━
*TOTAL : {grandTotal}*
Payment: {paymentMethod}

{passportLine}
━━━━━━━━━━━━━━━━
Thank you! See you next time 🛵🌴
```

---

## Conditional line rules

**`{damageLine}`**
- If `newDamage` → `{damageCharge} — {damageDescription}`
- Else → `No Damage`

**`{passportLine}`** (omit the whole line if the guest never pledged a passport)
- Final invoice, released → `Passport: Returned ✅`
- Still held → `Passport: Still held ⚠`
- Check-in, held → `Passport: Held as guarantee`

---

## Worked example (Final Invoice)

```
*CHILL RENTAL*
_FINAL INVOICE 🧾_
━━━━━━━━━━━━━━━━
No    : CHILL-LXK2P9
Guest : John Smith

*Motorbike*
DK 1234 AB — Honda Scoopy 2022

*Rental Period*
In    : 28 May 2026
Out   : 03 Jun 2026
Days  : 6

*Charges*
Rate  : Rp 70.000 / day
Rental: Rp 420.000
Damage: Rp 150.000 — scratched left mirror
━━━━━━━━━━━━━━━━
*TOTAL : Rp 570.000*
Payment: Cash

Passport: Returned ✅
━━━━━━━━━━━━━━━━
Thank you! See you next time 🛵🌴
```

And the same invoice with no damage and no passport pledged:

```
*CHILL RENTAL*
_FINAL INVOICE 🧾_
━━━━━━━━━━━━━━━━
No    : CHILL-LXK2P9
Guest : Jane Doe

*Motorbike*
DK 5678 CD — Yamaha NMAX 2023

*Rental Period*
In    : 01 Jun 2026
Out   : 04 Jun 2026
Days  : 3

*Charges*
Rate  : Rp 100.000 / day
Rental: Rp 300.000
Damage: No Damage
━━━━━━━━━━━━━━━━
*TOTAL : Rp 300.000*
Payment: QRIS
━━━━━━━━━━━━━━━━
Thank you! See you next time 🛵🌴
```

---

## Field mapping (for implementation)

| Placeholder | Source |
|-------------|--------|
| `{invoiceNo}` | `invoiceNo(rental)` helper above |
| `{guestName}` | `rental.guestName` |
| `{motorPlate}` | `rental.motorPlate` |
| `{motorDescription}` | `rental.motorDescription` |
| `{staffGivesKey}` | `rental.staffGivesKey` |
| `{startDate}` | `formatDate(rental.startDate)` |
| `{finishDate}` | `formatDate(rental.finishDate)` |
| `{actualFinishDate}` | `formatDate(rental.actualFinishDate)` |
| `{checkinDateTime}` | `formatDateTime(rental.createdAt)` |
| `{totalDays}` | `rental.totalDays` |
| `{pricePerDay}` | `formatIDR(rental.pricePerDay)` |
| `{totalCost}` | `formatIDR(rental.totalCost)` |
| `{damageCharge}` | `formatIDR(rental.damageCharge)` |
| `{damageDescription}` | `rental.damageDescription` |
| `{grandTotal}` | `formatIDR(getRentalGrandTotal(rental))` |
| `{paymentMethod}` | `rental.paymentMethod || '—'` |
| `{passportLine}` | derived from `rental.passportNo` / `rental.passportHeld` |

> Note: at the Booking/Check-in stage, `totalCost` is `0` in the stored record
> (only computed at check-out). For the estimate templates, compute it on the fly:
> `rental.pricePerDay * (estimated totalDays)`.

---

# Notification Flow — who gets what, and when

All notifications are **plain text + a Copy button**. Staff clicks Copy, then
pastes manually into the right WhatsApp chat (guest chat or owner chat). Nothing
is sent automatically.

Two audiences:
- 👤 **Guest (penyewa)** — receipts, reminders, passport status.
- 🏍 **Owner (pemilik motor)** — when their motor goes out, comes back, and when
  they get paid (settlement). Owners care about *their PTO money* and *their bike*,
  not the guest's rental price.

## Lifecycle timeline

```
  BOOKING        CHECK-IN         (rental running)        CHECK-OUT        PAID         OWNER-SETTLED
 approved   ->   checkIn()   ->   reminders / passport ->  checkOut()  ->  markPaid()  -> markOwnerSettled()
    │               │                    │                     │             │                │
  👤 confirm     👤 receipt          👤 reminder            👤 INVOICE     👤 paid ✅       🏍 settlement
                 🏍 "rented"        👤 passport held       🏍 "returned"                    receipt
                                                           🏍 damage*
   (* damage notice only if newDamage = true)
```

## Flow table

| # | Moment | Code trigger | 👤 Guest | 🏍 Owner | Priority |
|---|--------|--------------|----------|----------|----------|
| 1 | Booking approved | _(manual — no state in code yet)_ | **Booking Confirmation** (estimate) | — | Optional |
| 2 | Check-in | `checkIn()` | **Check-in Receipt** (estimate) | **Motor Rented Out** notice | **Must** |
| 3 | Passport pledged | `holdPassport()` | Passport-held confirmation | — | Optional |
| 4 | Estimate past due / cut-off | dashboard alert | Reminder to extend/return | — | Optional |
| 5 | Check-out | `checkOut()` | **Final Invoice** | **Motor Returned** notice (incl. PTO due) | **Must** |
| 6 | Damage found | `checkOut()` w/ `newDamage` | _(shown inside the invoice)_ | **Damage Notice** | **Must (if damage)** |
| 7 | Payment received | `markPaid()` | Payment confirmation / thank-you | — | Optional¹ |
| 8 | Owner settled | `markOwnerSettled()` | — | **Settlement Receipt** (PTO paid) | **Must** |
| 9 | Passport returned | `releasePassport()` | Passport-returned confirmation | — | Optional |
| 10 | Cancelled | `cancel()` | Cancellation notice | Cancellation notice | Optional |

¹ Payment usually happens at check-out, so the *paid* state can simply be stamped
onto the Final Invoice (`Payment: Cash`) instead of being a separate message.

## Recommended minimum set (v1)

If you want the smallest useful set of Copy buttons, ship these four:
- 👤 **Check-in Receipt** (moment 2)
- 👤 **Final Invoice** (moment 5)
- 🏍 **Motor Returned + PTO** (moment 5)
- 🏍 **Settlement Receipt** (moment 8)

Everything else (booking confirm, reminders, passport, cancellation) is a nice-to-have
layer you can add later.

---

## Owner templates

### O1. Motor Rented Out (at check-in)

```
*CHILL RENTAL — Owner Update*
_Your motorbike is rented out 🏍_
━━━━━━━━━━━━━━━━
Ref   : {invoiceNo}
Bike  : {motorPlate} — {motorDescription}

Out   : {startDate}
Est.  : {finishDate} ({totalDays} days)
PTO   : {payToOwnerPerDay} / day

We'll update you at return.
```

### O2. Motor Returned (at check-out)

```
*CHILL RENTAL — Owner Update*
_Your motorbike is back ✅_
━━━━━━━━━━━━━━━━
Ref   : {invoiceNo}
Bike  : {motorPlate} — {motorDescription}

In    : {startDate}
Out   : {actualFinishDate}
Days  : {totalDays}

*Your share (PTO)*
{payToOwnerPerDay} x {totalDays}
= *{payToOwner}*
{damageOwnerLine}
━━━━━━━━━━━━━━━━
We'll arrange the handover soon.
```

### O3. Settlement Receipt (owner paid)

```
*CHILL RENTAL — Settlement*
_Payout completed ✅_
━━━━━━━━━━━━━━━━
Ref   : {invoiceNo}
Bike  : {motorPlate} — {motorDescription}
Date  : {settledDateTime}

Amount paid to you:
*{payToOwner}*

Thank you for partnering with us! 🙏
```

**`{damageOwnerLine}`** (O2 only)
- If `newDamage` → `⚠ Damage logged: {damageDescription}`
- Else → omit the line.

### Extra field mapping (owner templates)

| Placeholder | Source |
|-------------|--------|
| `{payToOwnerPerDay}` | `formatIDR(rental.payToOwnerPerDay)` |
| `{payToOwner}` | `formatIDR(rental.payToOwner)` |
| `{settledDateTime}` | `formatDateTime(rental.ownerSettledAt)` |

---

# Implementation steps

## Decisions locked
- **Format:** monospace block (wrapped in ` ``` `), 8-char label column, ≤26 chars/line.
- **Language:** guest = English, owner = Bahasa Indonesia.
- **UI:** read-only preview + **Copy** button + **Open WA** button.
  - Guest → Copy + Open WA (uses `rental.wa`).
  - Owner → Copy only (no owner phone in the model yet).
- **Invoice no:** `CHILL-<token>` derived from `rental.id`.
- **v1 scope:** 4 messages — guest check-in, guest invoice, owner returned, owner settlement.

## Step 1 — `modules/receipts.js` (pure builders, no DOM)
Easiest to unit-test in `smoke-test.html`. Exports:
- `invoiceNo(rental)` — `CHILL-` + middle token of `rental.id`, uppercased.
- Conditional helpers: `damageLine(rental)`, `damageOwnerLine(rental)`, `passportLine(rental, stage)`.
- `estimateCost(rental)` — `pricePerDay × estimate days` (check-in stage; stored `totalCost` is 0 until check-out).
- Builders returning the full monospace string (incl. the ` ``` ` fences):
  `buildGuestCheckin(r)`, `buildGuestInvoice(r)`, `buildOwnerReturned(r)`, `buildOwnerSettlement(r)`.
- A registry mapping stage → `{ build, audience: 'guest'|'owner', waField }` so the UI stays generic.

## Step 2 — WA + clipboard helpers in `modules/utils.js`
- `normalizeWa(num)` — strip non-digits; leading `0` → `62`; drop `+`.
- `waLink(num, text)` — `https://wa.me/${normalizeWa(num)}?text=${encodeURIComponent(text)}`.
- `copyText(text)` — `navigator.clipboard.writeText` with a `<textarea>` + `execCommand` fallback (file:// / older browsers).

## Step 3 — Receipt modal in `modules/ui/` (reuse `Modal` from notify.js)
`showReceiptModal({ title, subtitle, text, waNumber })`:
- Body: read-only `<pre class="wa-preview">` showing `text` (verification only — editing happens in WA).
- Footer: **Copy** (→ `copyText` + `Toast.success`) and, when `waNumber` present, **Open WA** (→ `window.open(waLink(...), '_blank')`).

## Step 4 — Wire buttons into `openRentalDetail()` ([forms.js:249](../modules/ui/forms.js#L249))
Show contextually by status:
- `status === 'active'` → **WA Check-in** (guest).
- `status === 'returned'` → **WA Invoice** (guest) + **WA Owner: Returned**.
- `ownerSettled` → **WA Settlement** (owner).
Each click → build the string → `showReceiptModal(...)` with `rental.wa` for guest messages.

## Step 5 — i18n strings in `modules/i18n.js`
Button labels, modal titles, and toast text (`receipt_copied`, etc.) in both ID and EN.

## Step 6 — Tests in `smoke-test.html`
Assert builder output for: invoice-no derivation, damage vs `No Damage`, passport line present/omitted, estimate-cost math, and `normalizeWa` cases (`08xx` → `628xx`, `+62`, spaces/dashes).

## Step 7 — Manual QA
Serve locally, open a real rental, and **paste into an actual WhatsApp chat on a phone** to confirm the monospace columns line up.

## Out of scope (later)
- Owner phone field → enable Open WA for owners.
- Extra messages: booking confirmation, cut-off reminder, passport held/returned, cancellation.
