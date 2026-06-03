// =============================================================
// pages/owners.js
// =============================================================

import { OwnerManager } from '../modules/owners.js';
import { MotorManager } from '../modules/motors.js';
import { RentalManager } from '../modules/rentals.js';
import { formatIDR, escapeHTML } from '../modules/utils.js';
import { t } from '../modules/i18n.js';

let currentType = 'all'; // all | property | staff | partner

export function renderOwners() {
  const owners = OwnerManager.list();
  const ym = new Date().toISOString().slice(0, 7);
  const completed = RentalManager.completed().filter(r => (r.createdAt || '').slice(0, 7) === ym);

  let filtered = owners;
  if (currentType !== 'all') filtered = owners.filter(o => o.type === currentType);

  const enriched = filtered.map(o => {
    const motors = MotorManager.byOwner(o.id);
    const rentals = completed.filter(r => r.ownerId === o.id);
    return {
      ...o,
      motorCount: motors.length,
      rentedCount: motors.filter(m => m.status === 'rented').length,
      rentalCount: rentals.length,
      monthEarning: rentals.reduce((s, r) => s + (r.payToOwner || 0), 0),
    };
  }).sort((a, b) => b.monthEarning - a.monthEarning);

  const typeCounts = { all: owners.length, property: 0, staff: 0, partner: 0 };
  owners.forEach(o => { if (typeCounts[o.type] !== undefined) typeCounts[o.type]++; });

  const emptyState = `
    <div class="card"><div class="empty">
      <div class="empty__icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      </div>
      <p class="empty__title">${t('empty_owners')}</p>
    </div></div>
  `;

  const filterBar = `
    <div class="toolbar">
      <div class="segmented">
        <button class="segmented__opt ${currentType === 'all' ? 'is-active' : ''}" data-owner-type="all">${t('owner_filter_all', { n: typeCounts.all })}</button>
        <button class="segmented__opt ${currentType === 'property' ? 'is-active' : ''}" data-owner-type="property">${t('cat_property')} (${typeCounts.property})</button>
        <button class="segmented__opt ${currentType === 'staff' ? 'is-active' : ''}" data-owner-type="staff">${t('cat_staff')} (${typeCounts.staff})</button>
        <button class="segmented__opt ${currentType === 'partner' ? 'is-active' : ''}" data-owner-type="partner">${t('cat_non_staff')} (${typeCounts.partner})</button>
      </div>
    </div>
  `;

  const listBody = enriched.length === 0
    ? `<div class="card"><div class="empty"><p class="empty__title">${t('owner_no_match')}</p></div></div>`
    : `<div class="bento">
        ${enriched.map(o => `
          <div class="card span-4" style="cursor:pointer" data-action="edit-owner" data-id="${o.id}">
            <div class="row row--between" style="margin-bottom:12px">
              <div>
                <div style="font-family:var(--font-display);font-weight:800;font-size:18px">${escapeHTML(o.name)}</div>
                <div class="muted" style="font-size:13px;margin-top:2px">${ownerTypeLabel(o.type)}</div>
              </div>
              ${ownerTypeBadge(o.type)}
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding-top:12px;border-top:1px solid var(--border-subtle)">
              <div>
                <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em">Motor</div>
                <div style="font-weight:700;margin-top:2px;font-size:18px">${o.motorCount}</div>
                <div class="muted" style="font-size:11px">${t('owner_card_rented', { n: o.rentedCount })}</div>
              </div>
              <div>
                <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em">Rental</div>
                <div style="font-weight:700;margin-top:2px;font-size:18px">${o.rentalCount}</div>
                <div class="muted" style="font-size:11px">${t('owner_card_this_month')}</div>
              </div>
              <div>
                <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em">Earning</div>
                <div style="font-weight:700;margin-top:2px;font-size:14px;color:var(--success)">${formatIDR(o.monthEarning)}</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>`;

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_owners')}</h1>
        <p class="page__lede">${t('owner_lede', { n: owners.length })}</p>
      </div>
      <button class="btn" data-action="new-owner" data-requires="owner.edit">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${t('btn_add_owner')}
      </button>
    </div>

    ${owners.length === 0 ? emptyState : filterBar + listBody}
  `;
}

export function setupOwnersPage(rerender) {
  const content = document.getElementById('content');
  content.querySelectorAll('[data-owner-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentType = btn.dataset.ownerType;
      rerender();
    });
  });
}

function ownerTypeLabel(type) {
  return type === 'property' ? `A — ${t('cat_property')}` : type === 'staff' ? `B — ${t('cat_staff')}` : `C — ${t('cat_non_staff')}`;
}
function ownerTypeBadge(type) {
  const cls = type === 'property' ? 'info' : type === 'staff' ? 'success' : 'warning';
  const lbl = type === 'property' ? t('cat_property') : type === 'staff' ? t('cat_staff') : t('cat_non_staff');
  return `<span class="badge badge--${cls}">${lbl}</span>`;
}