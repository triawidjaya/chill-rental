// =============================================================
// modules/motors.js
// MotorManager — CRUD + queries for the motor inventory
// =============================================================

import { state } from './state.js';
import { uid } from './utils.js';
import { AuditManager, AuditEntities, AuditActions } from './audit.js';

const motorLabel = (m) => m ? `${m.plate} — ${m.description}` : '(unknown)';

export const MotorStatus = {
  AVAILABLE: 'available',
  RENTED: 'rented',
  MAINTENANCE: 'maintenance',
  RETIRED: 'retired',
};

export const MotorManager = {
  list() {
    return state.get('motors') || [];
  },

  get(id) {
    return state.find('motors', id);
  },

  getByPlate(plate) {
    return this.list().find(m => (m.plate || '').toLowerCase() === (plate || '').toLowerCase());
  },

  // Unique plate validation (case-insensitive, trimmed). Skip the motor being edited (excludeId)
  isPlateAvailable(plate, excludeId = null) {
    const target = (plate || '').trim().toUpperCase();
    if (!target) return true;
    return !this.list().some(m => m.id !== excludeId && (m.plate || '').toUpperCase() === target);
  },

  getByPlateExcluding(plate, excludeId = null) {
    const target = (plate || '').trim().toUpperCase();
    return this.list().find(m => m.id !== excludeId && (m.plate || '').toUpperCase() === target);
  },

  create({
    plate, description, cc, pricePerDay, ownerId, ownerName, category,
    hasSurfrack, phoneHolder = false, gps = false, payToOwnerPerDay,
  }) {
    const cleanPlate = (plate || '').trim().toUpperCase();
    if (!cleanPlate) throw new Error('Plat nomor wajib diisi');

    // Unique validation
    const existing = this.getByPlateExcluding(cleanPlate);
    if (existing) {
      throw new Error(`Plat "${cleanPlate}" sudah terdaftar untuk motor: ${existing.description || existing.id}`);
    }

    // Surfrack must be explicitly chosen (boolean true/false, not undefined/null)
    if (hasSurfrack !== true && hasSurfrack !== false) {
      throw new Error('Status Surfrack wajib dipilih');
    }

    const ppd = Number(pricePerDay) || 70000;
    const pto = (payToOwnerPerDay != null && !isNaN(Number(payToOwnerPerDay)))
      ? Number(payToOwnerPerDay)
      : Math.round(ppd * 0.71);

    const motor = {
      id: uid('mot'),
      plate: cleanPlate,
      description: (description || '').trim(),
      cc: cc || '110 - 125',
      pricePerDay: ppd,
      payToOwnerPerDay: pto,
      ownerId: ownerId || null,
      ownerName: (ownerName || '').trim(),
      category: category || 'A',
      hasSurfrack: !!hasSurfrack,
      phoneHolder: !!phoneHolder,
      gps: !!gps,
      status: MotorStatus.AVAILABLE,
      currentRentalId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.add('motors', motor);
    AuditManager.log({
      entity: AuditEntities.MOTOR, entityId: motor.id,
      entityLabel: motorLabel(motor), action: AuditActions.CREATE,
    });
    return motor;
  },

  update(id, patch) {
    const before = this.get(id);
    if (!before) throw new Error('Motor tidak ditemukan');

    // If the plate changes, validate uniqueness
    if (patch.plate !== undefined) {
      const newPlate = (patch.plate || '').trim().toUpperCase();
      if (!newPlate) throw new Error('Plat nomor wajib diisi');
      if (newPlate !== (before.plate || '').toUpperCase()) {
        const existing = this.getByPlateExcluding(newPlate, id);
        if (existing) {
          throw new Error(`Plat "${newPlate}" sudah terdaftar untuk motor: ${existing.description || existing.id}`);
        }
      }
      patch.plate = newPlate;
    }

    // Reject if hasSurfrack is set to undefined/null
    if ('hasSurfrack' in patch && patch.hasSurfrack !== true && patch.hasSurfrack !== false) {
      throw new Error('Status Surfrack wajib dipilih');
    }

    state.update('motors', id, patch);
    const after = this.get(id);
    AuditManager.logUpdate({
      entity: AuditEntities.MOTOR, entityId: id,
      entityLabel: motorLabel(after), before, patch,
    });
    return after;
  },

  remove(id) {
    const before = this.get(id);
    state.remove('motors', id);
    AuditManager.log({
      entity: AuditEntities.MOTOR, entityId: id,
      entityLabel: motorLabel(before), action: AuditActions.DELETE,
    });
  },

  setStatus(id, status, rentalId = null) {
    this.update(id, { status, currentRentalId: rentalId });
  },

  // Queries
  countByStatus(status) {
    return this.list().filter(m => m.status === status).length;
  },

  available() {
    return this.list().filter(m => m.status === MotorStatus.AVAILABLE);
  },

  rented() {
    return this.list().filter(m => m.status === MotorStatus.RENTED);
  },

  byOwner(ownerId) {
    return this.list().filter(m => m.ownerId === ownerId);
  },

  byCategory(cat) {
    return this.list().filter(m => m.category === cat);
  },

  // Filter helper for the rental form: CC + Surfrack
  byCcAndSurfrack(cc = 'all', surfrack = 'all') {
    return this.available().filter(m => {
      if (cc !== 'all' && m.cc !== cc) return false;
      if (surfrack === 'true' && !m.hasSurfrack) return false;
      if (surfrack === 'false' && m.hasSurfrack) return false;
      return true;
    });
  },

  withSurfrack() {
    return this.list().filter(m => m.hasSurfrack);
  },
};
