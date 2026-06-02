// =============================================================
// pages/dashboard.js
// Dashboard — Bento grid KPI + quick actions
// =============================================================

import { ReportEngine } from '../modules/reports.js';
import { RentalManager } from '../modules/rentals.js';
import { formatIDR, formatNumber, formatDate, escapeHTML, isEstimateExpired, isPastCutoffToday } from '../modules/utils.js';
import { t } from '../modules/i18n.js';

export function renderDashboard() {
  const ov = ReportEngine.overview();
  const activeAll = RentalManager.active();
  const recentActive = activeAll.slice(-5).reverse();
  const daily = ReportEngine.rentalsByDay(14);
  const topMotors = ReportEngine.topMotors(5);
  const byCat = ReportEngine.motorsByCategory();

  // Rentals that need attention (estimate already passed)
  const expiredEstimate = activeAll.filter(r => r.finishDate && isEstimateExpired(r.finishDate));
  const pastCutoffToday = isPastCutoffToday(11);

  const maxDaily = Math.max(...daily.map(d => d.count), 1);

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_dashboard')}</h1>
        <p class="page__lede">${t('page_title_dashboard')} · ${formatDate(new Date().toISOString())}</p>
      </div>
    </div>

    ${expiredEstimate.length > 0 ? `
      <div class="card" style="background:var(--warning-soft, #fff3cd);border-color:var(--warning, #b58900);margin-bottom:16px;padding:14px">
        <div style="font-weight:700;color:var(--warning, #b58900);margin-bottom:8px">
          ⚠ ${expiredEstimate.length} ${t('page_expired_estimate')}${pastCutoffToday ? ' · ' + t('page_past_cutoff') : ''}
        </div>
        <div class="list-card" style="margin:0">
          ${expiredEstimate.slice(0, 3).map(r => `
            <div class="list-item" data-action="open-rental" data-id="${r.id}">
              <div class="list-item__main">
                <div class="list-item__title">${escapeHTML(r.guestName)}</div>
                <div class="list-item__sub">${escapeHTML(r.motorPlate)} · ${t('page_estimate_label')} ${formatDate(r.finishDate)}</div>
              </div>
              <span class="badge badge--warning">${t('badge_need_checkout')}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div class="bento">
      <!-- KPI Row -->
      <div class="card span-3 card--accent">
        <div class="kpi">
          <span class="kpi__label">${t('page_rented_motors')}</span>
          <span class="kpi__value">${ov.motorsRented}</span>
          <span class="kpi__sub">${t('page_of_total', { n: ov.totalMotors, pct: ov.utilizationPct })}</span>
          <div class="meter" style="margin-top:8px">
            <div class="meter__fill" style="width:${ov.utilizationPct}%"></div>
          </div>
        </div>
      </div>

      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('page_available')}</span>
          <span class="kpi__value">${ov.motorsAvailable}</span>
          <span class="kpi__sub">${t('page_ready_to_rent')}</span>
        </div>
      </div>

      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('page_passports_held')}</span>
          <span class="kpi__value">${ov.passportsKept}</span>
          <span class="kpi__sub">${t('page_held_by_staff')}</span>
        </div>
      </div>

      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('page_monthly_revenue')}</span>
          <span class="kpi__value kpi__value--sm">${formatIDR(ov.revenueMonth)}</span>
          <span class="kpi__sub">${t('detail_commission_short')}: ${formatIDR(ov.commissionMonth)}</span>
        </div>
      </div>

      <!-- Volume chart -->
      <div class="card span-8">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_rental_volume')}</div>
            <div class="card__sub">${daily[0]?.label?.split(' ').slice(1).join(' ') || ''} ${new Date().getFullYear()} · ${daily.reduce((s, d) => s + d.count, 0)} ${t('page_total_rentals')} · ${t('page_peak')} ${maxDaily}/${t('page_per_day')}</div>
          </div>
        </div>
        <div class="chart-grid">
          <div class="chart-grid__axis">
            <span>${maxDaily}</span>
            <span>${Math.ceil(maxDaily / 2)}</span>
            <span>0</span>
          </div>
          <div class="chart-grid__plot">
            <div class="chart-grid__line" style="top:0"></div>
            <div class="chart-grid__line" style="top:50%"></div>
            <div class="chart-grid__line" style="bottom:0"></div>
            <div class="chart-bars" role="img" aria-label="Grafik volume rental 14 hari">
              ${daily.map((d, i) => {
                const dayOnly = d.label.split(' ')[0];
                const monthSwitch = i > 0 && d.label.split(' ')[1] !== daily[i-1].label.split(' ')[1];
                return `
                <div class="chart-bar">
                  <div class="chart-bar__fill" data-zero="${d.count === 0 ? 'true' : 'false'}" style="height:${d.count === 0 ? 0 : (d.count / maxDaily) * 100}%">
                    <span class="chart-bar__value">${d.count}</span>
                  </div>
                  <div class="chart-bar__label">${monthSwitch ? d.label : dayOnly}</div>
                </div>
              `;
              }).join('')}
            </div>
          </div>
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
      <div class="card span-6">
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

      <!-- Top Motors -->
      <div class="card span-6">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_top_motors')}</div>
            <div class="card__sub">${t('page_by_revenue')}</div>
          </div>
        </div>
        ${topMotors.length === 0 ? `
          <div class="empty">
            <div class="empty__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            </div>
            <p class="empty__title">${t('page_no_data')}</p>
          </div>
        ` : `
          <div class="list-card">
            ${topMotors.map((m, i) => `
              <div class="list-item">
                <div style="width:32px;height:32px;border-radius:50%;background:var(--brand-soft);color:var(--brand-soft-text);display:grid;place-items:center;font-weight:700;font-size:14px">${i + 1}</div>
                <div class="list-item__main">
                  <div class="list-item__title">${escapeHTML(m.plate)}</div>
                  <div class="list-item__sub">${escapeHTML(m.description)} · ${m.rentalCount}× ${t('page_rentals_short')}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-weight:700">${formatIDR(m.revenue)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}
