// =============================================================
// modules/rentals.js
// RentalManager — core transaction logic
// States: active -> completed | cancelled
// =============================================================

import { state } from './state.js';
import { uid, daysBetween, calcRentalDays, formatDate, isEstimateExpired } from './utils.js';
import { MotorManager, MotorStatus } from './motors.js';
import { t } from './i18n.js';
// OwnerManager is no longer imported after R3 (PTO moved to the motor)
import { AuditManager, AuditEntities, AuditActions } from './audit.js';

const rentalLabel = (r) => r ? `${r.guestName} · ${r.motorPlate || ''}` : '(unknown)';

/**
 * Total the guest must pay = rental cost + damage recovery (if any).
 * Kept separate from totalCost so financial reports can still distinguish
 * rental revenue from damage recovery.
 */
export const getRentalGrandTotal = (r) => {
  if (!r) return 0;
  return (r.totalCost || 0) + (r.newDamage ? (r.damageCharge || 0) : 0);
};

/**
 * Total the motor owner receives = rental PTO + damage recovery (if any).
 * The damaged motor is the owner's asset, so the damage compensation is
 * passed through to the owner — it is NOT kept by the company. The company
 * keeps only its rental commission (totalCost − payToOwner).
 */
export const getOwnerPayout = (r) => {
  if (!r) return 0;
  return (r.payToOwner || 0) + (r.newDamage ? (r.damageCharge || 0) : 0);
};

// Channel a rental originated from. Auto-derived at check-in (never staff-chosen):
//   'online'  — converted from a confirmed online booking (carries a bookingId)
//   'walk-in' — created directly via the manual "Rental Baru" form
export const RentalSource = {
  ONLINE: 'online',
  WALKIN: 'walk-in',
};

export const RentalStatus = {
  ACTIVE: 'active',
  RETURNED: 'returned',     // R6/R7: motor physically returned, final cost computed
  COMPLETED: 'completed',   // legacy — auto-migrated to returned, do not use in new code
  CANCELLED: 'cancelled',
};

/**
 * Compute the multi-flag badge for a rental.
 * Returns { primary, secondary?, fullyDone }
 *   - primary: main badge based on lifecycle (Active / Awaiting Payment / Awaiting Settle / Done / Cancelled)
 *   - secondary: extra badge (e.g. 'Damage Pending') — optional
 *   - fullyDone: true when all flags are complete (used to hide the 3 action buttons in R8)
 */
export function getRentalBadge(r) {
  if (!r) return { primary: { label: '—', cls: '' }, fullyDone: false };
  const isReturned = r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED;

  // Cancelled
  if (r.status === RentalStatus.CANCELLED) {
    return { primary: { label: '⚪ Dibatalkan', cls: 'badge--danger' }, fullyDone: true };
  }

  // Active
  if (r.status === RentalStatus.ACTIVE) {
    if (r.suspectedDamage) {
      return {
        primary: { label: '🟢 Aktif', cls: 'badge--success' },
        secondary: { label: '⚠ Cek Damage', cls: 'badge--warning' },
        fullyDone: false,
      };
    }
    return { primary: { label: `🟢 ${t('badge_active')}`, cls: 'badge--success' }, fullyDone: false };
  }

  // Returned — check the 3 flags
  if (isReturned) {
    const secondary = (r.newDamage && !r.damageResolved)
      ? { label: `🟠 ${t('badge_damage_pending')}`, cls: 'badge--warning' }
      : null;

    if (!r.paid) {
      return { primary: { label: `🟡 ${t('badge_awaiting_payment')}`, cls: 'badge--warning' }, secondary, fullyDone: false };
    }
    if (!r.ownerSettled) {
      return { primary: { label: `🔵 ${t('badge_settle_owner') || 'Menunggu Settle Owner'}`, cls: 'badge--brand' }, secondary, fullyDone: false };
    }
    if (secondary) {
      return { primary: { label: `🟠 ${t('badge_damage_pending')}`, cls: 'badge--warning' }, fullyDone: false };
    }
    return { primary: { label: `✅ ${t('badge_completed')}`, cls: '' }, fullyDone: true };
  }

  // Fallback
  return { primary: { label: r.status || '—', cls: '' }, fullyDone: false };
}

// HTML-ready helper
export function renderRentalBadge(r) {
  const b = getRentalBadge(r);
  let html = `<span class="badge ${b.primary.cls}">${b.primary.label}</span>`;
  if (b.secondary) html += ` <span class="badge ${b.secondary.cls}">${b.secondary.label}</span>`;
  return html;
}

export const RentalManager = {
  list() {
    return state.get('rentals') || [];
  },

  get(id) {
    return state.find('rentals', id);
  },

  active() {
    return this.list().filter(r => r.status === RentalStatus.ACTIVE);
  },

  // R6/R7: "completed" semantics = already returned (legacy 'completed' is included too).
  // For specific UI filters (e.g. awaiting payment), use the newer R7 helpers.
  completed() {
    return this.list().filter(r =>
      r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED
    );
  },

  returned() {
    return this.list().filter(r =>
      r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED
    );
  },

  /**
   * Check-in / new rental.
   * Motor is immediately set to status=rented.
   * finishDate is OPTIONAL (an estimate only).
   * Cost is NOT computed here — only at actual check-out.
   */
  checkIn({
    guestName,
    wa = '',
    email = '',
    passportNo = '',
    startDate, finishDate = null, // ISO datetime — finish is optional/estimated
    motorId,
    pricePerDay,
    payToOwner,
    staffGivesKey,
    paymentMethod = '',           // R5: payment method is chosen at check-out, not check-in
    notes = '',
    source = RentalSource.WALKIN, // origination channel — auto-set by the caller, not staff
  }) {
    const motor = MotorManager.get(motorId);
    if (!motor) throw new Error(t('err_motor_not_found'));
    if (motor.status === MotorStatus.RENTED) throw new Error(t('err_motor_rented'));

    const ppd = Number(pricePerDay) || motor.pricePerDay || 70000;
    // PTO per day (rate). Source priority (R3):
    //   1. payToOwner argument (if passed explicitly)
    //   2. motor.payToOwnerPerDay (main source after R1 — PTO moved to the motor)
    //   3. fallback: pricePerDay × 0.71 (50k/70k ratio)
    const ptoPerDay = (payToOwner != null && payToOwner !== '' && !isNaN(Number(payToOwner)))
      ? Number(payToOwner)
      : (motor.payToOwnerPerDay != null && !isNaN(Number(motor.payToOwnerPerDay)))
        ? Number(motor.payToOwnerPerDay)
        : Math.round(ppd * 0.71);

    // Estimated days are display-only (when finishDate is provided)
    const estimateDays = finishDate ? calcRentalDays(startDate, finishDate) : 0;

    const rental = {
      id: uid('rnt'),
      guestName: (guestName || '').trim(),
      wa: (wa || '').trim(),
      email: (email || '').trim(),
      passportNo: (passportNo || '').trim(),
      // Passport workflow (R1 — passport is held when the guest checks out of the property + extends)
      propertyCheckedOut: false,
      passportHeld: false,
      passportHeldAt: null,
      startDate,
      finishDate,            // ESTIMATE — reminder only
      actualFinishDate: null, // FINAL — filled at check-out, used to compute cost
      motorId,
      motorPlate: motor.plate,
      motorDescription: motor.description,
      ownerId: motor.ownerId,
      ownerName: motor.ownerName,
      pricePerDay: ppd,
      payToOwnerPerDay: ptoPerDay,  // per-day rate
      totalDays: estimateDays,       // estimate, updated at checkout
      totalCost: 0,                  // 0 until check-out
      payToOwner: 0,                 // 0 until check-out
      commission: 0,                 // 0 until check-out
      paymentMethod,
      staffGivesKey: (staffGivesKey || '').trim().toUpperCase(),
      staffReceivesKey: '',
      newDamage: false,
      damageDescription: '',
      damageCharge: 0,
      damageResolved: true,   // R7: no damage at check-in → resolved=true by default
      // Multi-flag status (R7)
      status: RentalStatus.ACTIVE,
      paid: false,
      paidAt: null,
      ownerSettled: false,
      ownerSettledAt: null,
      ownerPaid: false,       // backward-compat (to be removed once all UI uses ownerSettled)
      source,                 // 'online' | 'walk-in' — channel this rental came from
      notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    state.add('rentals', rental);
    MotorManager.setStatus(motorId, MotorStatus.RENTED, rental.id);
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rental.id,
      entityLabel: rentalLabel(rental), action: AuditActions.CHECK_IN,
      note: `start=${rental.startDate}${rental.finishDate ? ` · estimasi=${rental.finishDate}` : ''} · via=${rental.source}`,
    });
    return rental;
  },

  /**
   * Check-out — motor physically returned by the guest. Compute final cost with the 11 AM rule.
   * R6: status set to 'returned' (NOT 'completed').
   * The 'mark as paid' & 'mark owner settled' actions are separate actions in R8.
   */
  checkOut(rentalId, {
    actualFinishDate, staffReceivesKey,
    paymentMethod = '',
    newDamage = false, damageDescription = '', damageCharge = 0,
    checkoutReason = '',
    cutoffHour = 11,
  }) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (rental.status !== RentalStatus.ACTIVE) throw new Error(t('err_rental_not_active'));

    // Validate the actualFinishDate range
    const finish = actualFinishDate || new Date().toISOString();
    const finishMs = new Date(finish).getTime();
    const startMs  = new Date(rental.startDate).getTime();
    const nowMs    = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;
    if (finishMs < startMs) throw new Error(t('err_checkout_before_checkin'));
    if (finishMs > nowMs + twoHours) throw new Error(t('err_checkout_too_future'));

    // Apply the 11:00 AM cut-off rule
    const days = calcRentalDays(rental.startDate, finish, cutoffHour);
    const totalCost = rental.pricePerDay * days;
    // payToOwnerPerDay from the rate stored at check-in
    const ptoPerDay = rental.payToOwnerPerDay != null
      ? rental.payToOwnerPerDay
      : (rental.totalDays > 0 ? Math.round(rental.payToOwner / rental.totalDays) : 50000);
    const payToOwner = ptoPerDay * days;
    const commission = totalCost - payToOwner;

    state.update('rentals', rentalId, {
      actualFinishDate: finish,
      totalDays: days,
      totalCost,
      payToOwner,
      commission,
      staffReceivesKey: (staffReceivesKey || '').trim().toUpperCase(),
      paymentMethod: paymentMethod || rental.paymentMethod || '',
      checkoutReason: (checkoutReason || '').trim(),
      newDamage,
      damageDescription,
      damageCharge: Number(damageCharge) || 0,
      damageResolved: !newDamage,  // R7: auto-true if no damage; if there is damage, a separate action is needed
      status: RentalStatus.RETURNED,
      // paid, ownerSettled — STAY false, set via separate actions (R8)
    });

    MotorManager.setStatus(rental.motorId, MotorStatus.AVAILABLE, null);

    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: AuditActions.CHECK_OUT,
      note: `${days} hari · total ${totalCost.toLocaleString('id-ID')}${newDamage ? ' · ada kerusakan' : ''}${checkoutReason ? ` · alasan: ${checkoutReason}` : ''} · status: returned`,
    });

    // Record damage if any
    if (newDamage && damageDescription) {
      import('./damages.js').then(({ DamageManager }) => {
        DamageManager.create({
          rentalId,
          motorId: rental.motorId,
          motorPlate: rental.motorPlate,
          description: damageDescription,
          charge: Number(damageCharge) || 0,
          date: new Date().toISOString(),
        });
      });
    }
    return this.get(rentalId);
  },

  /**
   * R10 — Edit the details of an active rental (fix input mistakes).
   * Only allowed for status='active'. After returned/cancelled, it is immutable.
   * If motorId changes: old motor → available, new motor → rented (must be available first).
   */
  editRental(rentalId, patch) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (rental.status !== RentalStatus.ACTIVE) {
      throw new Error(t('err_only_active_editable'));
    }

    // Whitelist of editable fields (everything else is ignored for safety)
    const allowed = ['guestName', 'wa', 'email', 'startDate', 'finishDate', 'staffGivesKey', 'notes'];
    const safePatch = {};
    allowed.forEach(k => {
      if (k in patch) safePatch[k] = patch[k];
    });

    // Trim string fields
    ['guestName', 'wa', 'email', 'staffGivesKey', 'notes'].forEach(k => {
      if (typeof safePatch[k] === 'string') safePatch[k] = safePatch[k].trim();
    });
    if (safePatch.staffGivesKey) safePatch.staffGivesKey = safePatch.staffGivesKey.toUpperCase();

    // Handle motor swap
    if (patch.motorId && patch.motorId !== rental.motorId) {
      const newMotor = MotorManager.get(patch.motorId);
      if (!newMotor) throw new Error(t('err_replacement_motor_not_found'));
      if (newMotor.status === MotorStatus.RENTED) {
        throw new Error(t('err_motor_rented_pick_available', { plate: newMotor.plate }));
      }

      // Release the old motor
      MotorManager.setStatus(rental.motorId, MotorStatus.AVAILABLE, null);
      // Assign the new motor
      MotorManager.setStatus(newMotor.id, MotorStatus.RENTED, rentalId);

      // Update the motor info snapshot on the rental
      safePatch.motorId = newMotor.id;
      safePatch.motorPlate = newMotor.plate;
      safePatch.motorDescription = newMotor.description;
      safePatch.ownerId = newMotor.ownerId;
      safePatch.ownerName = newMotor.ownerName;
      safePatch.pricePerDay = newMotor.pricePerDay;
      safePatch.payToOwnerPerDay = newMotor.payToOwnerPerDay
        || Math.round((newMotor.pricePerDay || 70000) * 0.71);
    }

    state.update('rentals', rentalId, safePatch);
    AuditManager.logUpdate({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental),
      before: rental, patch: safePatch,
      note: 'edit detail rental (active)',
    });
    return this.get(rentalId);
  },

  cancel(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) return;

    // Guard: block if the motor has already been used >0 days
    const daysSoFar = calcRentalDays(rental.startDate, new Date().toISOString()) - 1;
    if (daysSoFar > 0) {
      throw new Error(t('err_motor_used_days', { days: daysSoFar, date: formatDate(rental.startDate) }));
    }

    state.update('rentals', rentalId, { status: RentalStatus.CANCELLED });
    MotorManager.setStatus(rental.motorId, MotorStatus.AVAILABLE, null);
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: AuditActions.CANCEL,
      note: 'dibatalkan sebelum motor digunakan',
    });
  },

  // =====================================================
  // R7 — Multi-flag actions (for the 3 buttons in R8)
  // =====================================================

  /**
   * Mark a rental as paid. Only allowed for status='returned' and paid=false.
   */
  markPaid(rentalId, { paymentMethod = '', amountReceived, adjustmentReason = '' } = {}) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    const isReturned = rental.status === RentalStatus.RETURNED || rental.status === RentalStatus.COMPLETED;
    if (!isReturned) throw new Error(t('err_rental_not_returned'));
    if (rental.paid) throw new Error(t('err_rental_already_paid'));
    if (rental.passportHeld) throw new Error(t('err_passport_still_held'));
    if (rental.newDamage && !rental.damageResolved) throw new Error(t('err_damage_unresolved_before_pay'));

    const grandTotal = getRentalGrandTotal(rental);
    const received   = amountReceived != null ? Number(amountReceived) : grandTotal;
    const difference = received - grandTotal;

    // If the amount differs, a reason is required
    if (difference !== 0 && !(adjustmentReason || '').trim()) {
      throw new Error(t('err_amount_mismatch_reason'));
    }

    const now = new Date().toISOString();
    state.update('rentals', rentalId, {
      paid: true,
      paidAt: now,
      paymentMethod: paymentMethod || rental.paymentMethod || '',
      amountReceived: received,
      amountDifference: difference,
      adjustmentReason: (adjustmentReason || '').trim(),
    });

    const diffLabel = difference !== 0
      ? ` · selisih: ${difference > 0 ? '+' : ''}${difference.toLocaleString('id-ID')} · alasan: ${adjustmentReason}`
      : '';
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'mark-paid',
      note: `metode: ${paymentMethod || '-'} · tagihan: ${grandTotal.toLocaleString('id-ID')} · diterima: ${received.toLocaleString('id-ID')}${diffLabel}`,
    });
    return this.get(rentalId);
  },

  /**
   * Mark the key & money as handed over to the owner. Requires: returned + paid.
   */
  markOwnerSettled(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (!rental.paid) throw new Error(t('err_settle_before_pay'));
    if (rental.ownerSettled) throw new Error(t('err_already_settled'));

    const now = new Date().toISOString();
    state.update('rentals', rentalId, {
      ownerSettled: true,
      ownerSettledAt: now,
      ownerPaid: true,  // backward-compat
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'mark-owner-settled',
      note: `owner: ${rental.ownerName || '-'} · pto: ${(rental.payToOwner || 0).toLocaleString('id-ID')}`
        + (rental.newDamage ? ` · damage: ${(rental.damageCharge || 0).toLocaleString('id-ID')} · total: ${getOwnerPayout(rental).toLocaleString('id-ID')}` : ''),
    });
    return this.get(rentalId);
  },

  /**
   * R9 — Passport Hold workflow.
   * The guest has checked out of the property but extended the motor rental → the property holds the physical passport.
   * Sets: propertyCheckedOut=true, passportHeld=true, passportHeldAt=now, passportNo.
   * Active rentals only.
   */
  holdPassport(rentalId, { passportNo }) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (rental.status !== RentalStatus.ACTIVE) throw new Error(t('err_hold_only_active'));

    const cleanPassport = (passportNo || '').trim();
    if (!cleanPassport) throw new Error(t('err_passport_required'));
    if (cleanPassport.length < 4) throw new Error(t('err_passport_too_short'));

    const now = new Date().toISOString();
    state.update('rentals', rentalId, {
      propertyCheckedOut: true,
      passportHeld: true,
      passportHeldAt: now,
      passportNo: cleanPassport,
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'passport-hold',
      note: `passport: ${cleanPassport.slice(0, 4)}*** · tamu: ${rental.guestName}`,
    });
    return this.get(rentalId);
  },

  /**
   * Release passport — when the guest has returned/finished and collects their passport.
   * Does not remove the passportNo record, only the flag.
   */
  releasePassport(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (!rental.passportHeld) throw new Error(t('err_passport_not_held'));

    state.update('rentals', rentalId, {
      passportHeld: false,
      passportReleasedAt: new Date().toISOString(),
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'passport-release',
      note: `tamu: ${rental.guestName}`,
    });
    return this.get(rentalId);
  },

  /**
   * Undo Check-Out — revert a rental from 'returned' back to 'active'.
   * Guard: only possible while not yet paid (no money has moved).
   * The motor is set back to rented.
   * Any damage record created at checkout is also removed.
   */
  undoCheckOut(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    const isReturned = rental.status === RentalStatus.RETURNED || rental.status === RentalStatus.COMPLETED;
    if (!isReturned) throw new Error(t('err_not_checked_out_no_undo'));
    if (rental.paid) throw new Error(t('err_undo_checkout_paid'));

    // Remove the damage record created during this checkout (if any)
    if (rental.newDamage) {
      import('./damages.js').then(({ DamageManager }) => {
        const linked = DamageManager.list().filter(d => d.rentalId === rentalId);
        linked.forEach(d => DamageManager.remove(d.id));
      });
    }

    // Reset all checkout-result fields, back to the pre-checkout state
    const estimateDays = rental.finishDate
      ? (this.get(rentalId)?.totalDays || 0)  // keep the initial estimate if present
      : 0;

    state.update('rentals', rentalId, {
      status: RentalStatus.ACTIVE,
      actualFinishDate: null,
      totalDays: estimateDays,
      totalCost: 0,
      payToOwner: 0,
      commission: 0,
      staffReceivesKey: '',
      paymentMethod: '',
      newDamage: false,
      damageDescription: '',
      damageCharge: 0,
      damageResolved: true,
      paid: false,
      paidAt: null,
      ownerSettled: false,
      ownerSettledAt: null,
      ownerPaid: false,
    });

    // Set the motor back to rented
    MotorManager.setStatus(rental.motorId, MotorStatus.RENTED, rentalId);

    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'undo-checkout',
      note: `status dikembalikan ke active · motor ${rental.motorPlate} kembali rented`,
    });
    return this.get(rentalId);
  },

  /**
   * Unmark Paid — reset paid=false.
   * Guard: ownerSettled is still false AND on the same day as paidAt.
   */
  unmarkPaid(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (!rental.paid) throw new Error(t('err_rental_not_marked_paid'));
    if (rental.ownerSettled) throw new Error(t('err_cannot_unpay_settled'));
    const paidDate = (rental.paidAt || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (paidDate !== today) throw new Error(t('err_undo_same_day_only', { date: paidDate }));

    state.update('rentals', rentalId, {
      paid: false,
      paidAt: null,
      paymentMethod: '',
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'unmark-paid',
      note: `pembayaran dibatalkan · total: ${(rental.totalCost || 0).toLocaleString('id-ID')}`,
    });
    return this.get(rentalId);
  },

  /**
   * Flag a suspected damage while the rental is still ACTIVE.
   * Staff/owner can note a suspected damage before the motor is returned.
   * At checkout, the damage fields will be pre-filled from this flag.
   */
  flagDamage(rentalId, { note = '' }) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (rental.status !== RentalStatus.ACTIVE) throw new Error(t('err_flag_damage_only_active'));
    if (!note.trim()) throw new Error(t('err_damage_note_required'));

    state.update('rentals', rentalId, {
      suspectedDamage: true,
      suspectedDamageNote: note.trim(),
      suspectedDamageAt: new Date().toISOString(),
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'flag-damage',
      note: note.trim(),
    });
    return this.get(rentalId);
  },

  /**
   * Clear the suspected-damage flag (if it turns out to be wrong info).
   */
  clearDamageFlag(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (!rental.suspectedDamage) throw new Error(t('err_no_damage_flag'));

    state.update('rentals', rentalId, {
      suspectedDamage: false,
      suspectedDamageNote: '',
      suspectedDamageAt: null,
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'clear-damage-flag',
      note: 'flag dugaan kerusakan dibatalkan',
    });
    return this.get(rentalId);
  },

  /**
   * Undo Mark Damage Resolved — reopen the damage to pending status.
   * Guard: blocked if already paid (money has moved).
   */
  unmarkDamageResolved(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (!rental.newDamage) throw new Error(t('err_no_damage'));
    if (!rental.damageResolved) throw new Error(t('err_damage_not_resolved'));
    if (rental.paid) throw new Error(t('err_reopen_damage_paid'));

    state.update('rentals', rentalId, { damageResolved: false });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'unmark-damage-resolved',
      note: `damage dibuka kembali ke pending · charge: ${(rental.damageCharge || 0).toLocaleString('id-ID')}`,
    });
    return this.get(rentalId);
  },

  /**
   * Undo Mark Owner Settled — cancel the settlement to the owner.
   * Guard: can only be undone on the same day as ownerSettledAt.
   */
  unmarkOwnerSettled(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (!rental.ownerSettled) throw new Error(t('err_owner_not_settled'));
    const settledDate = (rental.ownerSettledAt || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (settledDate !== today) throw new Error(t('err_undo_same_day_only', { date: settledDate }));

    state.update('rentals', rentalId, {
      ownerSettled: false,
      ownerSettledAt: null,
      ownerPaid: false,
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'unmark-owner-settled',
      note: `settle owner dibatalkan · pto: ${(rental.payToOwner || 0).toLocaleString('id-ID')}`,
    });
    return this.get(rentalId);
  },

  /**
   * Edit damage details (description & charge).
   * Editable any time while the owner is not yet settled.
   * If already paid → recorded as a "post-paid correction" in the audit trail.
   */
  editDamage(rentalId, { damageDescription, damageCharge }) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (!rental.newDamage) throw new Error(t('err_no_damage'));
    if (rental.ownerSettled) throw new Error(t('err_edit_damage_settled'));

    const oldCharge = rental.damageCharge || 0;
    const newCharge = Number(damageCharge) || 0;
    state.update('rentals', rentalId, {
      damageDescription: (damageDescription || rental.damageDescription || '').trim(),
      damageCharge: newCharge,
    });

    // Sync to the damage record in DamageManager if present
    import('./damages.js').then(({ DamageManager }) => {
      const linked = DamageManager.list().find(d => d.rentalId === rentalId);
      if (linked) DamageManager.update(linked.id, {
        description: (damageDescription || rental.damageDescription || '').trim(),
        charge: newCharge,
      });
    });

    const isPostPaid = rental.paid;
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'edit-damage',
      note: `charge: ${oldCharge.toLocaleString('id-ID')} → ${newCharge.toLocaleString('id-ID')}${isPostPaid ? ' (koreksi post-paid)' : ''}`,
    });
    return this.get(rentalId);
  },

  /**
   * Mark damage as resolved (paid / repaired).
   */
  markDamageResolved(rentalId, { note = '' } = {}) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));
    if (!rental.newDamage) throw new Error(t('err_no_damage'));
    if (rental.damageResolved) throw new Error(t('err_damage_already_resolved'));

    state.update('rentals', rentalId, { damageResolved: true });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'mark-damage-resolved',
      note: note || `charge: ${(rental.damageCharge || 0).toLocaleString('id-ID')}`,
    });
    return this.get(rentalId);
  },

  /**
   * Admin Correction — edit a limited set of fields on a fully-done rental.
   * For administrative corrections only (wrong amount, payment method, notes).
   *
   * Editable fields:
   *   - damageCharge  : correct the damage recovery amount
   *   - paymentMethod : correct a wrongly recorded payment method
   *   - notes         : add/change notes
   *
   * Fields that may NOT be edited (immutable):
   *   - startDate, actualFinishDate, totalDays, totalCost
   *   - all status flags (paid, ownerSettled, damageResolved, status)
   */
  adminCorrect(rentalId, { damageCharge, paymentMethod, notes } = {}) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error(t('err_rental_not_found'));

    const isFullyDone = (
      (rental.status === RentalStatus.RETURNED || rental.status === RentalStatus.COMPLETED) &&
      rental.paid && rental.ownerSettled && rental.damageResolved
    );
    if (!isFullyDone) throw new Error(t('err_admin_correct_only_done'));

    // Guard: corrections only allowed on the same day as ownerSettledAt
    const settledDate = (rental.ownerSettledAt || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (settledDate !== today) throw new Error(t('err_admin_correct_same_day', { date: settledDate }));

    const patch = {};
    const changes = [];

    if (damageCharge !== undefined) {
      const oldCharge = rental.damageCharge || 0;
      const newCharge = Number(damageCharge) || 0;
      patch.damageCharge = newCharge;
      if (oldCharge !== newCharge) {
        changes.push(`damage: ${oldCharge.toLocaleString('id-ID')} → ${newCharge.toLocaleString('id-ID')}`);

        // Sync to the damage record if present
        import('./damages.js').then(({ DamageManager }) => {
          const linked = DamageManager.list().find(d => d.rentalId === rentalId);
          if (linked) DamageManager.update(linked.id, { charge: newCharge });
        });
      }
    }

    if (paymentMethod !== undefined) {
      const oldMethod = rental.paymentMethod || '-';
      patch.paymentMethod = (paymentMethod || '').trim();
      if (oldMethod !== patch.paymentMethod) {
        changes.push(`metode: ${oldMethod} → ${patch.paymentMethod || '-'}`);
      }
    }

    if (notes !== undefined) {
      patch.notes = (notes || '').trim();
      changes.push('catatan diperbarui');
    }

    if (Object.keys(patch).length === 0) throw new Error(t('err_no_changes_detected'));

    state.update('rentals', rentalId, patch);
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'koreksi-admin',
      note: changes.join(' · '),
    });
    return this.get(rentalId);
  },

  // ----- Helper queries for dashboard / filters -----
  awaitingPayment() {
    return this.list().filter(r =>
      (r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED) && !r.paid
    );
  },

  awaitingOwnerSettle() {
    return this.list().filter(r =>
      (r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED)
      && r.paid && !r.ownerSettled
    );
  },

  damagePending() {
    return this.list().filter(r => r.newDamage && !r.damageResolved && r.status !== RentalStatus.CANCELLED);
  },

  fullyDone() {
    return this.list().filter(r => {
      const isReturned = r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED;
      return isReturned && r.paid && r.ownerSettled && r.damageResolved;
    });
  },

  // =====================================================
  // A1 — Dashboard "Action Queue" (operational to-do)
  // =====================================================

  /**
   * Active rentals whose estimated finish date has already passed — the motor
   * is due (or overdue) for check-out. Same rule as the dashboard banner.
   */
  dueOrOverdue() {
    return this.active().filter(r => r.finishDate && isEstimateExpired(r.finishDate));
  },

  /** Active rentals whose guarantee passport is still held (waiting to be returned). */
  passportsToReturn() {
    return this.active().filter(r => r.passportHeld);
  },

  /**
   * The operational Action Queue, grouped PER RENTAL (one row per guest) so a
   * guest with several pending tasks appears once with all their task chips.
   * Returns [{ rental, tasks: [taskKey, ...] }], tasks in fixed priority order;
   * the list is sorted so the most-urgent rental (by its top task) comes first.
   *
   * Task keys: overdue · awaitingPayment · awaitingSettle · damagePending ·
   * suspectedDamage. (Passport-held is NOT a task — it's a state shown via the
   * dashboard KPI; release happens from the rental detail.)
   */
  actionQueue() {
    const isRet = (r) => r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED;
    // Order in this array == priority (index 0 = most urgent).
    const TASKS = [
      { key: 'overdue',         test: (r) => r.status === RentalStatus.ACTIVE && r.finishDate && isEstimateExpired(r.finishDate) },
      { key: 'awaitingPayment', test: (r) => isRet(r) && !r.paid },
      { key: 'awaitingSettle',  test: (r) => isRet(r) && r.paid && !r.ownerSettled },
      { key: 'damagePending',   test: (r) => r.newDamage && !r.damageResolved },
      { key: 'suspectedDamage', test: (r) => r.status === RentalStatus.ACTIVE && r.suspectedDamage },
    ];

    const items = [];
    for (const r of this.list()) {
      if (r.status === RentalStatus.CANCELLED) continue;
      const tasks = TASKS.filter(td => td.test(r)).map(td => td.key);
      if (tasks.length) items.push({ rental: r, tasks });
    }
    const rank = (k) => TASKS.findIndex(td => td.key === k);
    items.sort((a, b) => rank(a.tasks[0]) - rank(b.tasks[0]));
    return items;
  },

  // Queries
  countActive() { return this.active().length; },
  // Count only passports currently on hold (R9). The old keepPassport field is no longer used.
  countPassportsKept() { return this.active().filter(r => r.passportHeld).length; },

  todayStats() {
    const today = new Date().toISOString().slice(0, 10);
    const todayRentals = this.list().filter(r => (r.createdAt || '').slice(0, 10) === today);
    return {
      newToday: todayRentals.length,
      revenueToday: todayRentals.reduce((s, r) => s + (r.totalCost || 0), 0),
    };
  },

  monthStats(yearMonth) {
    // yearMonth = "2026-05"
    const list = this.list().filter(r =>
      (r.createdAt || '').slice(0, 7) === yearMonth && r.status !== RentalStatus.CANCELLED
    );
    return {
      total: list.length,
      revenue: list.reduce((s, r) => s + (r.totalCost || 0), 0),
      commission: list.reduce((s, r) => s + (r.commission || 0), 0),
      payToOwner: list.reduce((s, r) => s + (r.payToOwner || 0), 0),
      damageRecovery: list.reduce((s, r) => s + (r.damageCharge || 0), 0),
    };
  },
};
