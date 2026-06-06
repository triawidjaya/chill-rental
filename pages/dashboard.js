// =============================================================
// pages/dashboard.js
// Dashboard — Bento grid KPI + quick actions
// =============================================================

import { ReportEngine } from '../modules/reports.js';
import { RentalManager } from '../modules/rentals.js';
import { formatDate, escapeHTML, isPastCutoffToday } from '../modules/utils.js';
import { t } from '../modules/i18n.js';

// Action Queue task chips — icon + label + colour. Each rental row shows one
// chip per pending task, in the priority order returned by actionQueue().
const TASK_META = {
  overdue:         { icon: '🔴', labelKey: 'chip_overdue',      cls: 'badge--danger' },
  awaitingPayment: { icon: '🟡', labelKey: 'chip_unpaid',       cls: 'badge--warning' },
  awaitingSettle:  { icon: '🔵', labelKey: 'chip_settle',       cls: 'badge--brand' },
  damagePending:   { icon: '🟠', labelKey: 'chip_damage',       cls: 'badge--warning' },
  suspectedDamage: { icon: '⚠',  labelKey: 'chip_check_damage', cls: 'badge--warning' },
};

// One row per rental (guest) needing action, with a chip for each task.
function queueRow(item) {
  const r = item.rental;
  const chips = item.tasks.map(k => {
    const m = TASK_META[k];
    return `<span class="badge ${m.cls}">${m.icon} ${t(m.labelKey)}</span>`;
  }).join(' ');
  return `
    <div class="list-item" data-action="open-rental" data-id="${r.id}">
      <div class="list-item__main">
        <div class="list-item__title">${escapeHTML(r.guestName)}</div>
        <div class="list-item__sub">${escapeHTML(r.motorPlate)}${r.motorDescription ? ' · ' + escapeHTML(r.motorDescription) : ''}</div>
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${chips}</div>
      </div>
    </div>
  `;
}

// The operational "Today's Tasks" card — one row per guest, all their tasks as
// chips. Shows a positive empty state when there is nothing pending.
function renderActionQueue(queue, pastCutoffToday) {
  const sub = `${queue.length} ${t('page_guests_pending')}${pastCutoffToday ? ' · ' + t('page_past_cutoff') : ''}`;

  const inner = queue.length === 0
    ? `<div class="empty" style="padding:20px 0">
         <p class="empty__title">${t('page_all_clear')}</p>
         <p>${t('page_all_clear_sub')}</p>
       </div>`
    : `<div class="list-card" style="margin:0">${queue.map(queueRow).join('')}</div>`;

  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card__header" style="margin-bottom:4px">
        <div>
          <div class="card__title">${t('page_action_queue')}</div>
          <div class="card__sub">${sub}</div>
        </div>
      </div>
      ${inner}
    </div>
  `;
}

export function renderDashboard() {
  const ov = ReportEngine.overview();
  const ch = ReportEngine.channelCounts();
  const activeAll = RentalManager.active();
  const recentActive = activeAll.slice(-5).reverse();
  const byCat = ReportEngine.motorsByCategory();

  // Operational Action Queue (A1) — unfinished work in fixed priority order
  const queue = RentalManager.actionQueue();
  const pastCutoffToday = isPastCutoffToday(11);

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_dashboard')}</h1>
        <p class="page__lede">${t('page_title_dashboard')} · ${formatDate(new Date().toISOString())}</p>
      </div>
    </div>

    ${renderActionQueue(queue, pastCutoffToday)}

    <div class="bento">
      <!-- KPI Row — operational counts only (no money; financials live on Reports) -->
      <div class="card span-3 card--accent">
        <div class="kpi">
          <span class="kpi__label">${t('page_available')}</span>
          <span class="kpi__value">${ov.motorsAvailable}</span>
          <span class="kpi__sub">${t('page_ready_to_rent')}</span>
        </div>
      </div>

      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('page_rented_motors')}</span>
          <span class="kpi__value">${ov.motorsRented}</span>
          <span class="kpi__sub">${t('page_of_total_simple', { n: ov.totalMotors })}</span>
        </div>
      </div>

      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('page_active_rentals')}</span>
          <span class="kpi__value">${ov.activeRentals}</span>
          <span class="kpi__sub">${t('page_active_ongoing')}</span>
        </div>
      </div>

      <!-- Held passports — physical-inventory reconciliation (how many should be in the drawer) -->
      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('page_passports_held')}</span>
          <span class="kpi__value">${ov.passportsKept}</span>
          <span class="kpi__sub">${t('page_passport_offsite')}</span>
        </div>
      </div>

      <!-- Booking channel — online vs walk-in this month (operational count, no money) -->
      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('page_channel_source')}</span>
          <span class="kpi__value">🌐 ${ch.online} · 🚶 ${ch.walkin}</span>
          <span class="kpi__sub">${t('page_channel_sub')}</span>
        </div>
      </div>

      <!-- Category -->
      <div class="card span-4">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_by_category')}</div>
            <div class="card__sub">${t('page_fleet_distribution')}</div>
          </div>
        </div>
        <div class="stack">
          ${byCat.map(c => `
            <div>
              <div class="row row--between" style="margin-bottom:6px">
                <span style="font-weight:600">${c.label}</span>
                <span class="muted" style="font-size:13px">${c.rented} ${t('page_rented')} / ${c.count} ${t('page_total')}</span>
              </div>
              <div class="meter">
                <div class="meter__fill ${c.category === 'A' ? '' : c.category === 'B' ? 'meter__fill--warning' : 'meter__fill--success'}"
                     style="width:${c.count ? (c.rented / c.count) * 100 : 0}%"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Active Rentals -->
      <div class="card span-8">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_active_rentals')}</div>
            <div class="card__sub">${ov.activeRentals} ${t('page_active_ongoing')}</div>
          </div>
          <a href="#rentals" class="btn btn--soft btn--sm">${t('page_view_all')}</a>
        </div>
        ${recentActive.length === 0 ? `
          <div class="empty">
            <div class="empty__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
            </div>
            <p class="empty__title">${t('empty_dashboard')}</p>
            <p>${t('page_click_new_rental')}</p>
          </div>
        ` : `
          <div class="list-card">
            ${recentActive.map(r => `
              <div class="list-item" data-action="open-rental" data-id="${r.id}">
                <div class="list-item__main">
                  <div class="list-item__title">${escapeHTML(r.guestName)}</div>
                  <div class="list-item__sub">${escapeHTML(r.motorPlate)} · ${escapeHTML(r.motorDescription)}</div>
                </div>
                <div style="text-align:right">
                  <span class="badge badge--brand">${r.totalDays} ${t('page_days')}</span>
                  <div class="muted" style="font-size:12px;margin-top:4px">${formatDate(r.startDate)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

    </div>
  `;
}
