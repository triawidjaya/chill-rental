// =============================================================
// pages/staff.js — Halaman Staff Management
// =============================================================

import { StaffManager, StaffRoles } from '../modules/staff.js';
import { escapeHTML, formatDate, bindSearchInput } from '../modules/utils.js';
import { Modal, Toast } from '../modules/ui/notify.js';
import { t } from '../modules/i18n.js';
import { SessionManager } from '../modules/session.js';
import { isValidPinFormat } from '../modules/crypto.js';

let currentFilter = 'all'; // all | active | inactive
let currentSearch = '';

const roleLabel = (val) => (StaffRoles.find(r => r.value === val)?.label) || val || '—';

export function renderStaff() {
  let list = StaffManager.list();
  if (currentFilter === 'active') list = list.filter(s => s.active !== false);
  else if (currentFilter === 'inactive') list = list.filter(s => s.active === false);

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.role?.toLowerCase().includes(q)
    );
  }

  // Sort: active first, then name A-Z
  list = list.slice().sort((a, b) => {
    if (!!a.active !== !!b.active) return a.active ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  const total = StaffManager.list().length;
  const activeCount = StaffManager.active().length;
  const inactiveCount = total - activeCount;

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_staff')}</h1>
        <p class="page__lede">${t('staff_lede', { total, active: activeCount, inactive: inactiveCount })}</p>
      </div>
      <button class="btn" data-action="new-staff" data-requires="staff.manage">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${t('btn_add_staff')}
      </button>
    </div>

    <div class="toolbar">
      <div class="segmented">
        <button class="segmented__opt ${currentFilter === 'all' ? 'is-active' : ''}" data-staff-filter="all">${t('staff_filter_all', { n: total })}</button>
        <button class="segmented__opt ${currentFilter === 'active' ? 'is-active' : ''}" data-staff-filter="active">${t('staff_filter_active', { n: activeCount })}</button>
        <button class="segmented__opt ${currentFilter === 'inactive' ? 'is-active' : ''}" data-staff-filter="inactive">${t('staff_filter_inactive', { n: inactiveCount })}</button>
      </div>
      <div class="toolbar__search">
        <span class="toolbar__search-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input class="input" type="search" placeholder="${t('page_search_placeholder_staff')}" value="${escapeHTML(currentSearch)}" id="staff-search" />
      </div>
    </div>

    ${list.length === 0 ? `
      <div class="card"><div class="empty">
        <div class="empty__icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        </div>
        <p class="empty__title">${t('empty_staff')}</p>
        <p>${t('staff_empty_hint')}</p>
      </div></div>
    ` : `
      <div class="list-card">
        ${list.map(s => `
          <div class="list-item" data-action="edit-staff" data-id="${s.id}" style="cursor:pointer">
            <div class="list-item__main">
              <div class="row" style="gap:8px;flex-wrap:nowrap;align-items:center">
                <span class="list-item__title">${escapeHTML(s.name)}</span>
                ${s.active === false ? `<span class="badge badge--warning" style="font-size:10px">${t('badge_inactive')}</span>` : `<span class="badge badge--success" style="font-size:10px">${t('badge_active')}</span>`}
              </div>
              <div class="list-item__sub">${escapeHTML(roleLabel(s.role))}${s.notes ? ' · ' + escapeHTML(s.notes) : ''}</div>
            </div>
            <div style="text-align:right;font-size:11px;color:var(--text-secondary)">
              ${t('staff_since', { date: formatDate(s.createdAt) })}
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

export function setupStaffPage(rerender) {
  const content = document.getElementById('content');

  content.querySelectorAll('[data-staff-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.staffFilter;
      rerender();
    });
  });

  bindSearchInput(content.querySelector('#staff-search'), (value) => {
    currentSearch = value;
    rerender();
  });
}

// ---------- Form modal (open from app.js handleAction) ----------
export function openStaffForm(staffId = null) {
  const s = staffId ? StaffManager.get(staffId) : null;

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <div class="field">
        <label class="field__label required" for="s-name">${t('form_staff_name')}</label>
        <input id="s-name" class="input" placeholder="${t('form_staff_name_placeholder')}" value="${escapeHTML(s?.name || '')}" required />
        <span class="field__hint">${t('form_staff_name_hint')}</span>
      </div>
      <div class="field-group">
        <div class="field">
          <label class="field__label" for="s-role">${t('form_staff_role')}</label>
          <select id="s-role" class="select">
            ${StaffRoles.map(r => `<option value="${r.value}" ${(s?.role || 'staff') === r.value ? 'selected' : ''}>${escapeHTML(r.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="s-active">${t('form_staff_status')}</label>
          <select id="s-active" class="select">
            <option value="true" ${s?.active !== false ? 'selected' : ''}>${t('form_staff_active')}</option>
            <option value="false" ${s?.active === false ? 'selected' : ''}>${t('form_staff_inactive')}</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="s-notes">${t('form_staff_notes')}</label>
        <textarea id="s-notes" class="textarea" placeholder="${t('form_staff_notes_placeholder')}">${escapeHTML(s?.notes || '')}</textarea>
      </div>
      ${s ? `
      <div class="field" style="border-top:1px solid var(--border-subtle);padding-top:14px">
        <label class="field__label">${t('form_staff_pin')}</label>
        <div class="row" style="gap:8px;align-items:center;justify-content:space-between">
          <span class="badge ${SessionManager.hasPin(s) ? 'badge--success' : 'badge--warning'}" style="font-size:11px">
            ${SessionManager.hasPin(s) ? t('staff_pin_set') : t('staff_pin_none')}
          </span>
          <button type="button" class="btn btn--ghost btn--sm" id="btn-set-pin">
            ${SessionManager.hasPin(s) ? t('btn_change_pin') : t('btn_set_pin')}
          </button>
        </div>
        <span class="field__hint">${t('form_staff_pin_hint')}</span>
      </div>
      ` : ''}
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
    ${s ? `<button class="btn btn--danger" id="btn-del-staff">${t('btn_delete')}</button>` : ''}
    <button class="btn" id="btn-save-staff">${t('btn_save')}</button>
  `;

  Modal.open({ title: s ? t('modal_edit_staff') : t('modal_add_staff'), body, footer });

  document.getElementById('btn-save-staff').addEventListener('click', () => {
    const data = {
      name: body.querySelector('#s-name').value,
      role: body.querySelector('#s-role').value,
      active: body.querySelector('#s-active').value === 'true',
      notes: body.querySelector('#s-notes').value,
    };
    try {
      if (s) StaffManager.update(s.id, data);
      else StaffManager.create(data);
      Modal.close();
      Toast.success(s ? t('toast_staff_updated') : t('toast_staff_added'));
      window.dispatchEvent(new CustomEvent('route:refresh'));
    } catch (e) {
      Toast.error(e.message);
    }
  });

  if (s) {
    document.getElementById('btn-set-pin')?.addEventListener('click', () => openPinDialog(s));

    document.getElementById('btn-del-staff').addEventListener('click', async () => {
      const ok = await Modal.confirm({
        title: t('confirm_staff_delete_title'),
        message: t('confirm_staff_delete_msg', { name: s.name }),
        variant: 'danger',
        confirmText: t('btn_delete'),
      });
      if (ok) {
        StaffManager.remove(s.id);
        Modal.close();
        Toast.success(t('toast_staff_deleted'));
        window.dispatchEvent(new CustomEvent('route:refresh'));
      }
    });
  }
}

// ---------- Set / change PIN dialog ----------
export function openPinDialog(staff) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <p style="color:var(--text-secondary);margin:0">${t('pin_dialog_lede', { name: escapeHTML(staff.name) })}</p>
      <div class="field">
        <label class="field__label required" for="pin-1">${t('pin_new')}</label>
        <input id="pin-1" class="input" type="password" inputmode="numeric" autocomplete="off"
               maxlength="6" placeholder="••••" />
      </div>
      <div class="field">
        <label class="field__label required" for="pin-2">${t('pin_confirm')}</label>
        <input id="pin-2" class="input" type="password" inputmode="numeric" autocomplete="off"
               maxlength="6" placeholder="••••" />
      </div>
      <p id="pin-err" class="field__hint" style="color:var(--danger);min-height:1em"></p>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
    <button class="btn" id="btn-save-pin">${t('btn_save')}</button>
  `;

  Modal.open({ title: t('pin_dialog_title'), body, footer });

  const err = body.querySelector('#pin-err');
  // Digits only as the user types.
  body.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, ''); });
  });

  document.getElementById('btn-save-pin').addEventListener('click', async () => {
    const p1 = body.querySelector('#pin-1').value;
    const p2 = body.querySelector('#pin-2').value;
    err.textContent = '';
    if (!isValidPinFormat(p1)) { err.textContent = t('pin_err_format'); return; }
    if (p1 !== p2)            { err.textContent = t('pin_err_mismatch'); return; }
    try {
      await SessionManager.setPin(staff.id, p1);
      Modal.close();
      Toast.success(t('toast_pin_saved'));
      window.dispatchEvent(new CustomEvent('route:refresh'));
    } catch (e) {
      err.textContent = e.message;
    }
  });
}
