// =============================================================
// modules/terms.js
// Rental Terms & Conditions (binding) + riding Tips (info only).
//
// These are presented in the name of the PROPERTY (PIPES HOSTEL), not the
// platform. English only — they are NOT routed through i18n.
//
//   TERMS  -> the binding agreement the guest must accept before booking.
//   TIPS   -> non-binding advice, shown below the agreement and reused in
//             the WhatsApp confirmation message. NOT part of the agreement.
//
// Bump TERMS.version whenever the wording changes — each booking stores the
// version the guest agreed to (agreedTermsVersion) so consent stays auditable.
// =============================================================

export const PROPERTY_NAME = 'PIPES HOSTEL';

export const TERMS = {
  version: 'v1',
  updatedAt: '2026-06-04',
  title: 'PIPES HOSTEL — Motorbike Rental Terms & Conditions',
  // Binding clauses only (no tips). Rendered as a scrollable agreement.
  body: `• The cost of renting a motorcycle is 70,000 Rp (110-125cc) per day, 150,000 Rp (150cc) per day.

• We only accept payment at the end of the rental period and not before.

• The motorcycle is the guest's responsibility from the start of rental until the keys are given back at the end of the rental period. Please be aware our motorcycles have no insurance, therefore damaged and lost (stolen) bikes are the guest's responsibility to replace.

• IT IS NOT a 24-hour rental. Days are counted per date, but if the bike is handed back before 11am then that date is not counted.

• If you hand your motorcycle key back after 11am you will be charged for this date also.

• Damage (due to falling, crashing, etc.), flat tires and missing (stolen) motorcycles are the responsibility of the person renting the bike.

• However much the cost to repair or replace the motorcycle is, it is the responsibility of the person renting. The person renting can choose a mechanic to carry out any repairs or can pay the cost of the damage to the motorcycle owner.

• Lost keys are charged at 150,000 Rp.

• We can provide FREE HELMETS, but if lost the charge is 150,000 Rp.

• If the motorcycle breaks down or you lose a key, PLEASE DON'T JUST LEAVE THE BIKE — call us and we will organize help.`,
};

// Non-binding riding tips. English only. Reused on the guest page (below the
// agreement, outside the consent checkbox) and in the WA confirmation.
export const TIPS = [
  'When visiting the beaches, always park in the designated parking area and pay the parking fee (usually 5,000 or 10,000).',
  'Do not leave the motorcycle at the beach or party overnight.',
  'When driving late at night, put any bags you have under the seat.',
];
