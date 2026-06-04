// ============================================================
// app.js — Entry point. Hash router + global wiring.
// Loads all pages, manages navigation, theme, seed, and
// delegated data-action handlers.
// ============================================================

import { state, SYNCED_KEYS } from './state.js';
import { storage } from './storage.js';
import { initSync, isSupabaseConfigured, supaAuth } from './supabase.js';
import { Modal, Toast } from './ui/notify.js';
import { AuditManager, AuditEntities, AuditActions, setActorResolver } from './audit.js';
import { SessionManager } from './session.js';
import { StaffManager } from './staff.js';
import { genSalt, hashPin, verifyPin } from './crypto.js';
import { AuthGate } from './ui/login.js';
import { t, renderI18n, setLang, getLang } from './i18n.js';
import {
  openRentalForm,
  openRentalDetail,
  openMotorForm,
  openOwnerForm,
} from './ui/forms.js';

import { renderDashboard } from '../pages/dashboard.js';
import { renderRentals, setupRentalsPage } from '../pages/rentals.js';
import { renderMotors, setupMotorsPage } from '../pages/motors.js';
import { renderOwners, setupOwnersPage } from '../pages/owners.js';
import { renderReports } from '../pages/reports.js';
import { renderAudit, setupAuditPage } from '../pages/audit.js';
import { renderStaff, setupStaffPage, openStaffForm, openPinDialog } from '../pages/staff.js';
import { renderDamages, renderSettings } from '../pages/extras.js';
import { renderBooking, setupBookingPage, openBookingDetail } from '../pages/booking.js';

import { RentalManager, RentalStatus } from './rentals.js';
import { BookingManager } from './booking.js';
import { setPropertyName } from './property.js';

// ---------- Route registry ----------
const ROUTE_KEYS = {
  dashboard: 'route_dashboard',
  bookings:  'route_bookings',
  rentals:   'route_rentals',
  motors:    'route_motors',
  owners:    'route_owners',
  reports:   'route_reports',
  audit:     'route_audit',
  staff:     'route_staff',
  damages:   'route_damages',
  settings:  'route_settings',
};

const ROUTES = {
  dashboard: { title: () => t('route_dashboard'), render: renderDashboard, setup: null },
  bookings:  { title: () => t('route_bookings') || 'Bookings', render: renderBooking, setup: setupBookingPage },
  rentals:   { title: () => t('route_rentals'),   render: renderRentals,   setup: setupRentalsPage },
  motors:    { title: () => t('route_motors'),    render: renderMotors,    setup: setupMotorsPage },
  owners:    { title: () => t('route_owners'),    render: renderOwners,    setup: setupOwnersPage },
  reports:   { title: () => t('route_reports'),   render: renderReports,   setup: null },
  audit:     { title: () => t('route_audit'),     render: renderAudit,     setup: setupAuditPage },
  staff:     { title: () => t('route_staff'),     render: renderStaff,     setup: setupStaffPage },
  damages:   { title: () => t('route_damages'),   render: renderDamages,   setup: null },
  settings:  { title: () => t('route_settings'),  render: renderSettings,  setup: null },
};

const DEFAULT_ROUTE = 'dashboard';

// ---------- DOM refs ----------
const $content   = document.getElementById('content');
const $context   = document.getElementById('topbar-context');
const $sidebar   = document.getElementById('sidebar');
const $scrim     = document.getElementById('scrim');
const $btnMenu   = document.getElementById('btn-menu');
const $btnTheme  = document.getElementById('btn-theme');
const $btnLogout    = document.getElementById('btn-logout');
const $btnSwitchUser = document.getElementById('btn-switch-user');
const $btnSetPinSelf = document.getElementById('btn-set-pin-self');
const $accountBlock = document.getElementById('account-block');
const $btnFab    = document.getElementById('btn-new-rental');
const $btnQuickRental = document.getElementById('btn-quick-rental');
const $kpiCount  = document.getElementById('kpi-active-count');

// ---------- Router ----------
function getRoute() {
  const hash = (location.hash || '').replace(/^#/, '').split('?')[0];
  return ROUTES[hash] ? hash : DEFAULT_ROUTE;
}

function setActiveNav(route) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.route === route);
  });
}

function renderRoute() {
  let route = getRoute();

  // Role gate: if the current role can't access this route (e.g. direct URL
  // access to #reports as Staff), redirect to the dashboard.
  if (!SessionManager.canAccessRoute(route)) {
    const cur = (location.hash || '').replace(/^#/, '').split('?')[0];
    if (cur && cur !== DEFAULT_ROUTE) { location.hash = `#${DEFAULT_ROUTE}`; return; }
    route = DEFAULT_ROUTE;
  }

  const def = ROUTES[route];

  // Update topbar context label
  if ($context) $context.textContent = typeof def.title === 'function' ? def.title() : def.title;

  // Render page
  $content.innerHTML = def.render();

  // Run page setup if any (event listeners, etc.)
  if (typeof def.setup === 'function') {
    def.setup(renderRoute);
  }

  // Update active nav
  setActiveNav(route);

  // Hide role-gated controls in the freshly rendered content
  applyPermissions();

  // Update active rentals KPI
  updateActiveKPI();
  updateBookingBadge();

  // Close mobile drawer if open
  closeSidebar();

  // Scroll to top
  $content.scrollTop = 0;
  // Safety: always restore content scroll when routing
  $content.style.overflowY = '';
}

function updateActiveKPI() {
  if (!$kpiCount) return;
  // BUG-FIX: list() does not accept a filter arg. Use the active() helper directly.
  const active = RentalManager.active().length;
  $kpiCount.textContent = active;
}

// Pending-booking count badge on the sidebar nav (live via renderRoute/onRemoteChange).
function updateBookingBadge() {
  const el = document.getElementById('nav-booking-badge');
  if (!el) return;
  const n = BookingManager.pending().length;
  el.textContent = n;
  el.style.display = n > 0 ? '' : 'none';
}

// Optional sync indicator — updates #sync-status if present in the DOM.
// Safe no-op until that element is added to the topbar.
const SYNC_LABELS = {
  syncing:  { icon: '↻', text: 'Menyinkronkan…' },
  synced:   { icon: '✓', text: 'Tersinkron' },
  pending:  { icon: '•', text: 'Menunggu sync' },
  offline:  { icon: '⚠', text: 'Offline (lokal)' },
  disabled: { icon: '',  text: '' },
};
function updateSyncStatus(status) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const s = SYNC_LABELS[status] || SYNC_LABELS.disabled;
  el.textContent = s.icon ? `${s.icon} ${s.text}` : '';
  el.dataset.syncStatus = status;
  el.title = s.text;
}

// ---------- Auth (Fase B.2) ----------
let appStarted = false;
let syncEngine = null;

// Hide [data-requires="<action>"] elements the current role may not use.
function applyPermissions() {
  document.querySelectorAll('[data-requires]').forEach((el) => {
    el.classList.toggle('is-forbidden', !SessionManager.can(el.dataset.requires));
  });
}

// Reflect the logged-in user in the sidebar account block.
function updateAccountBlock() {
  const u = SessionManager.current();
  if (!$accountBlock) return;
  if (u) {
    const av = document.getElementById('account-avatar');
    const nm = document.getElementById('account-name');
    const rl = document.getElementById('account-role');
    if (av) av.textContent = (u.name || '?').trim().charAt(0).toUpperCase() || '?';
    if (nm) nm.textContent = u.name || '';
    if (rl) rl.textContent = t(`role_${u.role}`);
    $accountBlock.hidden = false;
  } else {
    $accountBlock.hidden = true;
  }
}

// ---------- Sidebar (mobile drawer) ----------
function openSidebar() {
  $sidebar.classList.add('is-open');
  $scrim.hidden = false;
  // Freeze content scroll while the drawer is open (mobile)
  $content.style.overflowY = 'hidden';
}
function closeSidebar() {
  $sidebar.classList.remove('is-open');
  $scrim.hidden = true;
  // Restore content scroll
  $content.style.overflowY = '';
}

// ---------- R12: Desktop sidebar collapse ----------
const $appShell = document.getElementById('app');
const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;

function applySidebarCollapsed(collapsed) {
  if (!$appShell) return;
  $appShell.classList.toggle('is-sidebar-collapsed', !!collapsed);
}

function toggleDesktopSidebar() {
  const settings = state.get('settings') || {};
  const next = !settings.sidebarCollapsed;
  settings.sidebarCollapsed = next;
  state.set('settings', settings);
  applySidebarCollapsed(next);
}

// ---------- Theme ----------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const settings = state.get('settings') || {};
  settings.theme = theme;
  state.set('settings', settings);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'light' ? 'dark' : 'light');
}

// ---------- Reset ----------
// Small password dialog.
//   mode 'enter' → one field; resolves the typed value.
//   mode 'set'   → password + confirmation; resolves only when both match.
// Resolves null on cancel/close. The raw password is never stored — see handleReset.
function passwordDialog({ title, message, confirmText = 'Lanjut', mode = 'enter' }) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="stack" style="gap:12px">
        ${message ? `<p style="color:var(--text-secondary);margin:0">${message}</p>` : ''}
        <div class="field">
          <label class="field__label" for="pwd-1">Password</label>
          <input id="pwd-1" type="password" class="input" autocomplete="off" />
        </div>
        ${mode === 'set' ? `
        <div class="field">
          <label class="field__label" for="pwd-2">Ulangi Password</label>
          <input id="pwd-2" type="password" class="input" autocomplete="off" />
        </div>` : ''}
        <p id="pwd-err" style="color:var(--danger);margin:0;font-size:.85em;display:none"></p>
      </div>
    `;
    const footer = document.createElement('div');
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn--ghost';
    btnCancel.textContent = 'Batal';
    btnCancel.onclick = () => { resolve(null); Modal.close(); };

    const btnOk = document.createElement('button');
    btnOk.className = 'btn';
    btnOk.textContent = confirmText;

    const showErr = (msg) => {
      const e = body.querySelector('#pwd-err');
      e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none';
    };
    btnOk.onclick = () => {
      const v = body.querySelector('#pwd-1').value;
      const v2 = body.querySelector('#pwd-2')?.value;
      if (!v || v.length < 4) { showErr('Password minimal 4 karakter.'); return; }
      if (mode === 'set' && v !== v2) { showErr('Password tidak sama.'); return; }
      resolve(v); Modal.close();
    };

    footer.appendChild(btnCancel);
    footer.appendChild(btnOk);
    Modal.open({ title, body, footer, closeOnBackdrop: true, onClose: () => resolve(null) });
    body.querySelectorAll('input').forEach(inp =>
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnOk.click(); }));
  });
}

async function handleReset() {
  const settings = state.get('settings') || {};

  // First time on this device: create the reset password, then stop. The actual
  // wipe needs a second, deliberate click so setup can never erase data by accident.
  if (!settings.resetHash || !settings.resetSalt) {
    const pwd = await passwordDialog({
      title: 'Buat Password Reset',
      message: 'Belum ada password reset di perangkat ini. Buat sekarang — password ini wajib dimasukkan setiap kali ingin menghapus data lokal.',
      confirmText: 'Simpan Password',
      mode: 'set',
    });
    if (!pwd) return;
    const salt = genSalt();
    settings.resetSalt = salt;
    settings.resetHash = await hashPin(pwd, salt);
    state.set('settings', settings);
    Toast.success('Password reset dibuat. Klik Reset lagi untuk menghapus data.');
    return;
  }

  // Returning: require the reset password before anything destructive.
  const entry = await passwordDialog({
    title: 'Konfirmasi Password Reset',
    message: 'Masukkan password reset untuk melanjutkan.',
    confirmText: 'Lanjut',
    mode: 'enter',
  });
  if (entry == null) return;
  if (!(await verifyPin(entry, settings.resetSalt, settings.resetHash))) {
    Toast.error('Password reset salah.');
    return;
  }

  const confirmed = await Modal.confirm({
    title: 'Reset Semua Data?',
    message: 'Tindakan ini menghapus seluruh data motor, rental, owner, dan kerusakan di PERANGKAT INI (data server tidak terhapus). Tidak bisa dibatalkan.',
    confirmText: 'Ya, Hapus Semua',
    cancelText: 'Batal',
    variant: 'danger',
  });
  if (!confirmed) return;
  storage.clearAll();
  // Restore device preferences (theme/lang + the reset password) so the gate
  // survives a wipe — reset clears business DATA, not your device settings.
  state.set('settings', settings);
  ['motors', 'rentals', 'owners', 'damages', 'staff', 'auditLog', 'bookings'].forEach((k) => state.set(k, []));
  AuditManager.log({
    entity: AuditEntities.SYSTEM, entityId: null,
    entityLabel: 'Reset all data', action: AuditActions.RESET_ALL,
  });
  Toast.success('Semua data berhasil dihapus');
  location.hash = '#dashboard';
  renderRoute();
}

// ---------- Backup / Restore ----------
function handleExportBackup() {
  const data = {
    version: 3,                          // R1: multi-flag rental + motor PH/GPS/PTO
    schemaNote: 'rental.status: active|returned|cancelled + paid + ownerSettled + damageResolved',
    exportedAt: new Date().toISOString(),
    motors:   state.get('motors')   || [],
    rentals:  state.get('rentals')  || [],
    owners:   state.get('owners')   || [],
    damages:  state.get('damages')  || [],
    staff:    state.get('staff')    || [],
    auditLog: state.get('auditLog') || [],
    bookings: state.get('bookings') || [],
    settings: state.get('settings') || {},
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `chill-rental-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  Toast.success('File backup berhasil diunduh');
}

function handleImportBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const confirmed = await Modal.confirm({
        title: 'Pulihkan dari Backup?',
        message: `File berisi ${data.motors?.length || 0} motor, ${data.rentals?.length || 0} rental, ${data.owners?.length || 0} owner, ${data.staff?.length || 0} staff. Data sekarang akan ditimpa.`,
        confirmText: 'Pulihkan',
        cancelText: 'Batal',
        variant: 'danger',
      });
      if (!confirmed) return;
      ['motors', 'rentals', 'owners', 'damages', 'staff', 'auditLog', 'bookings', 'settings'].forEach((k) => {
        if (Array.isArray(data[k]) || typeof data[k] === 'object') state.set(k, data[k]);
      });
      // Bulk replace bypasses the per-record outbox — queue restored data for upload.
      SYNCED_KEYS.forEach((k) => state.markCollectionDirty(k));
      Toast.success('Data berhasil dipulihkan dari backup');
      renderRoute();
    } catch (err) {
      console.error(err);
      Toast.error('File tidak valid. Pastikan file backup dari Chill Rental.');
    }
  };
  input.click();
}

// Actions that require elevated roles (Fase B.2). Others are open to all.
const ACTION_PERMISSION = {
  'new-staff':     'staff.manage',
  'edit-staff':    'staff.manage',
  'new-motor':     'motor.edit',
  'edit-motor':    'motor.edit',
  'new-owner':     'owner.edit',
  'edit-owner':    'owner.edit',
  'reset-data':    'data.reset',
  'export-backup': 'data.backup',
  'import-backup': 'data.backup',
};

// ---------- Delegated action handler ----------
function handleAction(action, el) {
  const need = ACTION_PERMISSION[action];
  if (need && !SessionManager.can(need)) {
    Toast.error(t('auth_no_access'));
    return;
  }
  switch (action) {
    case 'new-rental':
      openRentalForm();
      break;
    case 'open-rental': {
      const id = el.dataset.id;
      if (id) openRentalDetail(id);
      break;
    }
    case 'open-booking': {
      const id = el.dataset.id;
      if (id) openBookingDetail(id);
      break;
    }
    case 'new-motor':
      openMotorForm();
      break;
    case 'edit-motor': {
      const id = el.dataset.id;
      if (id) openMotorForm(id);
      break;
    }
    case 'new-owner':
      openOwnerForm();
      break;
    case 'edit-owner': {
      const id = el.dataset.id;
      if (id) openOwnerForm(id);
      break;
    }
    case 'new-staff':
      openStaffForm();
      break;
    case 'edit-staff': {
      const id = el.dataset.id;
      if (id) openStaffForm(id);
      break;
    }
    case 'export-backup':
      handleExportBackup();
      break;
    case 'import-backup':
      handleImportBackup();
      break;
    case 'reset-data':
      handleReset();
      break;
    case 'set-lang-id':
      setLang('id');
      break;
    case 'set-lang-en':
      setLang('en');
      break;
    case 'export-rentals':
      // page-local handler in rentals.js handles this via setupRentalsPage
      break;
    case 'save-property-name': {
      const input = document.getElementById('set-property-name');
      if (input) {
        setPropertyName(input.value);
        Toast.success(t('toast_property_saved'));
        renderRoute();
      }
      break;
    }
  }
}

// ---------- Event wiring ----------
function bindEvents() {
  // Hash routing
  window.addEventListener('hashchange', renderRoute);

  // Re-render trigger from forms after data mutation
  window.addEventListener('route:refresh', () => {
    renderRoute();
  });

  // Topbar — R12: hamburger toggle
  //   Mobile: open/close drawer
  //   Desktop: collapse/expand sidebar
  $btnMenu?.addEventListener('click', () => {
    if (isDesktop()) {
      toggleDesktopSidebar();
    } else {
      if ($sidebar.classList.contains('is-open')) closeSidebar();
      else openSidebar();
    }
  });
  $btnTheme?.addEventListener('click', toggleTheme);

  // Account block (Fase B.2)
  const goToGate = () => {
    SessionManager.logout();
    appStarted = false;
    updateAccountBlock();
    closeSidebar();
    AuthGate.show({ onAuthenticated: startApp });
  };

  // Logout — confirm first (you're leaving)
  $btnLogout?.addEventListener('click', async () => {
    const ok = await Modal.confirm({
      title: t('auth_logout_confirm_title'),
      message: t('auth_logout_confirm_msg'),
      confirmText: t('auth_logout'),
      cancelText: t('btn_cancel'),
    });
    if (ok) goToGate();
  });

  // Switch user — quick hop to the login screen (shared counter device), no confirm
  $btnSwitchUser?.addEventListener('click', goToGate);

  // Set/change your OWN PIN (no staff-management access needed)
  $btnSetPinSelf?.addEventListener('click', () => {
    const u = SessionManager.current();
    const me = u && StaffManager.get(u.staffId);
    if (me) openPinDialog(me);
  });
  $btnFab?.addEventListener('click', () => openRentalForm());
  $btnQuickRental?.addEventListener('click', () => openRentalForm());

  // Scrim closes drawer
  $scrim?.addEventListener('click', closeSidebar);

  // Navigation clicks — let browser handle hash change but close drawer
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', () => {
      // small delay so hashchange runs first
      setTimeout(closeSidebar, 50);
    });
  });

  // Delegated data-action handler on content
  $content.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (!action) return;
    handleAction(action, el);
  });

  // ESC closes drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $sidebar.classList.contains('is-open')) {
      closeSidebar();
    }
  });

  // R12: re-apply collapsed state when resizing across desktop/mobile breakpoint
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const settings = state.get('settings') || {};
      // Sidebar collapse only meaningful on desktop. Mobile uses drawer instead.
      if (!isDesktop()) {
        $appShell?.classList.remove('is-sidebar-collapsed');
      } else {
        applySidebarCollapsed(!!settings.sidebarCollapsed);
      }
    }, 120);
  });

  // Live-update active KPI when rentals change
  state.subscribe('rentals', updateActiveKPI);
}

// ---------- Migrate (defensive — non-destructive) ----------
function migrate() {
  const owners = state.get('owners') || [];
  // ===== Motors =====
  // - hasSurfrack: default false (Fase A)
  // - phoneHolder, gps: default false (R1)
  // - payToOwnerPerDay: copied from owner.payToOwner (R1 — PTO moved to the motor)
  const motors = state.get('motors') || [];
  let motorsChanged = false;
  const newMotors = motors.map(m => {
    let changed = false;
    const next = { ...m };
    if (next.hasSurfrack === undefined) { next.hasSurfrack = false; changed = true; }
    if (next.phoneHolder === undefined) { next.phoneHolder = false; changed = true; }
    if (next.gps === undefined) { next.gps = false; changed = true; }
    if (next.payToOwnerPerDay === undefined) {
      // Try to read from the owner; fall back to pricePerDay × 0.71 (50k/70k ratio)
      const owner = owners.find(o => o.id === m.ownerId);
      const fallback = Math.round((Number(m.pricePerDay) || 70000) * 0.71);
      next.payToOwnerPerDay = (owner && Number(owner.payToOwner)) || fallback;
      changed = true;
    }
    if (changed) motorsChanged = true;
    return next;
  });
  if (motorsChanged) state.set('motors', newMotors);

  // ===== Rentals =====
  // - payToOwnerPerDay (Phase A): unchanged
  // - Multi-flag status (R1):
  //     status='active'    → unchanged, paid=false, ownerSettled=false
  //     status='completed' → status='returned' + paid=true + paymentMethod kept + ownerSettled=true + damageResolved (true if no damage)
  //     status='cancelled' → unchanged
  // - Passport workflow (R1): hostelCheckedOut=false, passportHeld=false, passportHeldAt=null
  const rentals = state.get('rentals') || [];
  let rentalsChanged = false;
  const newRentals = rentals.map(r => {
    let changed = false;
    const next = { ...r };

    if (next.payToOwnerPerDay === undefined) {
      const ptoPerDay = next.totalDays > 0 ? Math.round((next.payToOwner || 0) / next.totalDays) : 50000;
      next.payToOwnerPerDay = ptoPerDay;
      changed = true;
    }

    // Multi-flag — only migrate if the new flags are not present yet
    if (next.paid === undefined || next.ownerSettled === undefined || next.damageResolved === undefined) {
      if (next.status === 'completed') {
        next.status = 'returned';
        next.paid = next.paid !== undefined ? next.paid : true;
        next.paidAt = next.paidAt || next.actualFinishDate || next.updatedAt || null;
        next.ownerSettled = next.ownerSettled !== undefined ? next.ownerSettled : (next.ownerPaid === true);
        next.ownerSettledAt = next.ownerSettledAt || (next.ownerPaid ? (next.actualFinishDate || next.updatedAt) : null);
        next.damageResolved = next.damageResolved !== undefined ? next.damageResolved : !next.newDamage;
      } else if (next.status === 'active') {
        next.paid = false;
        next.paidAt = null;
        next.ownerSettled = false;
        next.ownerSettledAt = null;
        next.damageResolved = !next.newDamage; // usually true (not checked out yet)
      } else if (next.status === 'cancelled') {
        next.paid = false;
        next.paidAt = null;
        next.ownerSettled = false;
        next.ownerSettledAt = null;
        next.damageResolved = true;
      }
      changed = true;
    }

    // Migration: rename hostelCheckedOut → propertyCheckedOut
    if (next.hostelCheckedOut !== undefined) {
      next.propertyCheckedOut = next.hostelCheckedOut;
      delete next.hostelCheckedOut;
      changed = true;
    }
    if (next.propertyCheckedOut === undefined) { next.propertyCheckedOut = false; changed = true; }
    if (next.passportHeld === undefined)       { next.passportHeld = false;       changed = true; }
    if (next.passportHeldAt === undefined)     { next.passportHeldAt = null;      changed = true; }

    if (changed) rentalsChanged = true;
    return next;
  });
  if (rentalsChanged) state.set('rentals', newRentals);

  // ===== Owners =====
  // - payToOwner: do not remove it yet until all motors are migrated with PTO.
  //   Only mark with _ptoMigrated=true; the payToOwner field is kept for temporary backward-compat.
  //   Cleanup will happen in a later sprint once the Owner form no longer uses this field.
  let ownersChanged = false;
  const newOwners = owners.map(o => {
    if (o._ptoMigrated === undefined) { ownersChanged = true; return { ...o, _ptoMigrated: true }; }
    return o;
  });
  if (ownersChanged) state.set('owners', newOwners);

  // ===== AuditLog =====
  if (!state.get('auditLog')) state.set('auditLog', []);

  // ===== Staff (placeholder for R2) =====
  if (!state.get('staff')) state.set('staff', []);

  // ===== Motor status reconciliation =====
  // Bug-fix: ensure motor.status stays in sync with active rentals.
  // A motor with a status='active' rental → rented + currentRentalId.
  // A motor without an active rental → available + currentRentalId=null.
  reconcileMotorStatus();
}

function reconcileMotorStatus() {
  const motors = state.get('motors') || [];
  const rentals = state.get('rentals') || [];
  const activeByMotor = new Map();
  rentals.forEach(r => {
    if (r.status === 'active' && r.motorId) activeByMotor.set(r.motorId, r.id);
  });

  let changed = false;
  const newMotors = motors.map(m => {
    const activeRentalId = activeByMotor.get(m.id) || null;
    const shouldBeRented = !!activeRentalId;
    const isRented = m.status === 'rented';

    if (shouldBeRented && (!isRented || m.currentRentalId !== activeRentalId)) {
      changed = true;
      return { ...m, status: 'rented', currentRentalId: activeRentalId };
    }
    if (!shouldBeRented && isRented) {
      changed = true;
      return { ...m, status: 'available', currentRentalId: null };
    }
    return m;
  });
  if (changed) state.set('motors', newMotors);
}

// ---------- Boot ----------
async function boot() {
  // Migrate first (safe — non-destructive)
  migrate();

  // Apply saved theme + sidebar collapsed state (R12)
  const settings = state.get('settings') || {};
  applyTheme(settings.theme || 'light');
  applySidebarCollapsed(!!settings.sidebarCollapsed);

  // Wire events
  bindEvents();

  // Audit actor = logged-in user (Fase B.2). Falls back to 'system' pre-login.
  setActorResolver(() => SessionManager.current() || { id: 'system', name: 'system', role: 'system' });

  // Listen for language changes
  window.addEventListener('lang:change', () => {
    renderRoute();
    renderI18n();
    applyPermissions();
    updateAccountBlock();
  });

  // ---- Layer 1: business email login (Supabase Auth) ----
  // Gates DB access. Skipped entirely when Supabase isn't configured (local-only).
  if (await isSupabaseConfigured()) {
    // Detect a password-recovery link BEFORE supabase-js cleans the URL hash.
    const recoveryInUrl = /type=recovery/.test(location.hash || '');

    const session = await supaAuth.getSession(); // creates client, processes URL hash

    if (recoveryInUrl) {
      // Opened from a recovery email → let the user set a new password first.
      AuthGate.showResetPassword({ onDone: continueBoot });
      return;
    }
    // Require email login only when there's no session AND no stored token. The
    // stored-token check keeps returning devices usable offline (when supabase-js
    // can't load from CDN to validate the session).
    if (!session && !supaAuth.hasStoredSession()) {
      AuthGate.showEmailLogin({ onSuccess: continueBoot });
      return;
    }
  }
  continueBoot();
}

// ---- Layer 2: start sync + gate on the in-app staff identity/role ----
async function continueBoot() {
  // Start Supabase sync (offline-first). No-op if Supabase isn't configured —
  // the app keeps working on localStorage either way.
  const syncPromise = initSync({
    onRemoteChange: () => { if (appStarted) { renderRoute(); updateActiveKPI(); } },
    onStatus: updateSyncStatus,
  }).then((e) => { syncEngine = e; }).catch((e) => console.warn('[Sync] init error', e));

  // If the system looks adminless (no active manager — fresh device or demo-only
  // data), wait briefly for the initial pull: a manager may live on the server.
  if (SessionManager.needsBootstrap()) {
    await Promise.race([syncPromise, new Promise((r) => setTimeout(r, 4000))]);
  }

  // Gate the app behind the in-app staff identity.
  if (SessionManager.needsBootstrap()) {
    // Still no manager after sync → force bootstrap/recovery before using the app,
    // even if a non-manager session exists on this device.
    AuthGate.show({ onAuthenticated: startApp });
  } else if (SessionManager.isAuthenticated()) {
    startApp();
  } else {
    AuthGate.show({ onAuthenticated: startApp });
  }
}

// Render the app proper once a session exists.
function startApp() {
  appStarted = true;
  // Ensure the auth overlay is fully dismissed regardless of which gate path ran.
  const ar = document.getElementById('auth-root');
  if (ar) { ar.hidden = true; ar.innerHTML = ''; }
  updateAccountBlock();

  // Default hash
  if (!location.hash) location.hash = '#dashboard';

  renderRoute();
  renderI18n();

  // Nudge passwordless users to set a PIN.
  if (sessionStorage.getItem('pin_nudge')) {
    sessionStorage.removeItem('pin_nudge');
    setTimeout(() => Toast.show(t('auth_pin_nudge'), '', 6000), 800);
  }

  // First-run hint: if no data at all, suggest seed
  const hasAnyData =
    (state.get('motors') || []).length > 0 ||
    (state.get('rentals') || []).length > 0 ||
    (state.get('owners') || []).length > 0;

  if (!hasAnyData) {
    setTimeout(() => {
      Toast.show(t('toast_first_run'), '', 5000);
    }, 600);
  }
}

document.addEventListener('DOMContentLoaded', boot);
