// =============================================================
// pages/reports.js
// =============================================================

import { ReportEngine } from '../modules/reports.js';
import { formatIDR, escapeHTML } from '../modules/utils.js';
import { t } from '../modules/i18n.js';

export function renderReports() {
  const ym = new Date().toISOString().slice(0, 7);
  const ov = ReportEngine.overview();
  const byOwner = ReportEngine.earningsByOwner(ym);
  const topMotors = ReportEngine.topMotors(10, ym);
  const daily = ReportEngine.rentalsByDay(14);
  const monthLabel = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const maxOwnerEarn = Math.max(...byOwner.map(o => o.totalEarning), 1);
  const maxDaily = Math.max(...daily.map(d => d.count), 1);

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_reports')}</h1>
        <p class="page__lede">${t('page_period')}: ${monthLabel}</p>
      </div>
    </div>

    <div class="bento">
      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('page_total_revenue')}</span>
          <span class="kpi__value kpi__value--sm">${formatIDR(ov.revenueMonth)}</span>
          <span class="kpi__sub">${t('page_from_all_transactions')}</span>
        </div>
      </div>
      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('detail_commission_short')}</span>
          <span class="kpi__value kpi__value--sm">${formatIDR(ov.commissionMonth)}</span>
          <span class="kpi__sub">${ov.revenueMonth ? Math.round((ov.commissionMonth / ov.revenueMonth) * 100) : 0}% ${t('page_of_revenue')}</span>
        </div>
      </div>
      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('detail_pay_owner')}</span>
          <span class="kpi__value kpi__value--sm">${formatIDR(ov.payToOwnerMonth)}</span>
          <span class="kpi__sub">${t('page_paid_to_owner')}</span>
        </div>
      </div>
      <div class="card span-3">
        <div class="kpi">
          <span class="kpi__label">${t('detail_damage_charge')}</span>
          <span class="kpi__value kpi__value--sm">${formatIDR(ov.damageRecoveryMonth)}</span>
          <span class="kpi__sub">${t('page_from_damages')}</span>
        </div>
      </div>

      <!-- Volume chart (moved from dashboard — analytics belong here) -->
      <div class="card span-12">
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

      <div class="card span-6">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_earnings_per_owner')}</div>
            <div class="card__sub">${t('page_monthly_earning_ranking')}</div>
          </div>
        </div>
        ${byOwner.length === 0 ? `
          <div class="empty"><p>${t('page_no_transactions')}</p></div>
        ` : `
          <div class="stack">
            ${byOwner.map(o => `
              <div>
                <div class="row row--between" style="margin-bottom:6px">
                  <span style="font-weight:600">${escapeHTML(o.ownerName)}</span>
                  <span style="font-weight:700;color:var(--success)">${formatIDR(o.totalEarning)}</span>
                </div>
                <div class="meter">
                  <div class="meter__fill meter__fill--success" style="width:${(o.totalEarning / maxOwnerEarn) * 100}%"></div>
                </div>
                <div class="muted" style="font-size:12px;margin-top:4px">${o.rentalCount} ${t('page_rentals_short')} · ${o.totalDays} ${t('page_days')} · ${t('detail_commission_short').toLowerCase()} ${formatIDR(o.commission)}${o.damageRecovery ? ` · +${formatIDR(o.damageRecovery)} ${t('page_incl_damage')}` : ''}</div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <div class="card span-6">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_top_10_motors')}</div>
            <div class="card__sub">${t('page_by_revenue')}</div>
          </div>
        </div>
        ${topMotors.length === 0 ? `
          <div class="empty"><p>${t('page_no_data')}</p></div>
        ` : `
          <div class="table-wrap" style="border:none">
            <table class="table">
               <thead><tr><th>#</th><th>${t('form_motor_plate')}</th><th>${t('export_motor')}</th><th>${t('page_rentals_short')}</th><th style="text-align:right">${t('page_revenue')}</th></tr></thead>
              <tbody>
                ${topMotors.map((m, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td><strong>${escapeHTML(m.plate)}</strong></td>
                    <td>${escapeHTML(m.description)}</td>
                    <td>${m.rentalCount}</td>
                    <td style="text-align:right;font-weight:700">${formatIDR(m.revenue)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}
