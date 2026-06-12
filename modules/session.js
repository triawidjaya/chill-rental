// =============================================================
// modules/session.js
// SessionManager — Fase B.2 auth: PIN login, current user, role gating.
//
// - Session lives in localStorage (per-device, NOT synced): logging in on a
//   phone does not log you in on a laptop.
// - PIN hash/salt live on the staff record (synced) so any device — including
//   offline — can verify the same PIN. See modules/crypto.js.
// - can(action) gates sensitive actions by role rank. Roles: staff < admin < manager.
// =============================================================

import { state } from './state.js';
import { StaffManager } from './staff.js';
import { AuditManager, AuditEntities, AuditActions } from './audit.js';
import { genSalt, hashPin, verifyPin, isValidPinFormat, isLegacyPinHash } from './crypto.js';

const SESSION_KEY = 'chill_rental_v1:_session';
const ACTIVITY_KEY = 'chill_rental_v1:_last_activity';

// Idle lock — all roles, 20 minutes without interaction. Per-device (localStorage),
// like the session itself. Passwordless staff are exempt (nothing to re-enter).
const IDLE_LIMIT_MS = 20 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 30 * 1000;

let _lastTouch = 0; // in-memory mirror of ACTIVITY_KEY (throttles writes)

// Role hierarchy — higher rank inherits everything below it.
const ROLE_RANK = { staff: 1, admin: 2, manager: 3, system: 99 };

// Minimum role rank required per action. Anything not listed = allowed for all
// authenticated users (rank >= 1). Matches the agreed permission matrix.
const ACTION_MIN_RANK = {
  // Admin and up
  'rental.delete':  2,
  'rental.cancel':  2,
  'rental.correct': 2,
  'rental.editFinishTime': 2,
  'owner.settle':   2,
  'motor.edit':     2,
  'owner.edit':     2,
  'reports.view':   2,
  // Page access (hide menu + block direct route) — Admin and up
  'page.owners':    2,
  'page.reports':   2,
  'page.audit':     2,
  'page.settings':  2,
  // Manager only
  'staff.manage':   3,
  'page.staff':     3,
  'data.reset':     3,
  'data.backup':    3,
  'audit.purge':    3,
};

let _cache; // cached session object | null | undefined(=unloaded)

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function writeSession(sess) {
  try {
    if (sess) localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    else localStorage.removeItem(SESSION_KEY);
  } catch (_) { /* ignore */ }
}

export const SessionManager = {
  // ---- Current user ----
  current() {
    if (_cache === undefined) _cache = readSession();
    return _cache;
  },

  isAuthenticated() {
    const s = this.current();
    if (!s) return false;
    // Defensive: the staff record may have been removed/deactivated on another device.
    const staff = StaffManager.get(s.staffId);
    return !!staff && staff.active !== false;
  },

  _setSession(staff) {
    const sess = { staffId: staff.id, name: staff.name, role: staff.role || 'staff', at: new Date().toISOString() };
    _cache = sess;
    writeSession(sess);
    this.touchActivity(true); // fresh login/unlock resets the idle clock
    return sess;
  },

  logout() {
    // Log BEFORE clearing so the audit actor is the user who logged out.
    const s = this.current();
    if (s) {
      AuditManager.log({
        entity: AuditEntities.USER, entityId: s.staffId, entityLabel: s.name,
        action: AuditActions.LOGOUT,
      });
    }
    _cache = null;
    writeSession(null);
  },

  // ---- Idle lock (20 min, all roles) ----
  // Record user interaction. Writes are throttled; pass force=true to bypass
  // (login/unlock must always reset the clock).
  touchActivity(force = false) {
    const now = Date.now();
    if (!force && now - _lastTouch < ACTIVITY_WRITE_THROTTLE_MS) return;
    _lastTouch = now;
    try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch (_) { /* ignore */ }
  },

  lastActivity() {
    if (_lastTouch) return _lastTouch;
    try { return Number(localStorage.getItem(ACTIVITY_KEY)) || 0; } catch (_) { return 0; }
  },

  // True when the authenticated user has been idle past the limit and must
  // re-enter their PIN. Passwordless staff never lock (migration policy —
  // there is no PIN to ask for).
  idleExpired() {
    if (!this.isAuthenticated()) return false;
    const staff = StaffManager.get(this.current().staffId);
    if (!staff || !staff.pinHash) return false;
    const last = this.lastActivity();
    return !!last && (Date.now() - last > IDLE_LIMIT_MS);
  },

  // Re-snapshot the session from the live staff record (e.g. after a role
  // change for the logged-in user).
  refresh() {
    const s = this.current();
    if (!s) return;
    const staff = StaffManager.get(s.staffId);
    if (staff) this._setSession(staff);
  },

  // ---- Login ----
  // Returns { ok, reason?, passwordless? }
  //   reason: 'not_found' | 'inactive' | 'pin_required' | 'wrong_pin'
  async login(staffId, pin) {
    const s = StaffManager.get(staffId);
    if (!s) return { ok: false, reason: 'not_found' };
    if (s.active === false) return { ok: false, reason: 'inactive' };

    if (s.pinHash) {
      if (!pin) return { ok: false, reason: 'pin_required' };
      const valid = await verifyPin(pin, s.pinSalt, s.pinHash);
      if (!valid) {
        AuditManager.log({
          entity: AuditEntities.USER, entityId: s.id, entityLabel: s.name,
          action: AuditActions.LOGIN_FAIL, note: 'wrong pin',
        });
        return { ok: false, reason: 'wrong_pin' };
      }
      // Lazy migration: a legacy SHA-256 hash that just verified is re-hashed
      // with PBKDF2. Direct state.update (not StaffManager.update): the PIN
      // itself is unchanged — internal format upgrade only, so no audit entry,
      // but still synced (state.update bumps updatedAt + marks dirty).
      if (isLegacyPinHash(s.pinHash)) {
        try {
          const pinSalt = genSalt();
          const pinHash = await hashPin(pin, pinSalt);
          state.update('staff', s.id, { pinHash, pinSalt });
        } catch (_) { /* non-fatal — the legacy hash keeps working */ }
      }
    } else if (this.roleRequiresPin(s.role)) {
      // Elevated role (manager) with no PIN yet — passwordless login is not
      // allowed. The UI must force a PIN setup before granting access.
      return { ok: false, reason: 'pin_setup_required' };
    }

    this._setSession(s); // set BEFORE logging so the actor is the logged-in user
    AuditManager.log({
      entity: AuditEntities.USER, entityId: s.id, entityLabel: s.name,
      action: AuditActions.LOGIN, note: s.pinHash ? 'pin' : 'no-pin',
    });
    return { ok: true, passwordless: !s.pinHash };
  },

  // ---- PIN management ----
  hasPin(staff) { return !!(staff && staff.pinHash); },

  // Set or change a staff member's PIN. Throws on invalid format.
  async setPin(staffId, pin) {
    if (!isValidPinFormat(pin)) throw new Error('PIN harus 4–6 digit angka');
    const s = StaffManager.get(staffId);
    if (!s) throw new Error('Staf tidak ditemukan');
    const pinSalt = genSalt();
    const pinHash = await hashPin(pin, pinSalt);
    StaffManager.update(staffId, { pinHash, pinSalt });
    AuditManager.log({
      entity: AuditEntities.USER, entityId: s.id, entityLabel: s.name,
      action: AuditActions.RESET_PIN, note: 'set pin',
    });
  },

  // ---- Permission gating ----
  rankOf(role) { return ROLE_RANK[role] || 0; },

  // Roles that must authenticate with a PIN (no passwordless login). Decision:
  // manager and up. Admin/staff may remain passwordless during the migration.
  roleRequiresPin(role) { return this.rankOf(role) >= ROLE_RANK.manager; },

  // Live role from the synced staff record — a demotion made on another device
  // takes effect here on the next permission check, not only after re-login.
  // Falls back to the session snapshot if the staff record is missing.
  currentRole() {
    const s = this.current();
    if (!s) return undefined;
    const staff = StaffManager.get(s.staffId);
    return staff ? (staff.role || 'staff') : s.role;
  },

  can(action, role = this.currentRole()) {
    const need = ACTION_MIN_RANK[action] || 1;
    return this.rankOf(role) >= need;
  },

  // Can the current role open a given route? Routes without a `page.<route>`
  // entry are open to everyone (rank 1).
  canAccessRoute(route, role = this.currentRole()) {
    return this.can(`page.${route}`, role);
  },

  // True when no one can administer the system — i.e. there is no ACTIVE manager.
  // Covers both first-run (zero staff) and the recovery case where staff exist
  // (e.g. loaded from demo data) but none has the manager role. Boot shows the
  // bootstrap/recovery screen in that state.
  needsBootstrap() {
    const staff = StaffManager.list() || [];
    return !staff.some(s => s.role === 'manager' && s.active !== false);
  },

  // True when staff exist but none is an active manager (recovery, not first-run).
  needsRecovery() {
    const staff = StaffManager.list() || [];
    return staff.length > 0 && !staff.some(s => s.role === 'manager' && s.active !== false);
  },
};
