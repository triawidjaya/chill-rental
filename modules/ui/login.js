// =============================================================
// modules/ui/login.js
// Auth gate (Fase B.2): first-run Manager wizard + PIN login screen.
// Renders a full-screen overlay into #auth-root. Calls onAuthenticated()
// once a session is established.
// =============================================================

import { StaffManager } from '../staff.js';
import { SessionManager } from '../session.js';
import { isValidPinFormat } from '../crypto.js';
import { t } from '../i18n.js';

let _root = null;
let _onAuth = () => {};

function root() {
  if (!_root) _root = document.getElementById('auth-root');
  return _root;
}

function clear() { const r = root(); if (r) r.innerHTML = ''; }
function hide()  { const r = root(); if (r) { r.innerHTML = ''; r.hidden = true; } }

const shell = (inner) => `
  <div class="auth-overlay">
    <div class="auth-card card">
      <div class="auth-brand">
        <div class="brand-mark" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l3 6"/><path d="M5.5 17.5L9 8h4l2.5 6"/></svg>
        </div>
        <h1>Chill Rental</h1>
      </div>
      ${inner}
    </div>
  </div>
`;

// ---- Entry point ----
export const AuthGate = {
  show({ onAuthenticated } = {}) {
    _onAuth = onAuthenticated || (() => {});
    const r = root();
    if (r) r.hidden = false;
    if (SessionManager.needsBootstrap()) renderBootstrap();
    else renderStaffPicker();
  },
};

function done() {
  hide();
  _onAuth();
}

// ---- First-run: create the first Manager ----
function renderBootstrap() {
  const r = root();
  r.innerHTML = shell(`
    <h2 class="auth-title">${t('auth_welcome_title')}</h2>
    <p class="auth-lede">${t('auth_welcome_lede')}</p>
    <div class="stack" style="gap:14px">
      <div class="field">
        <label class="field__label required" for="bs-name">${t('form_staff_name')}</label>
        <input id="bs-name" class="input" placeholder="${t('form_staff_name_placeholder')}" autocomplete="off" />
      </div>
      <div class="field">
        <label class="field__label" for="bs-pin">${t('auth_pin_optional')}</label>
        <input id="bs-pin" class="input" type="password" inputmode="numeric" maxlength="6" placeholder="••••" autocomplete="off" />
        <span class="field__hint">${t('form_staff_pin_hint')}</span>
      </div>
      <p id="bs-err" class="field__hint" style="color:var(--danger);min-height:1em"></p>
      <button class="btn btn--block" id="bs-go">${t('auth_create_manager')}</button>
    </div>
  `);

  const err = r.querySelector('#bs-err');
  const pin = r.querySelector('#bs-pin');
  pin.addEventListener('input', () => { pin.value = pin.value.replace(/\D/g, ''); });

  r.querySelector('#bs-go').addEventListener('click', async () => {
    const name = r.querySelector('#bs-name').value.trim();
    const pinVal = pin.value;
    err.textContent = '';
    if (!name) { err.textContent = t('auth_err_name'); return; }
    if (pinVal && !isValidPinFormat(pinVal)) { err.textContent = t('pin_err_format'); return; }
    try {
      const staff = StaffManager.create({ name, role: 'manager', active: true });
      if (pinVal) await SessionManager.setPin(staff.id, pinVal);
      const res = await SessionManager.login(staff.id, pinVal || undefined);
      if (res.ok) done();
      else err.textContent = t('auth_err_generic');
    } catch (e) {
      err.textContent = e.message || t('auth_err_generic');
    }
  });
}

// ---- Returning: pick a staff member ----
function renderStaffPicker() {
  const r = root();
  const staff = StaffManager.active()
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  r.innerHTML = shell(`
    <h2 class="auth-title">${t('auth_login_title')}</h2>
    <p class="auth-lede">${t('auth_login_lede')}</p>
    <div class="auth-staff-list">
      ${staff.map(s => `
        <button class="auth-staff" data-staff="${s.id}">
          <span class="auth-staff__avatar">${escapeInitial(s.name)}</span>
          <span class="auth-staff__main">
            <span class="auth-staff__name">${escapeText(s.name)}</span>
            <span class="auth-staff__role">${escapeText(roleLabel(s.role))}</span>
          </span>
          <span class="auth-staff__lock">${SessionManager.hasPin(s) ? lockIcon() : ''}</span>
        </button>
      `).join('')}
    </div>
  `);

  r.querySelectorAll('[data-staff]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = StaffManager.get(btn.dataset.staff);
      if (!s) return;
      if (SessionManager.hasPin(s)) renderPinEntry(s);
      else loginPasswordless(s);
    });
  });
}

async function loginPasswordless(staff) {
  const res = await SessionManager.login(staff.id);
  if (res.ok) {
    // Per migration policy: passwordless login is allowed, but nudge to set a PIN.
    sessionStorage.setItem('pin_nudge', '1');
    done();
  }
}

// ---- PIN entry for a chosen staff ----
function renderPinEntry(staff) {
  const r = root();
  r.innerHTML = shell(`
    <button class="auth-back" id="pin-back">← ${t('btn_back')}</button>
    <h2 class="auth-title">${t('auth_hello', { name: escapeText(staff.name) })}</h2>
    <p class="auth-lede">${t('auth_enter_pin')}</p>
    <div class="stack" style="gap:12px">
      <input id="pin-input" class="input auth-pin-input" type="password" inputmode="numeric"
             maxlength="6" placeholder="••••" autocomplete="off" />
      <p id="pin-err" class="field__hint" style="color:var(--danger);min-height:1em"></p>
      <button class="btn btn--block" id="pin-go">${t('auth_login')}</button>
    </div>
  `);

  const input = r.querySelector('#pin-input');
  const err = r.querySelector('#pin-err');
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => input.focus(), 60);

  r.querySelector('#pin-back').addEventListener('click', renderStaffPicker);
  r.querySelector('#pin-go').addEventListener('click', submit);

  async function submit() {
    err.textContent = '';
    const res = await SessionManager.login(staff.id, input.value);
    if (res.ok) { done(); return; }
    if (res.reason === 'wrong_pin') err.textContent = t('auth_err_wrong_pin');
    else if (res.reason === 'pin_required') err.textContent = t('auth_err_pin_required');
    else err.textContent = t('auth_err_generic');
    input.value = '';
    input.focus();
  }
}

// ---- tiny helpers (self-contained to avoid extra imports) ----
function escapeText(str) {
  return String(str || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escapeInitial(name) {
  const c = (String(name || '').trim()[0] || '?').toUpperCase();
  return escapeText(c);
}
function roleLabel(role) {
  return t(`role_${role}`) !== `[role_${role}]` ? t(`role_${role}`) : (role || 'staff');
}
function lockIcon() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
}
