// =============================================================
// modules/staff.js
// StaffManager — staff management (for dropdowns in rental & check-out)
// =============================================================

import { state } from './state.js';
import { uid } from './utils.js';
import { AuditManager, AuditEntities, AuditActions } from './audit.js';
import { t } from './i18n.js';

const staffLabel = (s) => s ? `${s.name}${s.role ? ' (' + s.role + ')' : ''}` : '(unknown)';

export const StaffRoles = [
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'staff', label: 'Staff' },
];

export const StaffManager = {
  list() {
    return state.get('staff') || [];
  },

  get(id) {
    return state.find('staff', id);
  },

  getByName(name) {
    const q = (name || '').trim().toLowerCase();
    return this.list().find(s => (s.name || '').toLowerCase() === q);
  },

  // Only active staff — used in the dropdown
  active() {
    return this.list().filter(s => s.active !== false);
  },

  // How many ACTIVE managers exist. Used to protect the system from losing its
  // last administrator (see remove/update guards + SessionManager.needsRecovery).
  activeManagerCount() {
    return this.list().filter(s => s.role === 'manager' && s.active !== false).length;
  },

  // For the dropdown: list names in uppercase (matching the existing CSV convention)
  optionsForDropdown() {
    return this.active()
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(s => ({ value: s.name.toUpperCase(), label: staffLabel(s) }));
  },

  create({ name, role = 'staff', active = true, notes = '' }) {
    const cleanName = (name || '').trim();
    if (!cleanName) throw new Error(t('err_staff_name_required'));

    // Unique name validation
    const existing = this.getByName(cleanName);
    if (existing) throw new Error(t('err_staff_name_exists', { name: cleanName }));

    const staff = {
      id: uid('stf'),
      name: cleanName,
      role,
      active: !!active,
      notes: (notes || '').trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.add('staff', staff);
    AuditManager.log({
      entity: AuditEntities.SYSTEM,  // use system since there is no AuditEntities.STAFF yet
      entityId: staff.id,
      entityLabel: staffLabel(staff),
      action: AuditActions.CREATE,
      note: `staff: ${staff.role}`,
    });
    return staff;
  },

  update(id, patch) {
    const before = this.get(id);
    if (!before) throw new Error(t('err_staff_member_not_found'));

    // If the name changes, validate uniqueness (excluding its own name)
    if (patch.name && patch.name.trim() !== before.name) {
      const existing = this.getByName(patch.name);
      if (existing && existing.id !== id) {
        throw new Error(t('err_staff_name_exists', { name: patch.name.trim() }));
      }
      patch.name = patch.name.trim();
    }

    // Never demote or deactivate the system's last active manager — that would
    // drop everyone into the recovery screen.
    const demoting     = patch.role !== undefined && patch.role !== 'manager';
    const deactivating = patch.active === false;
    if ((demoting || deactivating)
        && before.role === 'manager' && before.active !== false
        && this.activeManagerCount() <= 1) {
      throw new Error(t('err_staff_last_manager'));
    }

    state.update('staff', id, patch);
    const after = this.get(id);
    AuditManager.logUpdate({
      entity: AuditEntities.SYSTEM,
      entityId: id,
      entityLabel: staffLabel(after),
      before, patch,
      note: 'staff update',
    });
    return after;
  },

  remove(id) {
    const before = this.get(id);
    // Don't delete the last active manager — the system would have no admin.
    if (before && before.role === 'manager' && before.active !== false
        && this.activeManagerCount() <= 1) {
      throw new Error(t('err_staff_last_manager'));
    }
    state.remove('staff', id);
    AuditManager.log({
      entity: AuditEntities.SYSTEM,
      entityId: id,
      entityLabel: staffLabel(before),
      action: AuditActions.DELETE,
      note: 'staff delete',
    });
  },

  toggleActive(id) {
    const s = this.get(id);
    if (!s) return;
    this.update(id, { active: !s.active });
  },

  // Helper: find staff by uppercase name (for legacy seed data using 'AMY', 'SAWAL', etc.)
  findByUpperName(upperName) {
    const q = (upperName || '').toUpperCase();
    return this.list().find(s => (s.name || '').toUpperCase() === q);
  },
};
