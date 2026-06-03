// ============================================================
// app.js — Entry point. Hash router + global wiring.
// Loads all pages, manages navigation, theme, seed, and
// delegated data-action handlers.
// ============================================================

import { state, SYNCED_KEYS } from './state.js';
import { storage } from './storage.js';
import { initSync } from './supabase.js';
import { loadSeedData } from './seed.js';
import { Modal, Toast } from './ui/notify.js';
import { AuditManager, AuditEntities, AuditActions } from './audit.js';
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
import { renderStaff, setupStaffPage, openStaffForm } from '../pages/staff.js';
import { renderDamages, renderSettings } from '../pages/extras.js';

import { RentalManager, RentalStatus } from './rentals.js';

// ---------- Route registry ----------
const ROUTE_KEYS = {
  dashboard: 'route_dashboard',
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
const $btnSeed   = document.getElementById('btn-seed');
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
  const route = getRoute();
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

  // Update active rentals KPI
  updateActiveKPI();

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

// ---------- Seed / Reset ----------
async function handleSeed() {
  const confirmed = await Modal.confirm({
    title: 'Muat Data Demo?',
    message: 'Ini akan mengisi 14 owner, 28 motor, dan 10 rental contoh. Data lama akan ditimpa.',
    confirmText: 'Muat Demo',
    cancelText: 'Batal',
  });
  if (!confirmed) return;
  loadSeedData();
  // Bulk replace bypasses the per-record outbox — queue everything for upload.
  SYNCED_KEYS.forEach((k) => state.markCollectionDirty(k));
  AuditManager.log({
    entity: AuditEntities.SYSTEM, entityId: null,
    entityLabel: 'Demo data', action: AuditActions.SEED,
  });
  Toast.success('Data demo berhasil dimuat');
  renderRoute();
}

async function handleReset() {
  const confirmed = await Modal.confirm({
    title: 'Reset Semua Data?',
    message: 'Tindakan ini akan menghapus seluruh data motor, rental, owner, dan kerusakan. Tidak bisa dibatalkan.',
    confirmText: 'Ya, Hapus Semua',
    cancelText: 'Batal',
    variant: 'danger',
  });
  if (!confirmed) return;
  storage.clearAll();
  // Reload state from cleared storage
  ['motors', 'rentals', 'owners', 'damages', 'staff', 'auditLog'].forEach((k) => state.set(k, []));
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
      ['motors', 'rentals', 'owners', 'damages', 'staff', 'auditLog', 'settings'].forEach((k) => {
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

// ---------- Delegated action handler ----------
function handleAction(action, el) {
  switch (action) {
    case 'new-rental':
      openRentalForm();
      break;
    case 'open-rental': {
      const id = el.dataset.id;
      if (id) openRentalDetail(id);
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
  $btnSeed?.addEventListener('click', handleSeed);
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
function boot() {
  // Migrate first (safe — non-destructive)
  migrate();

  // Apply saved theme + sidebar collapsed state (R12)
  const settings = state.get('settings') || {};
  applyTheme(settings.theme || 'light');
  applySidebarCollapsed(!!settings.sidebarCollapsed);

  // Wire events
  bindEvents();

  // Default hash
  if (!location.hash) location.hash = '#dashboard';

  // Listen for language changes
  window.addEventListener('lang:change', () => {
    renderRoute();
    renderI18n();
  });

  // Initial render
  renderRoute();
  renderI18n();

  // Start Supabase sync (offline-first). No-op if modules/config.js is absent
  // or SYNC_ENABLED=false — the app keeps working on localStorage either way.
  initSync({
    onRemoteChange: () => { renderRoute(); updateActiveKPI(); },
    onStatus: updateSyncStatus,
  }).catch((e) => console.warn('[Sync] init error', e));

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
