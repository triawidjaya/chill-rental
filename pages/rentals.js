// =============================================================
// pages/rentals.js
// =============================================================

import { RentalManager, renderRentalBadge } from '../modules/rentals.js';
import { formatIDR, formatDate, escapeHTML, toCSV, downloadFile } from '../modules/utils.js';
import { t } from '../modules/i18n.js';

let currentFilter = 'all'; // all | active | completed
let currentSearch = '';

export function renderRentals() {
  let list = RentalManager.list();
  const isReturned = (r) => r.status === 'returned' || r.status === 'completed';
  if (currentFilter === 'active') list = list.filter(r => r.status === 'active');
  else if (currentFilter === 'completed') list = list.filter(isReturned);
  else if (currentFilter === 'awaiting-payment') list = list.filter(r => isReturned(r) && !r.paid);
  else if (currentFilter === 'awaiting-settle')  list = list.filter(r => isReturned(r) && r.paid && !r.ownerSettled);
  else if (currentFilter === 'damage-pending')   list = list.filter(r => r.newDamage && !r.damageResolved && r.status !== 'cancelled');
  else if (currentFilter === 'fully-done')       list = list.filter(r => isReturned(r) && r.paid && r.ownerSettled && r.damageResolved);

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(r =>
      r.guestName?.toLowerCase().includes(q) ||
      r.motorPlate?.toLowerCase().includes(q) ||
      r.ownerName?.toLowerCase().includes(q)
    );
  }

  // Sort: active first, then by createdAt desc
  list = [...list].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  const counts = {
    all: RentalManager.list().length,
    active: RentalManager.active().length,
    awaitingPayment: RentalManager.awaitingPayment().length,
    awaitingSettle: RentalManager.awaitingOwnerSettle().length,
    damagePending: RentalManager.damagePending().length,
    fullyDone: RentalManager.fullyDone().length,
    completed: RentalManager.completed().length,
  };

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_rentals')}</h1>
        <p class="page__lede">${t('page_rentals_manage_all') || 'Kelola semua transaksi sewa motor'}</p>
      </div>
      <div class="row">
        <button class="btn btn--ghost btn--sm" data-action="export-rentals">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
      </div>
    </div>

    <div class="toolbar toolbar--stacked">
      <div class="filter-row">
        <button class="btn btn--ghost btn--sm filter-reset" data-action="reset-rental-filter" ${currentFilter === 'all' && !currentSearch ? 'disabled' : ''}>
          ↻ Reset
        </button>
        <div class="toolbar__search" style="flex:1">
          <span class="toolbar__search-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input class="input" type="search" placeholder="${t('page_search_placeholder_rentals') || 'Cari nama, plat, owner...'}" value="${escapeHTML(currentSearch)}" id="rental-search" />
        </div>
      </div>

      <div class="filter-group-row">
        <span class="filter-group-label">${t('page_filter_status')}</span>
        <div class="segmented" role="tablist">
          <button class="segmented__opt ${currentFilter === 'active' ? 'is-active' : ''}" data-filter="active" title="${t('page_filter_motor_active')}">🟢 ${t('badge_active')} <span class="filter-count">${counts.active}</span></button>
          <button class="segmented__opt ${currentFilter === 'awaiting-payment' ? 'is-active' : ''}" data-filter="awaiting-payment" title="${t('page_filter_awaiting_payment_title')}">🟡 ${t('badge_awaiting_payment')} <span class="filter-count">${counts.awaitingPayment}</span></button>
          <button class="segmented__opt ${currentFilter === 'awaiting-settle' ? 'is-active' : ''}" data-filter="awaiting-settle" title="${t('page_filter_awaiting_settle_title')}">🔵 Settle <span class="filter-count">${counts.awaitingSettle}</span></button>
          <button class="segmented__opt ${currentFilter === 'damage-pending' ? 'is-active' : ''}" data-filter="damage-pending" title="${t('page_filter_damage_pending_title')}">🟠 ${t('badge_damage_pending')} <span class="filter-count">${counts.damagePending}</span></button>
          <button class="segmented__opt ${currentFilter === 'fully-done' ? 'is-active' : ''}" data-filter="fully-done" title="${t('page_filter_fully_done_title')}">✅ ${t('badge_completed')} <span class="filter-count">${counts.fullyDone}</span></button>
        </div>
      </div>
    </div>

    ${list.length === 0 ? `
      <div class="card">
        <div class="empty">
          <div class="empty__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
          </div>
           <p class="empty__title">${t('empty_rentals')}</p>
            <p>Coba ubah filter atau buat rental baru</p>
        </div>
      </div>
    ` : `
      <!-- Desktop table -->
      <div class="table-wrap" style="display:none" data-view="desktop">
        <table class="table">
          <thead>
            <tr>
               <th>${t('export_guest')}</th>
               <th>${t('export_motor')}</th>
               <th>${t('detail_owner')}</th>
               <th>${t('export_start')}</th>
               <th>${t('export_finish')}</th>
               <th>${t('export_days')}</th>
               <th>${t('export_total')}</th>
               <th>${t('export_status')}</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(r => `
              <tr data-action="open-rental" data-id="${r.id}">
                <td>
                  <strong>${escapeHTML(r.guestName)}</strong>
                  ${r.status === 'active' ? (r.passportHeld
                    ? '<span class="badge badge--warning" style="margin-left:6px;font-size:10px">📘 Passport</span>'
                    : '<span class="badge" style="margin-left:6px;font-size:10px">🏠 In-house</span>') : ''}
                </td>
                <td>${escapeHTML(r.motorPlate)}<div class="muted" style="font-size:12px">${escapeHTML(r.motorDescription)}</div></td>
                <td>${escapeHTML(r.ownerName || '—')}</td>
                <td>${formatDate(r.startDate)}</td>
                <td>${formatDate(r.actualFinishDate || r.finishDate)}</td>
                <td>${r.totalDays}</td>
                <td><strong>${formatIDR(r.totalCost)}</strong></td>
                <td>${statusBadge(r.status, r)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <!-- Mobile cards -->
      <div class="list-card" data-view="mobile">
        ${list.map(r => `
          <div class="list-item" data-action="open-rental" data-id="${r.id}">
            <div class="list-item__main">
              <div class="list-item__title-row">
                <span class="list-item__title">${escapeHTML(r.guestName)}</span>
                ${r.status === 'active' ? (r.passportHeld
                  ? '<span class="badge badge--warning" style="font-size:10px">📘</span>'
                  : '<span class="badge" style="font-size:10px">🏠</span>') : ''}
                ${statusBadge(r.status, r)}
              </div>
              <div class="list-item__sub">${escapeHTML(r.motorPlate)} · ${escapeHTML(r.motorDescription)}</div>
              <div class="muted" style="font-size:12px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${formatDate(r.startDate)} → ${formatDate(r.actualFinishDate || r.finishDate)} · ${r.totalDays} hari</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700">${formatIDR(r.totalCost)}</div>
              <div class="muted" style="font-size:12px;margin-top:4px">${escapeHTML(r.ownerName || '')}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <style>
        @media (min-width: 800px) {
          [data-view="desktop"] { display: block !important; }
          [data-view="mobile"] { display: none !important; }
        }
      </style>
    `}
  `;
}

function statusBadge(status, rental) {
  // R7: gunakan badge multi-flag jika rental diberikan
  if (rental) return renderRentalBadge(rental);
  // Fallback (status only, untuk backward-compat)
  if (status === 'active') return '<span class="badge badge--success">🟢 Aktif</span>';
  if (status === 'returned' || status === 'completed') return '<span class="badge">Returned</span>';
  if (status === 'cancelled') return '<span class="badge badge--danger">⚪ Batal</span>';
  return '<span class="badge">' + status + '</span>';
}

export function setupRentalsPage(rerender) {
  const content = document.getElementById('content');
  // Klik chip aktif → toggle off (back to 'all')
  content.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = (currentFilter === btn.dataset.filter) ? 'all' : btn.dataset.filter;
      rerender();
    });
  });
  content.querySelector('[data-action="reset-rental-filter"]')?.addEventListener('click', () => {
    currentFilter = 'all';
    currentSearch = '';
    rerender();
  });

  const search = content.querySelector('#rental-search');
  if (search) {
    let t;
    search.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        currentSearch = e.target.value;
        rerender();
      }, 200);
    });
  }

  content.querySelector('[data-action="export-rentals"]')?.addEventListener('click', () => {
    const rentals = RentalManager.list();
    const csv = toCSV(rentals, [
      { label: 'Guest', value: 'guestName' },
      { label: 'WA', value: 'wa' },
      { label: 'Email', value: 'email' },
      { label: 'Passport', value: 'passportNo' },
      { label: 'Motor', value: 'motorPlate' },
      { label: 'Description', value: 'motorDescription' },
      { label: 'Owner', value: 'ownerName' },
      { label: 'Start', value: r => formatDate(r.startDate) },
      { label: 'Finish', value: r => formatDate(r.actualFinishDate || r.finishDate) },
      { label: 'Days', value: 'totalDays' },
      { label: 'Total', value: 'totalCost' },
      { label: 'Pay to Owner', value: 'payToOwner' },
      { label: 'Commission', value: 'commission' },
      { label: 'Damage Charge', value: 'damageCharge' },
      { label: 'Damage Description', value: 'damageDescription' },
      { label: 'Payment', value: 'paymentMethod' },
      { label: 'Paid', value: r => r.paid ? 'Yes' : 'No' },
      { label: 'Owner Settled', value: r => r.ownerSettled ? 'Yes' : 'No' },
      { label: 'Status', value: 'status' },
    ]);
    downloadFile(csv, `rentals_${new Date().toISOString().slice(0, 10)}.csv`);
  });
}
