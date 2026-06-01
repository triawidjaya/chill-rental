// =============================================================
// pages/motors.js
// =============================================================

import { MotorManager } from '../modules/motors.js';
import { RentalManager } from '../modules/rentals.js';
import { formatIDR, escapeHTML } from '../modules/utils.js';
import { t } from '../modules/i18n.js';

let currentCat = 'all';
let currentStatus = 'all';
let currentSurfrack = 'all';
let currentSearch = '';

export function renderMotors() {
  let list = MotorManager.list();
  if (currentCat !== 'all') list = list.filter(m => m.category === currentCat);
  if (currentStatus !== 'all') list = list.filter(m => m.status === currentStatus);
  if (currentSurfrack === 'true') list = list.filter(m => m.hasSurfrack === true);
  if (currentSurfrack === 'false') list = list.filter(m => m.hasSurfrack !== true);
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(m =>
      m.plate?.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q) ||
      m.ownerName?.toLowerCase().includes(q)
    );
  }

  const all = MotorManager.list();
  const surfrackCount = MotorManager.withSurfrack().length;
  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_motors')}</h1>
        <p class="page__lede">${t('page_motors_lede', { total: all.length, rented: MotorManager.rented().length, available: MotorManager.available().length, surfrack: surfrackCount })}</p>
      </div>
      <button class="btn" data-action="new-motor">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${t('modal_add_motor')}
      </button>
    </div>

    <div class="toolbar toolbar--stacked">
      <div class="filter-row">
        <button class="btn btn--ghost btn--sm filter-reset" data-action="reset-motor-filters" ${currentCat === 'all' && currentStatus === 'all' && currentSurfrack === 'all' ? 'disabled' : ''}>
          ↻ Reset
        </button>
        <div class="toolbar__search" style="flex:1">
          <span class="toolbar__search-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" type="search" placeholder="${t('page_search_placeholder_motors')}" value="${escapeHTML(currentSearch)}" id="motor-search" />
        </div>
      </div>

      <div class="filter-group-row">
        <span class="filter-group-label">${t('page_filter_category')}</span>
        <div class="segmented">
          <button class="segmented__opt ${currentCat === 'A' ? 'is-active' : ''}" data-cat="A">${t('cat_property')}</button>
          <button class="segmented__opt ${currentCat === 'B' ? 'is-active' : ''}" data-cat="B">${t('cat_staff')}</button>
          <button class="segmented__opt ${currentCat === 'C' ? 'is-active' : ''}" data-cat="C">${t('cat_non_staff')}</button>
        </div>
      </div>

      <div class="filter-group-row">
        <span class="filter-group-label">${t('page_filter_status')}</span>
        <div class="segmented">
          <button class="segmented__opt ${currentStatus === 'available' ? 'is-active' : ''}" data-status="available">${t('page_available')}</button>
          <button class="segmented__opt ${currentStatus === 'rented' ? 'is-active' : ''}" data-status="rented">${t('page_rented')}</button>
        </div>
      </div>

      <div class="filter-group-row">
        <span class="filter-group-label">${t('page_filter_surfrack')}</span>
        <div class="segmented">
          <button class="segmented__opt ${currentSurfrack === 'true' ? 'is-active' : ''}" data-sr="true">${t('filter_surfrack_yes')}</button>
          <button class="segmented__opt ${currentSurfrack === 'false' ? 'is-active' : ''}" data-sr="false">${t('filter_surfrack_no')}</button>
        </div>
      </div>
    </div>

    ${list.length === 0 ? `
      <div class="card"><div class="empty">
        <div class="empty__icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l3 6"/><path d="M5.5 17.5L9 8h4l2.5 6"/></svg>
        </div>
        <p class="empty__title">${t('empty_motors')}</p>
      </div></div>
    ` : `
      <div class="bento">
        ${list.map(m => {
          const badges = [];
          if (m.hasSurfrack) badges.push('<span title="Surfrack">🏄</span>');
          if (m.phoneHolder) badges.push('<span title="Phone Holder">📱</span>');
          if (m.gps) badges.push('<span title="GPS">📍</span>');
          const accentStyle = m.status === 'rented'
            ? 'border-left:4px solid var(--warning,#d97706);background:var(--warning-soft,rgba(245,158,11,0.06))'
            : m.status === 'available'
            ? 'border-left:4px solid var(--success,#22c55e);background:rgba(34,197,94,0.04)'
            : '';
          return `
          <div class="card span-4" style="cursor:pointer;${accentStyle}" data-action="edit-motor" data-id="${m.id}">
            <div class="row row--between" style="margin-bottom:12px">
              <div>
                <div style="font-family:var(--font-display);font-weight:800;font-size:18px;letter-spacing:-0.02em">
                  ${escapeHTML(m.plate)}
                  ${badges.length ? `<span style="font-size:14px;margin-left:6px;letter-spacing:2px">${badges.join('')}</span>` : ''}
                </div>
                <div class="muted" style="font-size:13px;margin-top:2px">${escapeHTML(m.description)}</div>
              </div>
              ${m.status === 'rented'
                ? `<span class="badge badge--warning">${t('page_rented')}</span>`
                : m.status === 'available'
                ? `<span class="badge badge--success">${t('page_available')}</span>`
                : '<span class="badge badge--warning">' + m.status + '</span>'}
            </div>
            ${m.status === 'rented' && m.currentRentalId ? (() => {
              const rental = RentalManager.get(m.currentRentalId);
              const guest = rental?.guestName;
              return guest ? `<div style="font-size:12px;margin-top:6px;color:var(--brand);font-weight:600">👤 ${escapeHTML(guest)}</div>` : '';
            })() : ''}
            <div class="row" style="gap:16px;font-size:13px;flex-wrap:wrap">
              <div>
                <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em">Owner</div>
                <div style="font-weight:600;margin-top:2px">${escapeHTML(m.ownerName || '—')}</div>
              </div>
              <div>
                <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em">${t('form_motor_price_per_day')}</div>
                <div style="font-weight:600;margin-top:2px">${formatIDR(m.pricePerDay)}</div>
              </div>
              <div>
                <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em">${t('form_motor_pto_per_day')}</div>
                <div style="font-weight:600;margin-top:2px">${formatIDR(m.payToOwnerPerDay || 0)}</div>
              </div>
              <div>
                <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em">CC</div>
                <div style="font-weight:600;margin-top:2px">${escapeHTML(m.cc)}</div>
              </div>
            </div>
          </div>
        `;
        }).join('')}
      </div>
    `}
  `;
}

export function setupMotorsPage(rerender) {
  const content = document.getElementById('content');
  // Klik chip aktif → toggle off (kembali ke 'all'). Klik chip lain → set value baru.
  content.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
    currentCat = (currentCat === b.dataset.cat) ? 'all' : b.dataset.cat; rerender();
  }));
  content.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => {
    currentStatus = (currentStatus === b.dataset.status) ? 'all' : b.dataset.status; rerender();
  }));
  content.querySelectorAll('[data-sr]').forEach(b => b.addEventListener('click', () => {
    currentSurfrack = (currentSurfrack === b.dataset.sr) ? 'all' : b.dataset.sr; rerender();
  }));
  // Reset all filters
  content.querySelector('[data-action="reset-motor-filters"]')?.addEventListener('click', () => {
    currentCat = 'all';
    currentStatus = 'all';
    currentSurfrack = 'all';
    currentSearch = '';
    rerender();
  });
  const s = content.querySelector('#motor-search');
  if (s) {
    let t;
    s.addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { currentSearch = e.target.value; rerender(); }, 200);
    });
  }
}
