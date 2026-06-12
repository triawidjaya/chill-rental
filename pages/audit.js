// =============================================================
// pages/audit.js
// Halaman Audit — 2 tab: Log Rental (filter multi-dim) + Trail (perubahan data)
// =============================================================

import { RentalManager, renderRentalBadge } from '../modules/rentals.js';
import { MotorManager } from '../modules/motors.js';
import { AuditManager } from '../modules/audit.js';
import { SessionManager } from '../modules/session.js';
import { Modal, Toast } from '../modules/ui/notify.js';
import { formatIDR, formatDate, formatDateTime, escapeHTML, toCSV, downloadFile, bindSearchInput } from '../modules/utils.js';
import { t } from '../modules/i18n.js';

// ----- Filter state (per session, reset on page load) -----
let currentTab = 'log';

// YYYY-MM-DD in LOCAL time — toISOString() would shift to UTC and (in UTC+8)
// turn "June 1" into "May 31", silently hiding month-edge rentals.
const toLocalYMD = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const defaultMonthRange = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toLocalYMD(first), to: toLocalYMD(last) };
};

let logFilters = {
  ...defaultMonthRange(),
  basis: 'start',        // start | finish — which date the range applies to
  status: 'all',
  search: '',
};

const logDateOf = (r) =>
  ((logFilters.basis === 'finish' ? (r.actualFinishDate || r.finishDate) : r.startDate) || '').slice(0, 10);

let trailFilters = {
  entity: 'all',
  actor: 'all',
  search: '',
  ...defaultMonthRange(),
};

// Trail timestamps are UTC ISO; the date inputs are local calendar days.
// Convert local-day boundaries to UTC so entries before 08:00 WITA don't
// fall into the previous day.
const trailQuery = () => ({
  entity: trailFilters.entity === 'all' ? undefined : trailFilters.entity,
  actorId: trailFilters.actor === 'all' ? undefined : trailFilters.actor,
  fromISO: trailFilters.from ? new Date(trailFilters.from + 'T00:00:00').toISOString() : undefined,
  toISO: trailFilters.to ? new Date(trailFilters.to + 'T23:59:59.999').toISOString() : undefined,
  search: trailFilters.search || undefined,
});

// ----- Filter functions -----
function applyLogFilter(rentals) {
  return rentals.filter(r => {
    // Finish basis means "actually returned" — an active rental's estimated
    // finish date must not count as a completed stay.
    if (logFilters.basis === 'finish' && r.status !== 'returned' && r.status !== 'completed') return false;
    const d = logDateOf(r);
    if (logFilters.from && d && d < logFilters.from) return false;
    if (logFilters.to && d && d > logFilters.to) return false;
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
    if (logFilters.search) {
      const q = logFilters.search.toLowerCase();
      const hay = `${r.guestName || ''} ${r.motorPlate || ''} ${r.ownerName || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function resetLogFilters() {
  logFilters = { ...defaultMonthRange(), basis: 'start', status: 'all', search: '' };
}

// ====================================================================
// RENDER
// ====================================================================
export function renderAudit() {
  const allRentals = RentalManager.list();
  const filtered = applyLogFilter(allRentals).sort((a, b) => logDateOf(b).localeCompare(logDateOf(a)));

  const isDone = (r) => r.status === 'returned' || r.status === 'completed';
  const totalRevenue = filtered.filter(isDone).reduce((s, r) => s + (r.totalCost || 0), 0);
  const totalCommission = filtered.filter(isDone).reduce((s, r) => s + (r.commission || 0), 0);
  const totalPto = filtered.filter(isDone).reduce((s, r) => s + (r.payToOwner || 0), 0);

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_audit')}</h1>
        <p class="page__lede">${t('page_audit_desc')}</p>
      </div>
      <div class="row" style="gap:10px;align-items:center">
        <span class="muted js-sync-status" style="font-size:12px"></span>
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

    ${currentTab === 'log' ? renderLogTab(filtered, totalRevenue, totalCommission, totalPto) : renderTrailTab()}
  `;
}

function renderLogTab(filtered, totalRevenue, totalCommission, totalPto) {
  // "Active" and "Cancelled" can never match the finish basis (which implies
  // returned). All options are always rendered; the impossible ones are
  // hidden+disabled so the basis listener can toggle them without a rerender.
  const isFinish = logFilters.basis === 'finish';
  const statusOptions = [
    ['all', t('page_all'), false],
    ['active', t('filter_status_active'), true],
    ['awaiting-payment', t('filter_status_awaiting_payment'), false],
    ['awaiting-settle', t('filter_status_awaiting_settle'), false],
    ['damage-pending', t('filter_status_damage_pending'), false],
    ['fully-done', t('filter_status_fully_done'), false],
    ['cancelled', t('filter_status_cancelled'), true],
  ];

  return `
    <!-- Filter panel -->
    <div class="card" style="margin-bottom:16px;padding:14px">
      <div class="field-group" style="align-items:flex-end;flex-wrap:wrap">
        <div class="field">
          <label class="field__label">${t('page_filter_basis')}</label>
          <select id="f-basis" class="select">
            <option value="start" ${logFilters.basis === 'start' ? 'selected' : ''}>${t('filter_basis_start')}</option>
            <option value="finish" ${logFilters.basis === 'finish' ? 'selected' : ''}>${t('filter_basis_finish')}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label">${t('page_filter_status')}</label>
          <select id="f-status" class="select">
            ${statusOptions.map(([v, label, hideOnFinish]) => `<option value="${v}" ${logFilters.status === v ? 'selected' : ''} ${hideOnFinish && isFinish ? 'hidden disabled' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label">${t('page_filter_date_from')}</label>
          <input class="input" type="date" id="f-from" value="${logFilters.from}" />
        </div>
        <div class="field">
          <label class="field__label">${t('page_filter_date_to')}</label>
          <input class="input" type="date" id="f-to" value="${logFilters.to}" />
        </div>
        <div class="field" style="flex:1;min-width:180px">
          <label class="field__label">${t('page_filter_search')}</label>
          <input class="input" type="search" id="f-search" placeholder="${t('page_filter_search_placeholder')}" value="${escapeHTML(logFilters.search)}" />
        </div>
        <div class="row" style="gap:8px">
          <button class="btn btn--sm" id="aud-apply">${t('page_apply')}</button>
          <button class="btn btn--ghost btn--sm" id="aud-reset">${t('page_reset_filter')}</button>
        </div>
      </div>
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
              <th>${t('csv_start_date')}</th>
              <th>${t('csv_end_date')}</th>
              <th>${t('th_guest')}</th>
              <th>Motor</th>
              <th>Owner</th>
              <th>Staff</th>
              <th>${t('th_days')}</th>
              <th style="text-align:right">Total</th>
              <th style="text-align:right">${t('th_commission')}</th>
              <th style="text-align:right">${t('detail_pay_owner')}</th>
              <th>${t('csv_payment_method')}</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(r => {
              const motor = MotorManager.get(r.motorId);
              return `
                <tr data-action="open-rental" data-id="${r.id}" style="cursor:pointer">
                  <td>${formatDate(r.startDate)}</td>
                  <td>${r.actualFinishDate ? formatDate(r.actualFinishDate) : (r.finishDate ? `<span class="muted">${formatDate(r.finishDate)}</span>` : '—')}</td>
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
                  <td style="text-align:right">${r.status === 'active' ? '<span class="muted">—</span>' : formatIDR(r.payToOwner)}</td>
                  <td>${escapeHTML(r.paymentMethod || '—')}</td>
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
  const entries = AuditManager.filter(trailQuery());

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
              <option value="booking" ${trailFilters.entity === 'booking' ? 'selected' : ''}>Booking</option>
              <option value="user" ${trailFilters.entity === 'user' ? 'selected' : ''}>User</option>
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
        ${SessionManager.can('audit.purge') ? `
          <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
            <div class="field">
              <label class="field__label">${t('trail_purge_label')}</label>
              <input class="input" type="date" id="t-purge-date" value="${toLocalYMD(new Date(Date.now() - 7 * 86400000))}" />
            </div>
            <button class="btn btn--danger btn--sm" id="t-purge">${t('trail_purge_btn')}</button>
          </div>
        ` : ''}
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

function actionBadgeClass(a) {
  if (a === 'create' || a === 'check-in' || a === 'seed' || a === 'booking-confirm' || a === 'booking-checked-in') return 'badge--success';
  if (a === 'delete' || a === 'cancel' || a === 'reset-all' || a === 'login-fail' || a === 'booking-reject' || a === 'booking-cancel' || a === 'audit-purge') return 'badge--danger';
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
    // Filters only apply on the Apply button (or Enter in the search box).
    const applyFilters = () => {
      logFilters.basis = content.querySelector('#f-basis').value;
      logFilters.status = content.querySelector('#f-status').value;
      logFilters.from = content.querySelector('#f-from').value;
      logFilters.to = content.querySelector('#f-to').value;
      logFilters.search = content.querySelector('#f-search').value.trim();
      if (logFilters.basis === 'finish' && (logFilters.status === 'active' || logFilters.status === 'cancelled')) {
        logFilters.status = 'all';
      }
      rerender();
    };
    content.querySelector('#aud-apply')?.addEventListener('click', applyFilters);
    content.querySelector('#f-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });

    // Changing the basis immediately hides/shows the incompatible status
    // options (DOM only — data is not filtered until Apply).
    content.querySelector('#f-basis')?.addEventListener('change', (e) => {
      const finish = e.target.value === 'finish';
      const statusSel = content.querySelector('#f-status');
      statusSel.querySelectorAll('option[value="active"], option[value="cancelled"]').forEach(o => {
        o.hidden = finish;
        o.disabled = finish;
      });
      if (finish && (statusSel.value === 'active' || statusSel.value === 'cancelled')) statusSel.value = 'all';
    });

    content.querySelector('#aud-reset')?.addEventListener('click', () => {
      resetLogFilters();
      rerender();
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

    // Manager-only: delete all trail entries before the chosen date
    content.querySelector('#t-purge')?.addEventListener('click', async () => {
      const val = content.querySelector('#t-purge-date')?.value;
      if (!val) return;
      const cutoff = new Date(val + 'T00:00:00').toISOString();
      const count = AuditManager.list().filter(e => (e.timestamp || '') < cutoff).length;
      if (count === 0) { Toast.show(t('trail_purge_none')); return; }
      const ok = await Modal.confirm({
        title: t('trail_purge_confirm_title'),
        message: t('trail_purge_confirm_msg', { count, date: formatDate(val) }),
        confirmText: t('trail_purge_btn'),
        variant: 'danger',
      });
      if (!ok) return;
      const n = AuditManager.purgeBefore(cutoff);
      Toast.success(t('trail_purge_done', { count: n }));
      rerender();
    });

    // Export trail
    content.querySelector('#aud-export')?.addEventListener('click', () => {
      const entries = AuditManager.filter(trailQuery());
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
