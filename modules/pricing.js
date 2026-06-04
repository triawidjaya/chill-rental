// =============================================================
// modules/pricing.js
// Guest-facing booking price info (DISPLAY ONLY).
//
// IMPORTANT: This file does NOT change the existing rental price model.
// Actual rental cost is still driven by `motor.pricePerDay` and the
// auto-fill logic inside RentalManager.checkIn() — untouched.
//
// PRICE_BY_CC is used ONLY to show an indicative "price/day" to the guest
// on the public booking form, per the published rates from PIPES HOSTEL.
// At physical check-in, staff still set the final price from the motor.
// =============================================================

// Published per-CC rates shown to guests on the booking form (info only).
export const PRICE_BY_CC = {
  '110 - 125': 70000,
  '150': 150000,
};

// CC classes offered on the guest booking form — only those with a
// published public rate above. Other classes (155/160) stay staff-only
// via the existing manual check-in flow.
export const BOOKING_CC_OPTIONS = ['110 - 125', '150'];

// Fixed charges quoted in the agreement (display only — not auto-applied).
export const FIXED_CHARGES = {
  lostKey: 150000,
  lostHelmet: 150000,
};
