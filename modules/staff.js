// =============================================================
// modules/staff.js
// StaffManager — manajemen staf (untuk dropdown di rental & check-out)
// =============================================================

import { state } from './state.js';
import { uid } from './utils.js';
import { AuditManager, AuditEntities, AuditActions } from './audit.js';

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

  // Hanya staff yang masih active — dipakai di dropdown
  active() {
    return this.list().filter(s => s.active !== false);
  },

  // Untuk dropdown: list nama uppercase (sesuai konvensi CSV existing)
  optionsForDropdown() {
    return this.active()
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(s => ({ value: s.name.toUpperCase(), label: staffLabel(s) }));
  },

  create({ name, role = 'staff', active = true, notes = '' }) {
    const cleanName = (name || '').trim();
    if (!cleanName) throw new Error('Nama staff wajib diisi');

    // Validasi nama unik
    const existing = this.getByName(cleanName);
    if (existing) throw new Error(`Staff dengan nama "${cleanName}" sudah ada`);

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
      entity: AuditEntities.SYSTEM,  // gunakan system karena belum ada AuditEntities.STAFF
      entityId: staff.id,
      entityLabel: staffLabel(staff),
      action: AuditActions.CREATE,
      note: `staff: ${staff.role}`,
    });
    return staff;
  },

  update(id, patch) {
    const before = this.get(id);
    if (!before) throw new Error('Staff tidak ditemukan');

    // Jika nama diubah, validasi unik (kecuali nama sendiri)
    if (patch.name && patch.name.trim() !== before.name) {
      const existing = this.getByName(patch.name);
      if (existing && existing.id !== id) {
        throw new Error(`Staff dengan nama "${patch.name.trim()}" sudah ada`);
      }
      patch.name = patch.name.trim();
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

  // Helper: cari staff by uppercase name (untuk legacy seed yang pakai 'AMY', 'SAWAL' dll)
  findByUpperName(upperName) {
    const q = (upperName || '').toUpperCase();
    return this.list().find(s => (s.name || '').toUpperCase() === q);
  },
};
