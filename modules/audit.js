// =============================================================
// modules/audit.js
// AuditManager — track all data mutations (create/update/delete)
// In Fase A actor defaults to 'system' (Fase B will inject session user)
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
  // Auth (Fase B)
  LOGIN: 'login',
  LOGIN_FAIL: 'login-fail',
  ROLE_CHANGE: 'role-change',
  RESET_PIN: 'reset-pin',
  SEED: 'seed',
  RESET_ALL: 'reset-all',
};

// Default actor — diganti saat Fase B oleh SessionManager.current()
let getActor = () => ({ id: 'system', name: 'system', role: 'system' });

export function setActorResolver(fn) {
  if (typeof fn === 'function') getActor = fn;
}

export const AuditManager = {
  list() {
    return state.get('auditLog') || [];
  },

  /**
   * Log sebuah aksi.
   * @param {Object} opts
   * @param {string} opts.entity   — entity type (motor, rental, ...)
   * @param {string} opts.entityId — id dari entity
   * @param {string} opts.entityLabel — label untuk display
   * @param {string} opts.action   — action constant
   * @param {Object} [opts.changes] — diff { field, from, to } untuk update
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

  // Bantu logging update — compute diff dari objek lama vs patch baru
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

  // Distinct actors (untuk filter dropdown)
  distinctActors() {
    const seen = new Map();
    this.list().forEach(e => {
      if (!seen.has(e.actorId)) seen.set(e.actorId, { id: e.actorId, name: e.actorName, role: e.actorRole });
    });
    return Array.from(seen.values());
  },

  // Auto-purge entry lebih dari N hari
  purgeOlderThan(days = 180) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const list = this.list().filter(e => e.timestamp >= cutoff);
    state.set('auditLog', list);
    return list.length;
  },
};
