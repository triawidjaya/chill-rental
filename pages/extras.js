// =============================================================
// pages/damages.js  +  pages/settings.js (digabung)
// =============================================================

import { DamageManager } from '../modules/damages.js';
import { storage } from '../modules/storage.js';
import { formatIDR, formatDate, escapeHTML } from '../modules/utils.js';
import { t, setLang, getLang } from '../modules/i18n.js';

export function renderDamages() {
  const damages = [...DamageManager.list()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const total = DamageManager.totalRecovery();

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_damages')}</h1>
        <p class="page__lede">${t('page_damage_log')} · ${t('page_total')}: ${formatIDR(total)}</p>
      </div>
    </div>

    ${damages.length === 0 ? `
      <div class="card"><div class="empty">
        <div class="empty__icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
        </div>
        <p class="empty__title">${t('page_no_damage_records')}</p>
        <p>${t('page_damage_auto')}</p>
      </div></div>
    ` : `
      <div class="list-card">
        ${damages.map(d => `
          <div class="list-item">
            <div class="list-item__main">
              <div class="list-item__title">${escapeHTML(d.motorPlate)}</div>
              <div class="list-item__sub">${escapeHTML(d.description)}</div>
              <div class="muted" style="font-size:12px;margin-top:4px">${formatDate(d.date)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;color:var(--danger)">${formatIDR(d.charge)}</div>
              ${d.resolved ? `<span class="badge badge--success" style="margin-top:4px">${t('detail_damage_done')}</span>` : `<span class="badge badge--warning" style="margin-top:4px">${t('detail_damage_pending')}</span>`}
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

export function renderSettings() {
  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_settings')}</h1>
        <p class="page__lede">${t('page_manage_data')}</p>
      </div>
    </div>

    <div class="bento">
      <div class="card span-12">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_settings_language')}</div>
            <div class="card__sub">${t('page_select_language')}</div>
          </div>
        </div>
        <div class="row" style="gap:12px;flex-wrap:wrap">
          <button class="btn ${getLang() === 'id' ? 'btn--soft' : 'btn--ghost'}" id="btn-lang-id" data-action="set-lang-id">
            ${t('page_settings_lang_id')}
          </button>
          <button class="btn ${getLang() === 'en' ? 'btn--soft' : 'btn--ghost'}" id="btn-lang-en" data-action="set-lang-en">
            ${t('page_settings_lang_en')}
          </button>
        </div>
      </div>

      <div class="card span-6">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_backup_title')}</div>
            <div class="card__sub">${t('page_backup_sub')}</div>
          </div>
        </div>
        <button class="btn btn--soft" data-action="export-backup" data-requires="data.backup">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${t('page_settings_export')}
        </button>
      </div>

      <div class="card span-6">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_restore_title')}</div>
            <div class="card__sub">${t('page_restore_sub')}</div>
          </div>
        </div>
        <input type="file" id="import-file" accept=".json" hidden />
        <button class="btn btn--ghost" data-action="import-backup" data-requires="data.backup">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          ${t('page_select_json')}
        </button>
      </div>

      <div class="card span-12">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_danger_zone')}</div>
            <div class="card__sub">${t('page_danger_sub')}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn btn--ghost" data-action="reset-data" data-requires="data.reset" style="color:var(--danger);border-color:var(--danger)">
            ${t('page_settings_reset')}
          </button>
        </div>
      </div>

      <div class="card span-12">
        <div class="card__header">
          <div>
            <div class="card__title">${t('page_about')}</div>
            <div class="card__sub">Chill Rental v1.0 — Modular Build</div>
          </div>
        </div>
        <div class="stack" style="color:var(--text-secondary);font-size:14px;line-height:1.7">
          <p><strong style="color:var(--text-primary)">Workflow:</strong> ${t('page_about_workflow')}</p>
          <p><strong style="color:var(--text-primary)">${t('page_about_arch_label')}:</strong> ${t('page_about_arch')}</p>
          <p><strong style="color:var(--text-primary)">${t('page_about_modules_label')}:</strong> ${t('page_about_modules')}</p>
        </div>
      </div>
    </div>
  `;
}
