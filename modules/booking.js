// =============================================================
// modules/booking.js
// BookingManager — online booking requests (guest self-service via booking.html).
//
// Bookings arrive as `status: 'pending'` (inserted by the submit_booking RPC,
// pulled to the staff app like any synced collection). Staff review them here:
//   confirm  -> 'confirmed'   (motor is NOT reserved — picked at physical check-in)
//   reject   -> 'rejected'    (+ reason)
//   markCheckedIn -> 'checked_in' (set in Fase 5 once converted to a real rental)
//
// Status lifecycle:
//   pending → confirmed → checked_in
//   pending → rejected
//   pending → expired (optional, future)
// =============================================================

import { state } from './state.js';
import { AuditManager, AuditEntities, AuditActions } from './audit.js';

export const BookingStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',     // declined while still pending (pre-confirmation)
  CANCELLED: 'cancelled',   // cancelled AFTER confirmation (guest cancels / no-show)
  CHECKED_IN: 'checked_in',
  EXPIRED: 'expired',
};

// Digits-only WhatsApp key for duplicate / returning-guest detection.
const waKey = (wa) => String(wa || '').replace(/\D/g, '');

export const bookingLabel = (b) => `${b?.code || '—'} · ${b?.guestName || '—'}`;

export const BookingManager = {
  list() { return state.get('bookings') || []; },
  get(id) { return state.find('bookings', id); },

  byStatus(status) {
    if (!status || status === 'all') return this.list();
    return this.list().filter(b => b.status === status);
  },
  pending() { return this.byStatus(BookingStatus.PENDING); },

  // Other bookings sharing this WhatsApp number (returning guest / double submit).
  matchesByWa(wa, excludeId) {
    const key = waKey(wa);
    if (!key) return [];
    return this.list().filter(b => b.id !== excludeId && waKey(b.wa) === key);
  },

  confirm(id) {
    const b = this.get(id);
    if (!b) throw new Error('Booking not found');
    if (b.status !== BookingStatus.PENDING) throw new Error('Only pending bookings can be confirmed');
    state.update('bookings', id, {
      status: BookingStatus.CONFIRMED,
      confirmedAt: new Date().toISOString(),
    });
    AuditManager.log({
      entity: AuditEntities.BOOKING, entityId: id, entityLabel: bookingLabel(b),
      action: AuditActions.BOOKING_CONFIRM,
    });
    return this.get(id);
  },

  reject(id, reason = '') {
    const b = this.get(id);
    if (!b) throw new Error('Booking not found');
    if (b.status !== BookingStatus.PENDING) throw new Error('Only pending bookings can be rejected');
    state.update('bookings', id, {
      status: BookingStatus.REJECTED,
      rejectionReason: (reason || '').trim(),
    });
    AuditManager.log({
      entity: AuditEntities.BOOKING, entityId: id, entityLabel: bookingLabel(b),
      action: AuditActions.BOOKING_REJECT, note: (reason || '').trim(),
    });
    return this.get(id);
  },

  // Cancel a booking that was already confirmed (guest cancels / no-show).
  cancel(id, reason = '') {
    const b = this.get(id);
    if (!b) throw new Error('Booking not found');
    if (b.status !== BookingStatus.CONFIRMED) throw new Error('Only confirmed bookings can be cancelled');
    state.update('bookings', id, {
      status: BookingStatus.CANCELLED,
      cancellationReason: (reason || '').trim(),
      cancelledAt: new Date().toISOString(),
    });
    AuditManager.log({
      entity: AuditEntities.BOOKING, entityId: id, entityLabel: bookingLabel(b),
      action: AuditActions.BOOKING_CANCEL, note: (reason || '').trim(),
    });
    return this.get(id);
  },

  // Called from Fase 5 after a confirmed booking is converted into a rental.
  markCheckedIn(id, rentalId) {
    const b = this.get(id);
    if (!b) return null;
    state.update('bookings', id, {
      status: BookingStatus.CHECKED_IN,
      rentalId: rentalId || null,
      checkedInAt: new Date().toISOString(),
    });
    AuditManager.log({
      entity: AuditEntities.BOOKING, entityId: id, entityLabel: bookingLabel(b),
      action: AuditActions.BOOKING_CHECKED_IN, note: rentalId ? `rental=${rentalId}` : '',
    });
    return this.get(id);
  },
};
