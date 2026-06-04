// =============================================================
// modules/allocation.js
// Fair rental-allocation helpers (PURE — no DOM, no state imports).
//
// Recommends which motor to rent next:
//   1. category priority — Properti (A) → Staf (B) → Non-staf (C)
//   2. within a category, least-recently-rented (LRU) first
//
// LRU gives each motor proportional turns over time, so a staff who bought 5
// motors earns ~5× one who bought 1 — fair to their investment — while nobody
// is starved. Applied as a SOFT recommendation (sort + badge); staff can still
// pick any motor, and the category rule is never violated.
// =============================================================

const CATEGORY_RANK = { A: 0, B: 1, C: 2 };

/**
 * Latest real rental timestamp (ms) for a motor — used as its "last used" time.
 * Never-rented returns 0 (treated as the most idle → highest priority).
 * Cancelled rentals don't count (the motor was never actually used).
 *
 * @param {string} motorId
 * @param {Array} rentals  full rentals list
 * @returns {number} epoch ms, or 0
 */
export const lastRentedAt = (motorId, rentals = []) => {
  let latest = 0;
  for (const r of rentals) {
    if (!r || r.motorId !== motorId || r.status === 'cancelled') continue;
    const ts = new Date(r.actualFinishDate || r.createdAt || 0).getTime();
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  return latest;
};

/**
 * Order candidate motors by recommendation: category rank (A→B→C), then
 * least-recently-rented (longest idle first). Stable for exact ties.
 *
 * @param {Array} motors   candidate (available, already filtered) motors
 * @param {Array} rentals  full rentals list
 * @returns {Array} motors, best recommendation first
 */
export const recommendMotorOrder = (motors = [], rentals = []) => {
  return motors
    .map(m => ({ m, rank: CATEGORY_RANK[m.category] ?? 9, last: lastRentedAt(m.id, rentals) }))
    .sort((a, b) => (a.rank - b.rank) || (a.last - b.last))
    .map(x => x.m);
};

/** The single recommended motor id (top of the order), or null when no candidates. */
export const recommendedMotorId = (motors = [], rentals = []) => {
  const ordered = recommendMotorOrder(motors, rentals);
  return ordered.length ? ordered[0].id : null;
};
