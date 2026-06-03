// =============================================================
// modules/receipts.js
// Plain-text WhatsApp receipt builders (Step 1).
// Pure string functions — NO DOM, NO state. Easy to unit-test.
//
// Output is a monospace WhatsApp block (wrapped in ``` fences) so the
// columns line up on a phone. Guest messages are in English, owner
// messages in Bahasa Indonesia (owners are local).
// =============================================================

import { formatIDR, formatDate, formatDateTime } from './utils.js';
import { getRentalGrandTotal, getOwnerPayout } from './rentals.js';

// ---- Layout primitives -------------------------------------------------
const LABEL_W = 8;                       // label column width before ": "
const INDENT = ' '.repeat(LABEL_W + 2);  // indent for wrapped value lines
const DIV = '──────────────────';        // section divider (U+2500 ×18)

// "Label   : value", label padded to a fixed column so colons align.
const row = (label, value) => `${String(label).padEnd(LABEL_W)}: ${value}`;

// Join parts into a fenced monospace block. Nested arrays are flattened;
// null/undefined entries are dropped (so conditional lines can be omitted).
// Empty strings are kept (intentional blank lines).
const wrap = (parts) =>
  '```\n' +
  parts.flat(Infinity).filter((l) => l !== null && l !== undefined).join('\n') +
  '\n```';

// ---- English date formatting (guest receipts) --------------------------
// utils.formatDate uses the id-ID locale ("25 Mei 2026"); guest messages
// are English, so format dates here with en-GB ("25 May 2026", 24h time).
const fmtDateEN = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtDateTimeEN = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
};

// ---- Public helpers ----------------------------------------------------

/**
 * Unique, human-friendly invoice number derived from the rental id/token.
 *   "rnt_lxk2p9_a3f8" -> "CHILL-LXK2P9"
 * One number per rental; the same number is used across all of its messages.
 */
export const invoiceNo = (rental) => {
  const id = (rental && rental.id) || '';
  const core = id.split('_')[1] || id.slice(0, 6) || 'XXXXXX';
  return 'CHILL-' + core.toUpperCase();
};

/** Estimated day count for the pre-checkout stages (0 if no estimate set). */
export const estimateDays = (rental) =>
  rental && rental.totalDays > 0 ? rental.totalDays : 0;

/**
 * Estimated cost at the check-in/booking stage. The stored totalCost is 0
 * until check-out, so compute it on the fly: pricePerDay × estimated days.
 */
export const estimateCost = (rental) =>
  (rental.pricePerDay || 0) * estimateDays(rental);

// Did the guest ever pledge a passport on this rental?
const passportPledged = (r) =>
  !!(r.passportNo || r.passportHeld || r.passportHeldAt || r.passportReleasedAt);

// Passport status row, or null when the guest never pledged a passport.
const passportRow = (r, stage) => {
  if (!passportPledged(r)) return null;
  if (stage === 'checkin') {
    return r.passportHeld ? row('Passport', 'Held (guarantee)') : null;
  }
  // invoice / final stage
  return row('Passport', r.passportHeld ? 'Still held' : 'Returned');
};

// Bike identity: plate on the row, description on an indented second line.
const bikeLines = (r, label) => [
  row(label, r.motorPlate || '—'),
  r.motorDescription ? INDENT + r.motorDescription : null,
];

// Guest invoice "Damage" line(s): charge + description, or "No Damage".
const damageLines = (r) => {
  if (!r.newDamage) return [row('Damage', 'No Damage')];
  return [
    row('Damage', formatIDR(r.damageCharge)),
    r.damageDescription ? INDENT + r.damageDescription : null,
  ];
};

// Owner "your share" block. The owner receives rental PTO + damage recovery,
// so itemize PTO + Damage + Total whenever there is damage.
const ownerShareLines = (r) => {
  if (!r.newDamage) {
    return [
      'BAGIAN ANDA',
      `${formatIDR(r.payToOwnerPerDay)} x ${r.totalDays ?? 0}`,
      `= ${formatIDR(r.payToOwner)}`,
    ];
  }
  return [
    'BAGIAN ANDA',
    row('Sewa', formatIDR(r.payToOwner)),
    INDENT + `(${formatIDR(r.payToOwnerPerDay)} x ${r.totalDays ?? 0})`,
    row('Damage', formatIDR(r.damageCharge)),
    r.damageDescription ? INDENT + `(${r.damageDescription})` : null,
    row('TOTAL', formatIDR(getOwnerPayout(r))),
  ];
};

// Owner "amount paid to you" block (settlement).
const ownerSettleLines = (r) => {
  if (!r.newDamage) {
    return ['Dibayar ke Anda', `= ${formatIDR(r.payToOwner)}`];
  }
  return [
    'Dibayar ke Anda',
    row('Sewa', formatIDR(r.payToOwner)),
    row('Damage', formatIDR(r.damageCharge)),
    row('TOTAL', formatIDR(getOwnerPayout(r))),
  ];
};

// ---- Builders ----------------------------------------------------------

/** 👤 Check-in receipt (estimate) — English. */
export function buildGuestCheckin(r) {
  const days = estimateDays(r);
  return wrap([
    'CHILL RENTAL · CHECK-IN',
    row('No', invoiceNo(r)),
    row('Date', fmtDateTimeEN(r.createdAt)),
    row('Guest', r.guestName || '—'),
    bikeLines(r, 'Bike'),
    r.staffGivesKey ? row('Key', r.staffGivesKey) : null,
    DIV,
    'PERIOD (estimate)',
    row('In', fmtDateEN(r.startDate)),
    row('Out', fmtDateEN(r.finishDate)),
    row('Days', days > 0 ? `${days} (est.)` : '—'),
    DIV,
    row('Rate', `${formatIDR(r.pricePerDay)}/day`),
    row('Est.Tot', days > 0 ? formatIDR(estimateCost(r)) : '—'),
    passportRow(r, 'checkin'),
    DIV,
    'Final amount at check-out.',
    'Enjoy the ride!',
  ]);
}

/** 👤 Final invoice (after check-out) — English. */
export function buildGuestInvoice(r) {
  return wrap([
    'CHILL RENTAL · INVOICE',
    row('No', invoiceNo(r)),
    row('Guest', r.guestName || '—'),
    bikeLines(r, 'Bike'),
    DIV,
    'PERIOD',
    row('In', fmtDateEN(r.startDate)),
    row('Out', fmtDateEN(r.actualFinishDate)),
    row('Days', String(r.totalDays ?? '—')),
    DIV,
    row('Rate', `${formatIDR(r.pricePerDay)}/day`),
    row('Rental', formatIDR(r.totalCost)),
    damageLines(r),
    DIV,
    row('TOTAL', formatIDR(getRentalGrandTotal(r))),
    row('Payment', r.paymentMethod || '—'),
    passportRow(r, 'invoice'),
    DIV,
    'Thank you! See you',
    'next time. 🌴',
  ]);
}

/** 🏍 Owner notice — motor returned + PTO share (Bahasa Indonesia). */
export function buildOwnerReturned(r) {
  return wrap([
    'CHILL RENTAL · INFO PEMILIK',
    'Motor kembali',
    '',
    row('Ref', invoiceNo(r)),
    bikeLines(r, 'Motor'),
    DIV,
    row('Mulai', formatDate(r.startDate)),
    row('Selesai', formatDate(r.actualFinishDate)),
    row('Hari', String(r.totalDays ?? '—')),
    DIV,
    ownerShareLines(r),
    DIV,
    'Serah terima menyusul.',
  ]);
}

/** 🏍 Owner settlement receipt — payout done (Bahasa Indonesia). */
export function buildOwnerSettlement(r) {
  return wrap([
    'CHILL RENTAL · SETTLEMENT',
    'Pembayaran selesai',
    '',
    row('Ref', invoiceNo(r)),
    bikeLines(r, 'Motor'),
    row('Tanggal', formatDateTime(r.ownerSettledAt)),
    DIV,
    ownerSettleLines(r),
    DIV,
    'Terima kasih atas',
    'kerja samanya!',
  ]);
}

// ---- Stage registry (keeps the future UI generic) ----------------------
// audience drives which buttons show; waField is the rental field holding
// the recipient's WhatsApp number (null = no deep-link, Copy only).
export const RECEIPTS = {
  'guest-checkin':    { audience: 'guest', waField: 'wa',  build: buildGuestCheckin },
  'guest-invoice':    { audience: 'guest', waField: 'wa',  build: buildGuestInvoice },
  'owner-returned':   { audience: 'owner', waField: null,  build: buildOwnerReturned },
  'owner-settlement': { audience: 'owner', waField: null,  build: buildOwnerSettlement },
};
