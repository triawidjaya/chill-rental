// =============================================================
// modules/ui/login.js
// Auth gate (Fase B.2): first-run Manager wizard + PIN login screen.
// Renders a full-screen overlay into #auth-root. Calls onAuthenticated()
// once a session is established.
// =============================================================

import { StaffManager } from '../staff.js';
import { SessionManager } from '../session.js';
import { supaAuth } from '../supabase.js';
import { isValidPinFormat } from '../crypto.js';
import { Toast } from './notify.js';
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
  // Layer 1 — business email login (Supabase Auth). Gates DB access.
  showEmailLogin({ onSuccess } = {}) {
    const r = root();
    if (r) r.hidden = false;
    renderEmailLogin(onSuccess || (() => {}));
  },

  // Password recovery — shown when the app opens from a recovery email link.
  showResetPassword({ onDone } = {}) {
    const r = root();
    if (r) r.hidden = false;
    renderResetPassword(onDone || (() => {}));
  },

  // Layer 2 — staff picker / first-run / recovery (in-app identity + role).
  show({ onAuthenticated } = {}) {
    _onAuth = onAuthenticated || (() => {});
    const r = root();
    if (r) r.hidden = false;
    if (SessionManager.needsRecovery()) renderRecover();      // staff exist, no manager
    else if (SessionManager.needsBootstrap()) renderBootstrap(); // zero staff (first run)
    else renderStaffPicker();
  },
};

// ---- Business email login (Supabase Auth) ----
function renderEmailLogin(onSuccess) {
  const r = root();
  r.innerHTML = shell(`
    <h2 class="auth-title">${t('auth_business_title')}</h2>
    <p class="auth-lede">${t('auth_business_lede')}</p>
    <div class="stack" style="gap:14px">
      <div class="field">
        <label class="field__label required" for="em-email">${t('auth_email')}</label>
        <input id="em-email" class="input" type="email" autocomplete="username" inputmode="email" placeholder="bisnis@contoh.com" />
      </div>
      <div class="field">
        <label class="field__label required" for="em-pass">${t('auth_password')}</label>
        <input id="em-pass" class="input" type="password" autocomplete="current-password" placeholder="••••••••" />
      </div>
      <p id="em-err" class="field__hint" style="color:var(--danger);min-height:1em"></p>
      <button class="btn btn--block" id="em-go">${t('auth_signin')}</button>
      <button class="auth-link" id="em-forgot">${t('auth_forgot')}</button>
    </div>
  `);

  const err = r.querySelector('#em-err');
  const email = r.querySelector('#em-email');
  const pass = r.querySelector('#em-pass');
  const btn = r.querySelector('#em-go');
  setTimeout(() => email.focus(), 60);
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
  r.querySelector('#em-forgot').addEventListener('click', () => renderForgotPassword(onSuccess, email.value.trim()));

  btn.addEventListener('click', async () => {
    err.textContent = '';
    const e = email.value.trim();
    const p = pass.value;
    if (!e || !p) { err.textContent = t('auth_err_signin'); return; }
    btn.disabled = true;
    btn.textContent = t('auth_signing_in');
    const res = await supaAuth.signIn(e, p);
    btn.disabled = false;
    btn.textContent = t('auth_signin');
    if (res.ok) { onSuccess(); }
    else { err.textContent = res.error || t('auth_err_signin'); pass.value = ''; pass.focus(); }
  });
}

function done() {
  hide();
  _onAuth();
}

// ---- Forgot password: send a recovery email ----
function renderForgotPassword(onSuccess, prefillEmail = '') {
  const r = root();
  r.innerHTML = shell(`
    <button class="auth-back" id="fp-back">← ${t('auth_back_to_login')}</button>
    <h2 class="auth-title">${t('auth_forgot_title')}</h2>
    <p class="auth-lede">${t('auth_forgot_lede')}</p>
    <div class="stack" style="gap:14px">
      <div class="field">
        <label class="field__label required" for="fp-email">${t('auth_email')}</label>
        <input id="fp-email" class="input" type="email" inputmode="email" autocomplete="username"
               value="${escapeText(prefillEmail)}" placeholder="bisnis@contoh.com" />
      </div>
      <p id="fp-msg" class="field__hint" style="min-height:1em"></p>
      <button class="btn btn--block" id="fp-go">${t('auth_send_reset')}</button>
    </div>
  `);

  const email = r.querySelector('#fp-email');
  const msg = r.querySelector('#fp-msg');
  const btn = r.querySelector('#fp-go');
  setTimeout(() => email.focus(), 60);
  email.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
  r.querySelector('#fp-back').addEventListener('click', () => renderEmailLogin(onSuccess));

  btn.addEventListener('click', async () => {
    const e = email.value.trim();
    msg.style.color = 'var(--danger)';
    if (!e) { msg.textContent = t('auth_err_email_required'); return; }
    btn.disabled = true; btn.textContent = t('auth_sending');
    const res = await supaAuth.requestPasswordReset(e);
    btn.disabled = false; btn.textContent = t('auth_send_reset');
    if (res.ok) {
      msg.style.color = 'var(--text-secondary)';
      msg.textContent = t('auth_reset_sent');
    } else {
      msg.textContent = res.error || t('auth_err_generic');
    }
  });
}

// ---- Reset password: set a new one (opened from the recovery email link) ----
function renderResetPassword(onDone) {
  const r = root();
  r.innerHTML = shell(`
    <h2 class="auth-title">${t('auth_reset_title')}</h2>
    <p class="auth-lede">${t('auth_reset_lede')}</p>
    <div class="stack" style="gap:14px">
      <div class="field">
        <label class="field__label required" for="rp-1">${t('auth_new_password')}</label>
        <input id="rp-1" class="input" type="password" autocomplete="new-password" placeholder="••••••••" />
      </div>
      <div class="field">
        <label class="field__label required" for="rp-2">${t('auth_confirm_password')}</label>
        <input id="rp-2" class="input" type="password" autocomplete="new-password" placeholder="••••••••" />
      </div>
      <p id="rp-err" class="field__hint" style="color:var(--danger);min-height:1em"></p>
      <button class="btn btn--block" id="rp-go">${t('auth_save_password')}</button>
    </div>
  `);

  const p1 = r.querySelector('#rp-1');
  const p2 = r.querySelector('#rp-2');
  const err = r.querySelector('#rp-err');
  const btn = r.querySelector('#rp-go');
  setTimeout(() => p1.focus(), 60);
  p2.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });

  btn.addEventListener('click', async () => {
    err.textContent = '';
    if ((p1.value || '').length < 6) { err.textContent = t('auth_err_password_short'); return; }
    if (p1.value !== p2.value) { err.textContent = t('auth_err_password_mismatch'); return; }
    btn.disabled = true; btn.textContent = t('auth_signing_in');
    const res = await supaAuth.updatePassword(p1.value);
    btn.disabled = false; btn.textContent = t('auth_save_password');
    if (res.ok) {
      Toast.success(t('auth_password_updated'));
      onDone();
    } else {
      err.textContent = res.error || t('auth_err_generic');
    }
  });
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
      ${StaffManager.list().length > 0
        ? `<button class="auth-link" id="bs-to-recover">${t('auth_create_or_recover')}</button>` : ''}
    </div>
  `);

  const err = r.querySelector('#bs-err');
  const pin = r.querySelector('#bs-pin');
  pin.addEventListener('input', () => { pin.value = pin.value.replace(/\D/g, ''); });
  r.querySelector('#bs-to-recover')?.addEventListener('click', renderRecover);

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

// ---- Recovery: no manager exists — promote an existing staff member ----
function renderRecover() {
  const r = root();
  const staff = StaffManager.active()
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  r.innerHTML = shell(`
    <h2 class="auth-title">${t('auth_recover_title')}</h2>
    <p class="auth-lede">${t('auth_recover_lede')}</p>
    <div class="stack" style="gap:14px">
      <div class="field">
        <label class="field__label required" for="rc-staff">${t('auth_pick_staff')}</label>
        <select id="rc-staff" class="select">
          ${staff.map(s => `<option value="${s.id}">${escapeText(s.name)}${s.role ? ' · ' + escapeText(roleLabel(s.role)) : ''}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="rc-pin">${t('auth_pin_optional')}</label>
        <input id="rc-pin" class="input" type="password" inputmode="numeric" maxlength="6" placeholder="••••" autocomplete="off" />
        <span class="field__hint">${t('form_staff_pin_hint')}</span>
      </div>
      <p id="rc-err" class="field__hint" style="color:var(--danger);min-height:1em"></p>
      <button class="btn btn--block" id="rc-go">${t('auth_promote_login')}</button>
      <button class="auth-link" id="rc-to-create">${t('auth_recover_or_new')}</button>
    </div>
  `);

  const err = r.querySelector('#rc-err');
  const pin = r.querySelector('#rc-pin');
  pin.addEventListener('input', () => { pin.value = pin.value.replace(/\D/g, ''); });
  r.querySelector('#rc-to-create').addEventListener('click', renderBootstrap);

  r.querySelector('#rc-go').addEventListener('click', async () => {
    const staffId = r.querySelector('#rc-staff').value;
    const pinVal = pin.value;
    err.textContent = '';
    if (!staffId) { err.textContent = t('auth_err_generic'); return; }
    if (pinVal && !isValidPinFormat(pinVal)) { err.textContent = t('pin_err_format'); return; }
    try {
      StaffManager.update(staffId, { role: 'manager' });   // promote
      if (pinVal) await SessionManager.setPin(staffId, pinVal);
      const res = await SessionManager.login(staffId, pinVal || undefined);
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
