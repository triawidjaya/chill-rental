// =============================================================
// modules/damages.js
// DamageManager — log damages & recovery charges per motor
// =============================================================

import { state } from './state.js';
import { uid } from './utils.js';
import { AuditManager, AuditEntities, AuditActions } from './audit.js';

export const DamageManager = {
  list() {
    return state.get('damages') || [];
  },

  get(id) {
    return state.find('damages', id);
  },

  create({ rentalId, motorId, motorPlate, description, charge, date }) {
    const damage = {
      id: uid('dmg'),
      rentalId,
      motorId,
      motorPlate,
      description: (description || '').trim(),
      charge: Number(charge) || 0,
      date: date || new Date().toISOString(),
      resolved: false,
      createdAt: new Date().toISOString(),
    };
    state.add('damages', damage);
    AuditManager.log({
      entity: AuditEntities.DAMAGE, entityId: damage.id,
      entityLabel: `${damage.motorPlate} — ${damage.description}`,
      action: AuditActions.CREATE,
      note: `charge ${damage.charge.toLocaleString('id-ID')}`,
    });
    return damage;
  },

  update(id, patch) {
    const before = this.get(id);
    state.update('damages', id, patch);
    const after = this.get(id);
    AuditManager.logUpdate({
      entity: AuditEntities.DAMAGE, entityId: id,
      entityLabel: `${after.motorPlate} — ${after.description}`,
      before, patch,
    });
  },

  remove(id) {
    const before = this.get(id);
    state.remove('damages', id);
    AuditManager.log({
      entity: AuditEntities.DAMAGE, entityId: id,
      entityLabel: `${before?.motorPlate || '-'} — ${before?.description || '-'}`,
      action: AuditActions.DELETE,
    });
  },

  byMotor(motorId) {
    return this.list().filter(d => d.motorId === motorId);
  },

  totalRecovery() {
    return this.list().reduce((s, d) => s + (d.charge || 0), 0);
  },
};
