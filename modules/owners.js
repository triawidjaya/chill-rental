// =============================================================
// modules/owners.js
// OwnerManager — manage owner data & commission rules
// =============================================================

import { state } from './state.js';
import { uid } from './utils.js';
import { MotorManager } from './motors.js';
import { AuditManager, AuditEntities, AuditActions } from './audit.js';

const ownerLabel = (o) => o ? `${o.name} (${o.type || '-'})` : '(unknown)';

export const OwnerManager = {
  list() {
    return state.get('owners') || [];
  },

  get(id) {
    return state.find('owners', id);
  },

  getByName(name) {
    return this.list().find(o => (o.name || '').toLowerCase() === (name || '').toLowerCase());
  },

  /**
   * Create owner.
   * R3 note: the payToOwner field has moved to the Motor (per-motor PTO),
   * because the same owner can have motors with different CC → different rates.
   * The field is kept in the schema for backward-compat but is no longer used.
   */
  create({ name, phone, type = 'staff', notes = '' }) {
    const owner = {
      id: uid('own'),
      name: (name || '').trim(),
      phone: (phone || '').trim(),
      type, // 'property' | 'staff' | 'partner'
      notes,
      _ptoMigrated: true,  // marker for the migration in app.js
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.add('owners', owner);
    AuditManager.log({
      entity: AuditEntities.OWNER, entityId: owner.id,
      entityLabel: ownerLabel(owner), action: AuditActions.CREATE,
    });
    return owner;
  },

  update(id, patch) {
    const before = this.get(id);
    state.update('owners', id, patch);
    const after = this.get(id);
    AuditManager.logUpdate({
      entity: AuditEntities.OWNER, entityId: id,
      entityLabel: ownerLabel(after), before, patch,
    });
  },

  remove(id) {
    const before = this.get(id);
    state.remove('owners', id);
    AuditManager.log({
      entity: AuditEntities.OWNER, entityId: id,
      entityLabel: ownerLabel(before), action: AuditActions.DELETE,
    });
  },

  // Aggregate: motor & earnings per owner
  stats(ownerId, rentals = []) {
    const owner = this.get(ownerId);
    if (!owner) return null;
    const motors = MotorManager.byOwner(ownerId);
    const ownerRentals = rentals.filter(r => r.ownerId === ownerId && (r.status === 'returned' || r.status === 'completed'));
    const totalEarning = ownerRentals.reduce((s, r) => s + (Number(r.payToOwner) || 0), 0);
    const totalDays = ownerRentals.reduce((s, r) => s + (Number(r.totalDays) || 0), 0);
    return { owner, motorCount: motors.length, rentalCount: ownerRentals.length, totalDays, totalEarning };
  },
};
