// =============================================================
// modules/audit.js
// AuditManager — track all data mutations (create/update/delete)
// In Phase A the actor defaults to 'system' (Phase B will inject the session user)
// =============================================================

import { state } from './state.js';
import { uid } from './utils.js';

export const AuditEntities = {
  MOTOR: 'motor',
  RENTAL: 'rental',
  OWNER: 'owner',
  DAMAGE: 'damage',
  USER: 'user',
  SYSTEM: 'system',
  BOOKING: 'booking',
};

export const AuditActions = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  CHECK_IN: 'check-in',
  CHECK_OUT: 'check-out',
  CANCEL: 'cancel',
  // R7/R8: multi-flag actions
  MARK_PAID: 'mark-paid',
  MARK_OWNER_SETTLED: 'mark-owner-settled',
  MARK_DAMAGE_RESOLVED: 'mark-damage-resolved',
  PASSPORT_HOLD: 'passport-hold',          // R9
  // Online booking (guest self-service)
  BOOKING_CONFIRM: 'booking-confirm',
  BOOKING_REJECT: 'booking-reject',
  BOOKING_CANCEL: 'booking-cancel',
  BOOKING_CHECKED_IN: 'booking-checked-in',
  // Auth (Phase B)
  LOGIN: 'login',
  LOGIN_FAIL: 'login-fail',
  ROLE_CHANGE: 'role-change',
  RESET_PIN: 'reset-pin',
  SEED: 'seed',
  RESET_ALL: 'reset-all',
  AUDIT_PURGE: 'audit-purge',
};

// Default actor — replaced in Phase B by SessionManager.current()
let getActor = () => ({ id: 'system', name: 'system', role: 'system' });

export function setActorResolver(fn) {
  if (typeof fn === 'function') getActor = fn;
}

export const AuditManager = {
  list() {
    return state.get('auditLog') || [];
  },

  /**
   * Log an action.
   * @param {Object} opts
   * @param {string} opts.entity   — entity type (motor, rental, ...)
   * @param {string} opts.entityId — id of the entity
   * @param {string} opts.entityLabel — label for display
   * @param {string} opts.action   — action constant
   * @param {Object} [opts.changes] — diff { field, from, to } for an update
   * @param {string} [opts.note]
   */
  log({ entity, entityId, entityLabel, action, changes, note }) {
    const actor = getActor() || { id: 'system', name: 'system', role: 'system' };
    const entry = {
      id: uid('aud'),
      entity,
      entityId: entityId || null,
      entityLabel: entityLabel || '',
      action,
      actorId: actor.id || 'system',
      actorName: actor.name || 'system',
      actorRole: actor.role || 'system',
      changes: changes || null,
      timestamp: new Date().toISOString(),
      note: note || '',
    };
    state.add('auditLog', entry);
    return entry;
  },

  // Update-logging helper — compute the diff between the old object and the new patch
  logUpdate({ entity, entityId, entityLabel, before, patch, note }) {
    const changes = [];
    Object.keys(patch || {}).forEach(k => {
      if (k === 'updatedAt') return;
      if (before?.[k] !== patch[k]) {
        changes.push({ field: k, from: before?.[k], to: patch[k] });
      }
    });
    if (changes.length === 0) return null;
    return this.log({
      entity, entityId, entityLabel,
      action: AuditActions.UPDATE,
      changes, note,
    });
  },

  // Query helpers
  filter({ entity, action, actorId, fromISO, toISO, search } = {}) {
    let list = this.list();
    if (entity) list = list.filter(e => e.entity === entity);
    if (action) list = list.filter(e => e.action === action);
    if (actorId) list = list.filter(e => e.actorId === actorId);
    if (fromISO) list = list.filter(e => e.timestamp >= fromISO);
    if (toISO) list = list.filter(e => e.timestamp <= toISO);
    if (search) {
      const q = String(search).toLowerCase();
      list = list.filter(e =>
        (e.entityLabel || '').toLowerCase().includes(q) ||
        (e.actorName || '').toLowerCase().includes(q) ||
        (e.note || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  },

  clear() {
    state.set('auditLog', []);
  },

  // Distinct actors (for the filter dropdown)
  distinctActors() {
    const seen = new Map();
    this.list().forEach(e => {
      if (!seen.has(e.actorId)) seen.set(e.actorId, { id: e.actorId, name: e.actorName, role: e.actorRole });
    });
    return Array.from(seen.values());
  },

  // Delete every entry before the cutoff. Uses removeMany so the deletions
  // tombstone-sync to other devices (state.set alone would let the server
  // resurrect them). The purge itself is logged. Returns the deleted count.
  purgeBefore(cutoffISO) {
    const ids = this.list().filter(e => (e.timestamp || '') < cutoffISO).map(e => e.id);
    if (ids.length === 0) return 0;
    state.removeMany('auditLog', ids);
    this.log({
      entity: AuditEntities.SYSTEM,
      entityLabel: 'Audit log purge',
      action: AuditActions.AUDIT_PURGE,
      note: `${ids.length} entri < ${cutoffISO.slice(0, 10)}`,
    });
    return ids.length;
  },
};
