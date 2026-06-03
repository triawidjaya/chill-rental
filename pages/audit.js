// =============================================================
// pages/audit.js
// Halaman Audit — 2 tab: Log Rental (filter multi-dim) + Trail (perubahan data)
// =============================================================

import { RentalManager, renderRentalBadge } from '../modules/rentals.js';
import { MotorManager } from '../modules/motors.js';
import { OwnerManager } from '../modules/owners.js';
import { AuditManager, AuditEntities } from '../modules/audit.js';
import { formatIDR, formatDate, formatDateTime, escapeHTML, toCSV, downloadFile, bindSearchInput } from '../modules/utils.js';
import { t } from '../modules/i18n.js';

// ----- Filter state (per session, reset on page load) -----
let currentTab = 'log';

const defaultMonthRange = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(first), to: fmt(last) };
};

let logFilters = {
  ...defaultMonthRange(),
  status: 'all',         // all | active | completed | cancelled
  ownerId: 'all',
  category: 'all',
  cc: 'all',
  surfrack: 'all',
  staffGiver: 'all',
  payment: 'all',
  damage: 'all',         // all | yes | no
  search: '',
};

let trailFilters = {
  entity: 'all',
  actor: 'all',
  search: '',
  ...defaultMonthRange(),
};

// ----- Filter functions -----
function applyLogFilter(rentals) {
  return rentals.filter(r => {
    if (logFilters.from) {
      const start = (r.startDate || '').slice(0, 10);
      if (start && start < logFilters.from) return false;
    }
    if (logFilters.to) {
      const start = (r.startDate || '').slice(0, 10);
      if (start && start > logFilters.to) return false;
    }
    if (logFilters.status !== 'all') {
      const isReturned = r.status === 'returned' || r.status === 'completed';
      switch (logFilters.status) {
        case 'active':
          if (r.status !== 'active') return false; break;
        case 'cancelled':
          if (r.status !== 'cancelled') return false; break;
        case 'awaiting-payment':
          if (!isReturned || r.paid) return false; break;
        case 'awaiting-settle':
          if (!isReturned || !r.paid || r.ownerSettled) return false; break;
        case 'damage-pending':
          if (!r.newDamage || r.damageResolved || r.status === 'cancelled') return false; break;
        case 'fully-done':
          if (!isReturned || !r.paid || !r.ownerSettled || !r.damageResolved) return false; break;
        case 'returned':
          if (!isReturned) return false; break;
        default:
          if (r.status !== logFilters.status) return false;
      }
    }
    if (logFilters.ownerId !== 'all' && r.ownerId !== logFilters.ownerId) return false;
    if (logFilters.payment !== 'all' && r.paymentMethod !== logFilters.payment) return false;
    if (logFilters.damage === 'yes' && !r.newDamage) return false;
    if (logFilters.damage === 'no' && r.newDamage) return false;
    if (logFilters.staffGiver !== 'all' && (r.staffGivesKey || '').toUpperCase() !== logFilters.staffGiver) return false;

    // Filter by motor (category, cc, surfrack)
    if (logFilters.category !== 'all' || logFilters.cc !== 'all' || logFilters.surfrack !== 'all') {
      const motor = MotorManager.get(r.motorId);
      if (logFilters.category !== 'all' && motor?.category !== logFilters.category) return false;
      if (logFilters.cc !== 'all' && motor?.cc !== logFilters.cc) return false;
      if (logFilters.surfrack === 'true' && !motor?.hasSurfrack) return false;
      if (logFilters.surfrack === 'false' && motor?.hasSurfrack) return false;
    }

    if (logFilters.search) {
      const q = logFilters.search.toLowerCase();
      const hay = `${r.guestName || ''} ${r.motorPlate || ''} ${r.ownerName || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderActiveFilterChips() {
  const chips = [];
  if (logFilters.from || logFilters.to) chips.push({ key: 'date', label: `📅 ${logFilters.from || '...'} → ${logFilters.to || '...'}` });
  if (logFilters.status !== 'all') chips.push({ key: 'status', label: `Status: ${logFilters.status}` });
  if (logFilters.ownerId !== 'all') {
    const o = OwnerManager.get(logFilters.ownerId);
    chips.push({ key: 'ownerId', label: `Owner: ${o?.name || logFilters.ownerId}` });
  }
  if (logFilters.category !== 'all') chips.push({ key: 'category', label: `${t('chip_category')}: ${logFilters.category}` });
  if (logFilters.cc !== 'all') chips.push({ key: 'cc', label: `CC: ${logFilters.cc}` });
  if (logFilters.surfrack !== 'all') chips.push({ key: 'surfrack', label: logFilters.surfrack === 'true' ? t('chip_surfrack_with') : t('chip_surfrack_without') });
  if (logFilters.staffGiver !== 'all') chips.push({ key: 'staffGiver', label: `Staff: ${logFilters.staffGiver}` });
  if (logFilters.payment !== 'all') chips.push({ key: 'payment', label: `${t('chip_payment')}: ${logFilters.payment}` });
  if (logFilters.damage !== 'all') chips.push({ key: 'damage', label: `Damage: ${logFilters.damage === 'yes' ? t('damage_yes') : t('damage_no')}` });
  if (logFilters.search) chips.push({ key: 'search', label: `🔎 "${logFilters.search}"` });
  return chips;
}

function resetLogFilters() {
  logFilters = { ...defaultMonthRange(), status: 'all', ownerId: 'all', category: 'all', cc: 'all',
    surfrack: 'all', staffGiver: 'all', payment: 'all', damage: 'all', search: '' };
}

// ====================================================================
// RENDER
// ====================================================================
export function renderAudit() {
  const allRentals = RentalManager.list();
  const owners = OwnerManager.list();
  const ccList = [...new Set(MotorManager.list().map(m => m.cc).filter(Boolean))];
  const staffList = [...new Set(allRentals.map(r => (r.staffGivesKey || '').toUpperCase()).filter(Boolean))];
  const paymentList = [...new Set(allRentals.map(r => r.paymentMethod).filter(Boolean))];

  const filtered = applyLogFilter(allRentals).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

  const isDone = (r) => r.status === 'returned' || r.status === 'completed';
  const totalRevenue = filtered.filter(isDone).reduce((s, r) => s + (r.totalCost || 0), 0);
  const totalCommission = filtered.filter(isDone).reduce((s, r) => s + (r.commission || 0), 0);
  const totalPto = filtered.filter(isDone).reduce((s, r) => s + (r.payToOwner || 0), 0);
  const totalDamage = filtered.reduce((s, r) => s + (r.damageCharge || 0), 0);

  const chips = renderActiveFilterChips();

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_audit')}</h1>
        <p class="page__lede">${t('page_audit_desc')}</p>
      </div>
      <div class="row">
        <button class="btn btn--ghost btn--sm" id="aud-export">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
      </div>
    </div>

    <div class="segmented" style="margin-bottom:16px">
      <button class="segmented__opt ${currentTab === 'log' ? 'is-active' : ''}" data-tab="log">${t('page_rental_log')} (${allRentals.length})</button>
      <button class="segmented__opt ${currentTab === 'trail' ? 'is-active' : ''}" data-tab="trail">${t('page_trail_changes')} (${AuditManager.list().length})</button>
    </div>

    ${currentTab === 'log' ? renderLogTab(filtered, owners, ccList, staffList, paymentList, chips, totalRevenue, totalCommission, totalPto, totalDamage) : renderTrailTab()}
  `;
}

function renderLogTab(filtered, owners, ccList, staffList, paymentList, chips, totalRevenue, totalCommission, totalPto, totalDamage) {
  return `
    <!-- Filter panel -->
    <div class="card" style="margin-bottom:16px;padding:14px">
      <details ${chips.length > 0 ? 'open' : ''}>
        <summary style="cursor:pointer;font-weight:700;margin-bottom:12px">
          🔍 ${t('form_filter')} ${chips.length > 0 ? `<span class="badge badge--brand" style="margin-left:6px">${chips.length} ${t('page_filter_active')}</span>` : ''}
        </summary>
        <div class="stack" style="gap:12px;margin-top:12px">
          <div class="field-group">
            <div class="field">
              <label class="field__label">${t('page_filter_date_from')}</label>
              <input class="input" type="date" id="f-from" value="${logFilters.from}" />
            </div>
            <div class="field">
              <label class="field__label">${t('page_filter_date_to')}</label>
              <input class="input" type="date" id="f-to" value="${logFilters.to}" />
            </div>
          </div>
          <div class="field-group">
            <div class="field">
              <label class="field__label">${t('page_filter_status')}</label>
              <select id="f-status" class="select">
                <option value="all" ${logFilters.status === 'all' ? 'selected' : ''}>${t('page_all')}</option>
                <option value="active" ${logFilters.status === 'active' ? 'selected' : ''}>${t('filter_status_active')}</option>
                <option value="awaiting-payment" ${logFilters.status === 'awaiting-payment' ? 'selected' : ''}>${t('filter_status_awaiting_payment')}</option>
                <option value="awaiting-settle" ${logFilters.status === 'awaiting-settle' ? 'selected' : ''}>${t('filter_status_awaiting_settle')}</option>
                <option value="damage-pending" ${logFilters.status === 'damage-pending' ? 'selected' : ''}>${t('filter_status_damage_pending')}</option>
                <option value="fully-done" ${logFilters.status === 'fully-done' ? 'selected' : ''}>${t('filter_status_fully_done')}</option>
                <option value="cancelled" ${logFilters.status === 'cancelled' ? 'selected' : ''}>${t('filter_status_cancelled')}</option>
              </select>
            </div>
            <div class="field">
              <label class="field__label">${t('page_filter_owner')}</label>
              <select id="f-owner" class="select">
                <option value="all">${t('page_all')}</option>
                ${owners.map(o => `<option value="${o.id}" ${logFilters.ownerId === o.id ? 'selected' : ''}>${escapeHTML(o.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-group">
            <div class="field">
              <label class="field__label">${t('page_filter_category')}</label>
              <select id="f-cat" class="select">
                <option value="all" ${logFilters.category === 'all' ? 'selected' : ''}>${t('page_all')}</option>
                <option value="A" ${logFilters.category === 'A' ? 'selected' : ''}>A — ${t('cat_property')}</option>
                <option value="B" ${logFilters.category === 'B' ? 'selected' : ''}>B — ${t('cat_staff')}</option>
                <option value="C" ${logFilters.category === 'C' ? 'selected' : ''}>C — ${t('cat_non_staff')}</option>
              </select>
            </div>
            <div class="field">
              <label class="field__label">${t('page_filter_cc')}</label>
              <select id="f-cc" class="select">
                <option value="all">${t('page_all')}</option>
                ${ccList.map(c => `<option value="${escapeHTML(c)}" ${logFilters.cc === c ? 'selected' : ''}>${escapeHTML(c)} cc</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-group">
            <div class="field">
              <label class="field__label">${t('page_filter_surfrack')}</label>
              <select id="f-sr" class="select">
                <option value="all" ${logFilters.surfrack === 'all' ? 'selected' : ''}>${t('page_all')}</option>
                <option value="true" ${logFilters.surfrack === 'true' ? 'selected' : ''}>${t('filter_surfrack_yes')}</option>
                <option value="false" ${logFilters.surfrack === 'false' ? 'selected' : ''}>${t('filter_surfrack_no')}</option>
              </select>
            </div>
            <div class="field">
              <label class="field__label">${t('page_filter_staff_key')}</label>
              <select id="f-staff" class="select">
                <option value="all">${t('page_all')}</option>
                ${staffList.map(s => `<option value="${escapeHTML(s)}" ${logFilters.staffGiver === s ? 'selected' : ''}>${escapeHTML(s)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-group">
            <div class="field">
              <label class="field__label">${t('page_filter_payment')}</label>
              <select id="f-pay" class="select">
                <option value="all">${t('page_all')}</option>
                ${paymentList.map(p => `<option value="${escapeHTML(p)}" ${logFilters.payment === p ? 'selected' : ''}>${escapeHTML(p)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field__label">${t('page_filter_damage')}</label>
              <select id="f-dmg" class="select">
                <option value="all" ${logFilters.damage === 'all' ? 'selected' : ''}>${t('page_all')}</option>
                <option value="yes" ${logFilters.damage === 'yes' ? 'selected' : ''}>${t('damage_yes')}</option>
                <option value="no" ${logFilters.damage === 'no' ? 'selected' : ''}>${t('damage_no')}</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label class="field__label">${t('page_filter_search')}</label>
            <input class="input" type="search" id="f-search" placeholder="${t('page_filter_search_placeholder')}" value="${escapeHTML(logFilters.search)}" />
          </div>
          <div class="row" style="gap:8px;margin-top:4px">
            <button class="btn btn--ghost btn--sm" id="aud-reset">${t('page_reset_filter')}</button>
            <button class="btn btn--sm" id="aud-apply">${t('page_apply')}</button>
          </div>
        </div>
      </details>

      ${chips.length > 0 ? `
        <div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap">
          ${chips.map(c => `<span class="chip" data-remove-chip="${c.key}" style="cursor:pointer">${escapeHTML(c.label)} ✕</span>`).join('')}
        </div>
      ` : ''}
    </div>

    <!-- Summary -->
    <div class="bento" style="margin-bottom:16px">
      <div class="card span-3"><div class="kpi"><span class="kpi__label">${t('page_total_rentals_kpi')}</span><span class="kpi__value">${filtered.length}</span></div></div>
      <div class="card span-3"><div class="kpi"><span class="kpi__label">${t('page_revenue_kpi')}</span><span class="kpi__value kpi__value--sm">${formatIDR(totalRevenue)}</span></div></div>
      <div class="card span-3"><div class="kpi"><span class="kpi__label">${t('detail_commission_short')}</span><span class="kpi__value kpi__value--sm">${formatIDR(totalCommission)}</span></div></div>
      <div class="card span-3"><div class="kpi"><span class="kpi__label">${t('detail_pay_owner')}</span><span class="kpi__value kpi__value--sm">${formatIDR(totalPto)}</span></div></div>
    </div>

    <!-- Result table -->
    ${filtered.length === 0 ? `
      <div class="card"><div class="empty">
        <p class="empty__title">${t('page_no_match')}</p>
        <p>${t('page_try_reset_filter')}</p>
      </div></div>
    ` : `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>${t('th_date')}</th>
              <th>${t('th_guest')}</th>
              <th>Motor</th>
              <th>Owner</th>
              <th>Staff</th>
              <th>${t('th_days')}</th>
              <th style="text-align:right">Total</th>
              <th style="text-align:right">${t('th_commission')}</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(r => {
              const motor = MotorManager.get(r.motorId);
              return `
                <tr data-action="open-rental" data-id="${r.id}" style="cursor:pointer">
                  <td>${formatDate(r.startDate)}</td>
                  <td>
                    <strong>${escapeHTML(r.guestName)}</strong>
                    ${r.newDamage ? '<span class="badge badge--danger" style="margin-left:6px;font-size:10px">DMG</span>' : ''}
                  </td>
                  <td>${escapeHTML(r.motorPlate)}${motor?.hasSurfrack ? ' 🏄' : ''}<div class="muted" style="font-size:11px">${escapeHTML(r.motorDescription)}</div></td>
                  <td>${escapeHTML(r.ownerName || '—')}</td>
                  <td>${escapeHTML(r.staffGivesKey || '—')}</td>
                  <td>${r.totalDays || '—'}</td>
                  <td style="text-align:right">${r.status === 'active' ? '<span class="muted">—</span>' : '<strong>' + formatIDR(r.totalCost) + '</strong>'}</td>
                  <td style="text-align:right">${r.status === 'active' ? '<span class="muted">—</span>' : formatIDR(r.commission)}</td>
                  <td>${renderRentalBadge(r)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
}

function renderTrailTab() {
  const allActors = AuditManager.distinctActors();
  const entries = AuditManager.filter({
    entity: trailFilters.entity === 'all' ? undefined : trailFilters.entity,
    actorId: trailFilters.actor === 'all' ? undefined : trailFilters.actor,
    fromISO: trailFilters.from ? trailFilters.from + 'T00:00:00.000Z' : undefined,
    toISO: trailFilters.to ? trailFilters.to + 'T23:59:59.999Z' : undefined,
    search: trailFilters.search || undefined,
  });

  return `
    <div class="card" style="margin-bottom:16px;padding:14px">
      <div class="stack" style="gap:12px">
        <div class="field-group">
          <div class="field">
            <label class="field__label">${t('page_filter_date_from')}</label>
            <input class="input" type="date" id="t-from" value="${trailFilters.from}" />
          </div>
          <div class="field">
            <label class="field__label">${t('page_filter_date_to')}</label>
            <input class="input" type="date" id="t-to" value="${trailFilters.to}" />
          </div>
        </div>
        <div class="field-group">
          <div class="field">
            <label class="field__label">${t('page_entity')}</label>
            <select id="t-entity" class="select">
              <option value="all" ${trailFilters.entity === 'all' ? 'selected' : ''}>${t('page_all')}</option>
              <option value="motor" ${trailFilters.entity === 'motor' ? 'selected' : ''}>Motor</option>
              <option value="rental" ${trailFilters.entity === 'rental' ? 'selected' : ''}>Rental</option>
              <option value="owner" ${trailFilters.entity === 'owner' ? 'selected' : ''}>Owner</option>
              <option value="damage" ${trailFilters.entity === 'damage' ? 'selected' : ''}>Damage</option>
              <option value="system" ${trailFilters.entity === 'system' ? 'selected' : ''}>System</option>
            </select>
          </div>
          <div class="field">
            <label class="field__label">${t('page_actor')}</label>
            <select id="t-actor" class="select">
              <option value="all">${t('page_all')}</option>
              ${allActors.map(a => `<option value="${escapeHTML(a.id)}" ${trailFilters.actor === a.id ? 'selected' : ''}>${escapeHTML(a.name)} (${escapeHTML(a.role || '-')})</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field__label">${t('page_search')}</label>
          <input class="input" type="search" id="t-search" placeholder="${t('page_search_placeholder')}" value="${escapeHTML(trailFilters.search || '')}" />
        </div>
      </div>
    </div>

    ${entries.length === 0 ? `
      <div class="card"><div class="empty">
        <p class="empty__title">${t('page_no_changes')}</p>
        <p>${t('page_audit_auto_fill')}</p>
      </div></div>
    ` : `
      <div class="list-card">
        ${entries.slice(0, 200).map(e => `
          <div class="list-item">
            <div class="list-item__main">
              <div class="row" style="gap:8px;flex-wrap:nowrap;align-items:center">
                <span class="badge badge--brand" style="font-size:10px">${escapeHTML(e.entity)}</span>
                <span class="badge ${actionBadgeClass(e.action)}" style="font-size:10px">${escapeHTML(e.action)}</span>
                <strong>${escapeHTML(e.entityLabel || '—')}</strong>
              </div>
              ${e.changes && Array.isArray(e.changes) ? `
                <div class="muted" style="font-size:12px;margin-top:4px">
                  ${e.changes.map(c => `<code style="background:var(--bg-subtle);padding:1px 4px;border-radius:3px">${escapeHTML(c.field)}: ${escapeHTML(String(c.from ?? '∅'))} → ${escapeHTML(String(c.to ?? '∅'))}</code>`).join(' · ')}
                </div>
              ` : ''}
              ${e.note ? `<div class="muted" style="font-size:12px;margin-top:4px">${escapeHTML(e.note)}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:12px;font-weight:600">${escapeHTML(e.actorName || '—')}</div>
              <div class="muted" style="font-size:11px;margin-top:2px">${formatDateTime(e.timestamp)}</div>
            </div>
          </div>
        `).join('')}
        ${entries.length > 200 ? `<div class="muted" style="padding:12px;text-align:center;font-size:12px">${t('page_displaying')} 200 ${t('page_of_entries', { total: entries.length })}</div>` : ''}
      </div>
    `}
  `;
}

function statusBadge(s) {
  if (s === 'active') return `<span class="badge badge--success">${t('badge_active')}</span>`;
  if (s === 'returned' || s === 'completed') return '<span class="badge">Returned</span>';
  if (s === 'cancelled') return `<span class="badge badge--danger">${t('badge_cancelled')}</span>`;
  return '<span class="badge">' + escapeHTML(s) + '</span>';
}

function actionBadgeClass(a) {
  if (a === 'create' || a === 'check-in' || a === 'seed') return 'badge--success';
  if (a === 'delete' || a === 'cancel' || a === 'reset-all' || a === 'login-fail') return 'badge--danger';
  if (a === 'update') return 'badge--warning';
  return '';
}

// ====================================================================
// SETUP (event handlers)
// ====================================================================
export function setupAuditPage(rerender) {
  const content = document.getElementById('content');

  // Tab switching
  content.querySelectorAll('[data-tab]').forEach(b => {
    b.addEventListener('click', () => { currentTab = b.dataset.tab; rerender(); });
  });

  if (currentTab === 'log') {
    // Apply filter button
    content.querySelector('#aud-apply')?.addEventListener('click', () => {
      logFilters = {
        from: content.querySelector('#f-from').value,
        to: content.querySelector('#f-to').value,
        status: content.querySelector('#f-status').value,
        ownerId: content.querySelector('#f-owner').value,
        category: content.querySelector('#f-cat').value,
        cc: content.querySelector('#f-cc').value,
        surfrack: content.querySelector('#f-sr').value,
        staffGiver: content.querySelector('#f-staff').value,
        payment: content.querySelector('#f-pay').value,
        damage: content.querySelector('#f-dmg').value,
        search: content.querySelector('#f-search').value.trim(),
      };
      rerender();
    });

    content.querySelector('#aud-reset')?.addEventListener('click', () => {
      resetLogFilters();
      rerender();
    });

    // Chip remove (per filter key)
    content.querySelectorAll('[data-remove-chip]').forEach(c => {
      c.addEventListener('click', () => {
        const k = c.dataset.removeChip;
        if (k === 'date') { logFilters.from = ''; logFilters.to = ''; }
        else if (k === 'search') logFilters.search = '';
        else if (logFilters[k] !== undefined) logFilters[k] = 'all';
        rerender();
      });
    });

    // Export CSV
    content.querySelector('#aud-export')?.addEventListener('click', () => {
      const filtered = applyLogFilter(RentalManager.list());
      const csv = toCSV(filtered, [
        { label: t('csv_start_date'), value: r => formatDate(r.startDate) },
        { label: t('csv_end_date'), value: r => formatDate(r.actualFinishDate || r.finishDate) },
        { label: t('th_guest'), value: 'guestName' },
        { label: t('csv_plate'), value: 'motorPlate' },
        { label: 'Motor', value: 'motorDescription' },
        { label: 'Owner', value: 'ownerName' },
        { label: t('csv_staff_give_key'), value: 'staffGivesKey' },
        { label: t('csv_staff_receive_key'), value: 'staffReceivesKey' },
        { label: t('th_days'), value: 'totalDays' },
        { label: t('form_motor_price_per_day'), value: 'pricePerDay' },
        { label: t('csv_total_cost'), value: 'totalCost' },
        { label: t('detail_pay_owner'), value: 'payToOwner' },
        { label: t('th_commission'), value: 'commission' },
        { label: t('csv_payment_method'), value: 'paymentMethod' },
        { label: t('csv_damage_col'), value: r => r.newDamage ? t('damage_yes') : t('damage_no') },
        { label: t('csv_damage_desc'), value: 'damageDescription' },
        { label: t('csv_damage_charge'), value: 'damageCharge' },
        { label: 'Status', value: 'status' },
      ]);
      downloadFile(csv, `audit_rental_${new Date().toISOString().slice(0, 10)}.csv`);
    });
  } else {
    // Trail tab
    ['#t-from', '#t-to', '#t-entity', '#t-actor'].forEach(s => {
      content.querySelector(s)?.addEventListener('change', () => {
        trailFilters.from = content.querySelector('#t-from').value;
        trailFilters.to = content.querySelector('#t-to').value;
        trailFilters.entity = content.querySelector('#t-entity').value;
        trailFilters.actor = content.querySelector('#t-actor').value;
        rerender();
      });
    });
    bindSearchInput(content.querySelector('#t-search'), (value) => {
      trailFilters.search = value.trim();
      rerender();
    });

    // Export trail
    content.querySelector('#aud-export')?.addEventListener('click', () => {
      const entries = AuditManager.filter({
        entity: trailFilters.entity === 'all' ? undefined : trailFilters.entity,
        actorId: trailFilters.actor === 'all' ? undefined : trailFilters.actor,
        fromISO: trailFilters.from ? trailFilters.from + 'T00:00:00.000Z' : undefined,
        toISO: trailFilters.to ? trailFilters.to + 'T23:59:59.999Z' : undefined,
        search: trailFilters.search || undefined,
      });
      const csv = toCSV(entries, [
        { label: t('csv_trail_time'), value: e => formatDateTime(e.timestamp) },
        { label: 'Entity', value: 'entity' },
        { label: t('csv_trail_action'), value: 'action' },
        { label: 'Label', value: 'entityLabel' },
        { label: t('csv_trail_actor'), value: 'actorName' },
        { label: 'Role', value: 'actorRole' },
        { label: t('csv_trail_changes'), value: e => Array.isArray(e.changes) ? e.changes.map(c => `${c.field}: ${c.from} → ${c.to}`).join(' | ') : '' },
        { label: t('csv_trail_notes'), value: 'note' },
      ]);
      downloadFile(csv, `audit_trail_${new Date().toISOString().slice(0, 10)}.csv`);
    });
  }
}
