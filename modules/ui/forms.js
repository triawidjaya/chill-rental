// =============================================================
// modules/ui/forms.js
// Form builders for rental, motor, owner, check-out
// =============================================================

import { Modal, Toast } from './notify.js';
import { MotorManager } from '../motors.js';
import { OwnerManager } from '../owners.js';
import { StaffManager } from '../staff.js';
import { RentalManager, renderRentalBadge, getRentalGrandTotal, getOwnerPayout } from '../rentals.js';
import { formatIDR, daysBetween, calcRentalDays, toISODateTime, escapeHTML, formatDate, attachNumericInput, isWithinCheckoutGrace } from '../utils.js';
import { t } from '../i18n.js';
import { SessionManager } from '../session.js';
import { showReceiptModal } from './receipt-modal.js';
import {
  invoiceNo,
  buildGuestCheckin, buildGuestInvoice,
  buildOwnerReturned, buildOwnerSettlement,
} from '../receipts.js';
import { recommendMotorOrder } from '../allocation.js';
import { BookingManager } from '../booking.js';

// Build the <option> list for the motor picker, ordered by fair-allocation
// recommendation (category priority → least-recently-rented). The top option is
// marked "⭐" as a SOFT suggestion — staff can still pick any motor.
export function motorOptionsHtml(motors) {
  const ordered = recommendMotorOrder(motors, RentalManager.list());
  return ordered.map((m, i) => `
            <option value="${m.id}" data-price="${m.pricePerDay}" data-pto="${m.payToOwnerPerDay || 0}" data-cc="${escapeHTML(m.cc)}" data-sr="${m.hasSurfrack ? 'true' : 'false'}">
              ${i === 0 ? '⭐ ' : ''}${escapeHTML(m.plate)} — ${escapeHTML(m.description)}${m.hasSurfrack ? ' 🏄' : ''}${m.phoneHolder ? ' 📱' : ''}${m.gps ? ' 📍' : ''} (${escapeHTML(m.ownerName)})
            </option>
          `).join('');
}

// Key-handover staff field for check-in / check-out. The stamp is auto-set to the
// logged-in user; only managers (rank >= 3) may pick a different staff member.
// Everyone else gets a disabled select locked to themselves, so it can't be set
// wrong. With no session (defensive), falls back to a normal pickable dropdown.
function staffSelectHtml({ id, labelKey }) {
  const cur = SessionManager.current();
  const curName = cur?.name || '';
  const curStamp = curName.toUpperCase();
  const canPick = !cur || SessionManager.rankOf(cur?.role) >= 3;
  const options = StaffManager.optionsForDropdown();

  if (canPick) {
    return `
        <label class="field__label" for="${id}">${t(labelKey)}</label>
        <select id="${id}" class="select">
          <option value="">${t('form_pick_staff')}</option>
          ${options.map(s => `<option value="${escapeHTML(s.value)}" ${s.value === curStamp ? 'selected' : ''}>${escapeHTML(s.label)}</option>`).join('')}
        </select>
        ${options.length === 0 ? `<span class="field__hint" style="color:var(--danger)">⚠ ${t('err_staff_not_found')}</span>` : ''}`;
  }

  // Non-manager: locked to the logged-in user.
  return `
        <label class="field__label" for="${id}">${t(labelKey)}</label>
        <select id="${id}" class="select" disabled>
          <option value="${escapeHTML(curStamp)}" selected>${escapeHTML(curName)}</option>
        </select>
        <span class="field__hint">${t('staff_auto_self')}</span>`;
}

// ---------- NEW RENTAL ----------
// `prefill` (optional) converts a confirmed online booking into a check-in:
//   { bookingId, bookingCode, guestName, wa, email, passportNo, finishDate, ccClass, surfrack }
export function openRentalForm(prefill = null) {
  const motorsAvail = MotorManager.available();
  if (motorsAvail.length === 0) {
    Toast.error(t('err_motor_unavailable'));
    return;
  }

  // Unique CC values from available motors (for the filter dropdown)
  const ccOptions = [...new Set(motorsAvail.map(m => m.cc).filter(Boolean))];

  const body = document.createElement('div');
  const now = toISODateTime(new Date());

  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <!-- ===== Step 1: Guest Identity ===== -->
      <div style="font-weight:700;color:var(--brand);font-size:13px;text-transform:uppercase;letter-spacing:0.04em">${t('form_step_identity')}</div>
      <div class="field">
        <label class="field__label required" for="f-guest">${t('form_guest_name')}</label>
        <input id="f-guest" class="input" placeholder="${t('form_guest_name_placeholder')}" required />
      </div>
      <div class="field-group">
        <div class="field">
          <label class="field__label required" for="f-wa">${t('form_wa')}</label>
          <input id="f-wa" class="input" type="tel" placeholder="${t('form_wa_placeholder')}" required />
        </div>
        <div class="field">
          <label class="field__label required" for="f-email">${t('form_email')}</label>
          <input id="f-email" class="input" type="email" placeholder="${t('form_email_placeholder')}" required />
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="f-passport">${t('form_passport_optional')}</label>
        <input id="f-passport" class="input" placeholder="${t('form_passport_placeholder')}" />
        <span class="field__hint">${t('form_passport_hint')}</span>
      </div>

      <!-- ===== Step 2: Filter & Pick Motor ===== -->
      <div style="font-weight:700;color:var(--brand);font-size:13px;text-transform:uppercase;letter-spacing:0.04em;margin-top:8px">${t('form_step_filter')}</div>
      <div class="field">
        <label class="field__label">${t('form_filter')}</label>
        <div class="segmented" id="filt-cc" style="margin-bottom:8px">
          <button type="button" class="segmented__opt is-active" data-cc="all">${t('form_filter_all_cc')}</button>
          ${ccOptions.map(cc => `<button type="button" class="segmented__opt" data-cc="${escapeHTML(cc)}">${escapeHTML(cc)} cc</button>`).join('')}
        </div>
        <div class="segmented" id="filt-sr">
          <button type="button" class="segmented__opt is-active" data-sr="all">${t('page_all')}</button>
          <button type="button" class="segmented__opt" data-sr="true">${t('form_filter_with_surfrack')}</button>
          <button type="button" class="segmented__opt" data-sr="false">${t('form_filter_without_surfrack')}</button>
        </div>
      </div>
      <div class="field">
        <label class="field__label required" for="f-motor">${t('form_vehicle')}</label>
        <select id="f-motor" class="select" required>
          <option value="">${t('form_vehicle_placeholder')}</option>
          ${motorOptionsHtml(motorsAvail)}
        </select>
        <span class="field__hint" id="motor-count">${motorsAvail.length} ${t('form_available_count')}</span>
        <span class="field__hint">⭐ ${t('form_recommended_hint')}</span>
      </div>

      <!-- Selected motor info (read-only) -->
      <div class="card" id="motor-info" style="background:var(--bg-subtle);padding:12px;display:none">
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary);margin-bottom:6px">${t('form_motor_info_title')}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;font-size:13px">
          <div><div class="muted" style="font-size:11px">${t('form_motor_price_per_day')}</div><strong id="mi-price">—</strong></div>
          <div><div class="muted" style="font-size:11px">${t('form_motor_pto_per_day')}</div><strong id="mi-pto">—</strong></div>
          <div><div class="muted" style="font-size:11px">${t('form_motor_owner')}</div><strong id="mi-owner">—</strong></div>
        </div>
      </div>

      <!-- ===== Step 3: Rental Time ===== -->
      <div style="font-weight:700;color:var(--brand);font-size:13px;text-transform:uppercase;letter-spacing:0.04em;margin-top:8px">${t('form_step_time')}</div>
      <div class="field-group">
        <div class="field">
          <label class="field__label required" for="f-start">${t('form_start')}</label>
          <input id="f-start" class="input" type="datetime-local" value="${now}" required />
        </div>
        <div class="field">
          <label class="field__label" for="f-finish">${t('form_finish_estimate')} <span class="muted" style="font-weight:400">(${t('form_optional')})</span></label>
          <input id="f-finish" class="input" type="datetime-local" />
          <span class="field__hint">${t('form_finish_hint')}</span>
        </div>
      </div>
      <div class="card" id="calc-card" style="background:var(--bg-subtle);padding:14px;display:none">
        <div class="row row--between">
          <span class="muted">${t('form_est_total_days')}</span>
          <strong id="calc-days">—</strong>
        </div>
        <div class="muted" style="font-size:12px;margin-top:6px">
          ${t('form_info_estimate')}
        </div>
      </div>

      <!-- ===== Step 4: Additional Details ===== -->
      <div style="font-weight:700;color:var(--brand);font-size:13px;text-transform:uppercase;letter-spacing:0.04em;margin-top:8px">${t('form_step_details')}</div>
      <div class="field">
        ${staffSelectHtml({ id: 'f-staff', labelKey: 'form_staff_key' })}
      </div>
      <div class="field">
        <label class="field__label" for="f-notes">${t('form_notes')}</label>
        <textarea id="f-notes" class="textarea" placeholder="${t('form_notes_placeholder')}"></textarea>
      </div>
      <div class="card" style="background:var(--bg-subtle);padding:10px;font-size:12px;color:var(--text-secondary)">
        ${t('form_info_payment_later')}
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
    <button class="btn" id="btn-save-rental">${t('btn_save')}</button>
  `;

  Modal.open({ title: t('modal_new_rental'), body, footer, size: 'lg' });

  const $ = (id) => body.querySelector(id);
  const motorSel = $('#f-motor');
  const motorCount = $('#motor-count');
  const motorInfo = $('#motor-info');
  const calcCard = $('#calc-card');

  // ----- Filter state -----
  let filtCc = 'all';
  let filtSr = 'all';

  const applyFilter = () => {
    const filtered = MotorManager.byCcAndSurfrack(filtCc, filtSr);
    motorSel.innerHTML = '<option value="">' + t('form_vehicle_placeholder') + '</option>' + motorOptionsHtml(filtered);
    motorCount.textContent = `${filtered.length} ${t('form_available_count')}`;
    motorSel.value = '';
    motorInfo.style.display = 'none';
  };

  body.querySelectorAll('#filt-cc [data-cc]').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('#filt-cc .segmented__opt').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      filtCc = btn.dataset.cc;
      applyFilter();
    });
  });
  body.querySelectorAll('#filt-sr [data-sr]').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('#filt-sr .segmented__opt').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      filtSr = btn.dataset.sr;
      applyFilter();
    });
  });

  motorSel.addEventListener('change', () => {
    const m = MotorManager.get(motorSel.value);
    if (m) {
      $('#mi-price').textContent = formatIDR(m.pricePerDay);
      $('#mi-pto').textContent = formatIDR(m.payToOwnerPerDay || 0);
      $('#mi-owner').textContent = m.ownerName || '—';
      motorInfo.style.display = '';
    } else {
      motorInfo.style.display = 'none';
    }
  });

  // Estimated days (only when finish is filled in)
  const recalc = () => {
    const start = $('#f-start').value;
    const finish = $('#f-finish').value;
    if (!finish) {
      calcCard.style.display = 'none';
      return;
    }
    const days = calcRentalDays(start, finish);
    calcCard.style.display = '';
    $('#calc-days').textContent = `${days} ${t('page_per_day')}`;
  };
  ['#f-start', '#f-finish'].forEach(s => $(s).addEventListener('input', recalc));

  // ----- Prefill: converting a confirmed booking into a check-in -----
  if (prefill) {
    if (prefill.guestName)  $('#f-guest').value = prefill.guestName;
    if (prefill.wa)         $('#f-wa').value = prefill.wa;
    if (prefill.email)      $('#f-email').value = prefill.email;
    if (prefill.passportNo) $('#f-passport').value = prefill.passportNo;
    // Booking dates are estimates; the real start is "now" (form default). Only the
    // estimated end is carried over (11:00 reflects the cut-off rule).
    if (prefill.finishDate) $('#f-finish').value = `${prefill.finishDate}T11:00`;

    // Narrow the motor list to the booked class / surfrack when those buttons exist.
    if (prefill.ccClass) {
      const ccBtn = body.querySelector(`#filt-cc [data-cc="${prefill.ccClass}"]`);
      if (ccBtn) ccBtn.click();
    }
    if (prefill.surfrack === true || prefill.surfrack === false) {
      const srBtn = body.querySelector(`#filt-sr [data-sr="${prefill.surfrack ? 'true' : 'false'}"]`);
      if (srBtn) srBtn.click();
    }

    if (prefill.bookingCode) {
      const banner = document.createElement('div');
      banner.className = 'card';
      banner.style.cssText = 'background:var(--brand-soft);color:var(--brand-soft-text);padding:10px;font-size:12px;font-weight:600;margin-bottom:12px';
      banner.textContent = `📲 ${t('booking_from_online') || 'From online booking'} ${prefill.bookingCode}`;
      body.insertBefore(banner, body.firstChild);
    }
    recalc();
  }

  // Simple email validation
  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // Submit
  document.getElementById('btn-save-rental').addEventListener('click', () => {
    const guestName = $('#f-guest').value.trim();
    const wa = $('#f-wa').value.trim();
    const email = $('#f-email').value.trim();
    const passportNo = $('#f-passport').value.trim();
    const motorId = $('#f-motor').value;
    const startDate = $('#f-start').value;
    const finishDate = $('#f-finish').value || null;
    const staffGivesKey = $('#f-staff').value.trim();
    const notes = $('#f-notes').value.trim();

    if (!guestName) return Toast.error(t('err_guest_required'));
    if (!wa) return Toast.error(t('err_wa_required'));
    if (!email) return Toast.error(t('err_email_required'));
    if (!isValidEmail(email)) return Toast.error(t('err_email_format'));
    if (!motorId) return Toast.error(t('err_vehicle_required'));
    if (!startDate) return Toast.error(t('err_start_required'));

    const data = {
      guestName, wa, email, passportNo,
      motorId, startDate, finishDate,
      staffGivesKey,
      notes,
      // Origination channel, derived from the flow (zero staff input): a check-in
      // converted from a confirmed online booking carries prefill.bookingId → 'online';
      // the plain manual "Rental Baru" form has no prefill → 'walk-in'.
      source: prefill?.bookingId ? 'online' : 'walk-in',
      // pricePerDay & payToOwner: LEAVE undefined — checkIn auto-fills from the motor
      // paymentMethod: LEAVE as default — it will be set at check-out
    };

    try {
      const rental = RentalManager.checkIn(data);
      // If this check-in came from a confirmed online booking, link & close it.
      if (prefill?.bookingId && rental?.id) {
        try { BookingManager.markCheckedIn(prefill.bookingId, rental.id); } catch (_) {}
      }
      Modal.close();
      Toast.success(t('toast_rental_created', { name: guestName }));
      window.dispatchEvent(new CustomEvent('route:refresh'));
    } catch (e) {
      Toast.error(e.message);
    }
  });
}

// ---------- RENTAL DETAIL / CHECKOUT ----------
export function openRentalDetail(rentalId) {
  const r = RentalManager.get(rentalId);
  if (!r) return Toast.error(t('err_not_found'));

  // Re-render the modal in-place after each action (without returning to the list).
  // route:refresh is only dispatched when the user closes the modal manually.
  const refreshDetail = () => {
    Modal.close();
    setTimeout(() => openRentalDetail(rentalId), 50);
  };

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <div class="card" style="background:var(--bg-subtle);padding:14px">
        <div style="font-family:var(--font-display);font-weight:800;font-size:20px">${escapeHTML(r.guestName)}</div>
        <div class="muted" style="margin-top:4px;font-size:13px">${escapeHTML(r.motorPlate)} · ${escapeHTML(r.motorDescription)}</div>
        <div style="margin-top:10px">${renderRentalBadge(r)}</div>
      </div>

      ${(r.wa || r.email || r.passportNo) ? `
        <div class="card" style="background:var(--bg-subtle);padding:10px;font-size:12px">
          ${r.wa ? `<div>📱 WA: <strong>${escapeHTML(r.wa)}</strong></div>` : ''}
          ${r.email ? `<div>✉ Email: <strong>${escapeHTML(r.email)}</strong></div>` : ''}
          ${r.passportNo ? `
            <div class="row" style="gap:6px;align-items:center;margin-top:2px">
              <span>📘 Passport: <strong>${escapeHTML(r.passportNo)}</strong></span>
              ${r.passportHeld
                ? '<span class="badge badge--warning" style="font-size:10px">DI-HOLD</span>'
                : (r.propertyCheckedOut ? '<span class="badge" style="font-size:10px">Released</span>' : '')}
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${r.status === 'active' ? `
        <div class="card" style="background:var(--bg-subtle);padding:12px;font-size:13px">
          <div class="row row--between">
            <div>
              <strong>${
                !r.propertyCheckedOut
                  ? t('detail_guest_staying')
                  : r.passportHeld
                    ? t('detail_passport_held')
                    : t('detail_passport_returned')
              }</strong>
              <div class="muted" style="font-size:12px;margin-top:2px">
                ${!r.propertyCheckedOut
                  ? t('detail_passport_not_needed')
                  : r.passportHeld
                    ? t('detail_passport_held_since', { date: formatDate(r.passportHeldAt) })
                    : t('detail_passport_already_returned')}
              </div>
            </div>
            ${r.passportHeld ? `
              <button class="btn btn--ghost btn--sm" id="btn-release-passport">${t('passport_kembalikan')}</button>
            ` : `
              <button class="btn btn--ghost btn--sm" id="btn-hold-passport">${t('passport_tahan')}</button>
            `}
          </div>
        </div>

        ${r.suspectedDamage ? `
          <div class="card" style="background:var(--warning-soft,#fff3cd);border-left:4px solid var(--warning,#d97706);padding:12px">
            <div class="row row--between" style="margin-bottom:6px">
              <div style="font-weight:700;color:var(--warning,#d97706)">${t('damage_suspected_reported')}</div>
              <button class="btn btn--ghost btn--sm" id="btn-clear-damage-flag" style="font-size:11px">✕ ${t('btn_delete')}</button>
            </div>
            <div style="font-size:13px;color:var(--text-primary)">${escapeHTML(r.suspectedDamageNote)}</div>
            <div class="muted" style="font-size:11px;margin-top:4px">${t('detail_suspected_at', { date: formatDate(r.suspectedDamageAt) })}</div>
          </div>
        ` : `
          <button class="btn btn--ghost btn--sm" id="btn-flag-damage" style="color:var(--warning,#d97706);border-color:var(--warning,#d97706);width:100%">
            ${t('damage_report_btn')}
          </button>
        `}
      ` : ''}

      <div class="detail-grid">
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${t('detail_start')}</div><div style="font-weight:600;margin-top:2px">${formatDate(r.startDate)}</div></div>
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${r.status === 'active' ? t('detail_end_estimate') : t('detail_end')}</div><div style="font-weight:600;margin-top:2px">${formatDate(r.actualFinishDate || r.finishDate) || `— (${t('detail_not_set')})`}</div></div>
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${r.status === 'active' ? t('detail_days_estimate') : t('detail_days_total')}</div><div style="font-weight:600;margin-top:2px">${r.totalDays || '—'}</div></div>
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${t('detail_price_per_day')}</div><div style="font-weight:600;margin-top:2px">${formatIDR(r.pricePerDay)}</div></div>
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${t('detail_rental_cost')}</div><div style="font-weight:700;color:var(--brand);margin-top:2px">${r.status === 'active' ? `<span class="muted">${t('detail_final_at_checkout')}</span>` : formatIDR(r.totalCost)}</div></div>
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${t('detail_pay_owner')}</div><div style="font-weight:600;margin-top:2px">${r.status === 'active' ? formatIDR(r.payToOwnerPerDay || 0) + '/' + t('page_per_day') : formatIDR(r.payToOwner)}</div></div>
        ${r.newDamage && r.status !== 'active' ? `
        <div style="grid-column:1/-1;border-top:1px solid var(--border);padding-top:10px;margin-top:2px">
          <div class="row row--between" style="font-size:13px">
            <span class="muted">${t('detail_rental_cost')}</span><span>${formatIDR(r.totalCost)}</span>
          </div>
          <div class="row row--between" style="font-size:13px;margin-top:4px">
            <span class="muted">${t('detail_damage_compensation')}</span><span style="color:var(--danger)">+ ${formatIDR(r.damageCharge)}</span>
          </div>
          <div class="row row--between" style="font-size:14px;font-weight:800;margin-top:8px;padding-top:6px;border-top:1px solid var(--border)">
            <span>${t('detail_total_bill')}</span><span style="color:var(--brand)">${formatIDR(getRentalGrandTotal(r))}</span>
          </div>
        </div>
        ` : ''}
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${t('detail_commission_short')}</div><div style="font-weight:600;color:var(--success);margin-top:2px">${r.status === 'active' ? '—' : formatIDR(r.commission)}</div></div>
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${t('detail_owner')}</div><div style="font-weight:600;margin-top:2px">${escapeHTML(r.ownerName || '—')}</div></div>
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${t('detail_staff_key_out')}</div><div style="font-weight:600;margin-top:2px">${escapeHTML(r.staffGivesKey || '—')}</div></div>
        <div><div class="muted" style="font-size:11px;text-transform:uppercase">${t('detail_payment_method')}</div><div style="font-weight:600;margin-top:2px">${escapeHTML(r.paymentMethod || '—')}</div></div>
      </div>

      ${r.newDamage ? `
        <div class="card" style="background:var(--danger-soft);border-color:transparent;color:var(--danger);padding:12px">
          <div class="row row--between" style="margin-bottom:4px">
            <div style="font-weight:700">${t('detail_damage_header')}</div>
            <div class="row" style="gap:8px;align-items:center">
              ${r.damageResolved ? `<span class="badge badge--success">${t('detail_damage_done')}</span>` : `<span class="badge badge--warning">${t('detail_damage_pending')}</span>`}
              ${!r.ownerSettled ? `<button class="btn btn--ghost btn--sm" id="btn-edit-damage" style="font-size:11px;color:var(--danger);border-color:var(--danger)">✎ ${t('btn_edit')}</button>` : ''}
            </div>
          </div>
          <div style="font-size:13px">${escapeHTML(r.damageDescription) || `<span style="opacity:0.6">— ${t('detail_damage_no_desc')} —</span>`} — ${formatIDR(r.damageCharge)}</div>
        </div>
      ` : ''}

      ${(r.status === 'returned' || r.status === 'completed') ? (() => {
        const damageBlocking = r.newDamage && !r.damageResolved;
        const passportBlocking = r.passportHeld;
        const today = new Date().toISOString().slice(0, 10);
        const canUndoPaid    = r.paid && !r.ownerSettled && (r.paidAt || '').slice(0, 10) === today;
        const canUndoSettle  = r.ownerSettled && (r.ownerSettledAt || '').slice(0, 10) === today;
        const canUndoDamage  = r.newDamage && r.damageResolved && !r.paid;
        const noneVisible = false;
        return `
        <div class="card" style="border-color:var(--border-strong);padding:14px">
          <div style="font-weight:700;margin-bottom:10px">${t('detail_section_follow_up')}</div>
          ${noneVisible ? `
            <div style="font-size:13px;color:var(--success)">${t('detail_all_done')}</div>
          ` : `
            <div class="stack" style="gap:10px;font-size:13px">

              ${passportBlocking ? `
                <div class="action-row">
                  <div style="min-width:0">
                    <div style="font-weight:600">${t('passport_still_held')}</div>
                    <div class="muted" style="font-size:11px;margin-top:2px">${t('passport_return_before_pay')}</div>
                  </div>
                  <button class="btn btn--sm action-row__btn" id="btn-release-passport-returned" style="font-weight:700">${t('btn_return')}</button>
                </div>
              ` : ''}

              <!-- Step 1: Damage (must be resolved FIRST if any) -->
              ${r.newDamage ? (r.damageResolved ? `
                <div class="action-row">
                  <div style="color:var(--success);min-width:0">
                    <div style="font-weight:600">${t('detail_damage_resolved_label')}</div>
                    <div class="muted" style="font-size:12px;margin-top:2px">${formatIDR(r.damageCharge)}</div>
                  </div>
                  ${canUndoDamage ? `
                    <button class="btn btn--ghost btn--sm action-row__btn" id="btn-unmark-damage" style="color:var(--danger);border-color:var(--danger)">↩ ${t('btn_cancel')}</button>
                  ` : ''}
                </div>
              ` : `
                <button class="btn btn--block" id="btn-mark-damage" style="background:var(--warning);color:#1a1209;box-shadow:0 4px 14px var(--warning-soft);font-weight:700">
                  ${t('detail_step1_damage')}
                </button>
              `) : ''}

              <!-- Step 2: Pay (only enabled when damage is resolved & passport is not held) -->
              ${r.paid ? `
                <div class="action-row">
                  <div style="color:var(--success);min-width:0">
                    <div style="font-weight:600">${t('detail_paid_label')}</div>
                    <div class="muted" style="font-size:12px;margin-top:2px;word-break:break-word">${formatDate(r.paidAt)} · ${escapeHTML(r.paymentMethod || '-')}</div>
                  </div>
                  ${canUndoPaid ? `
                    <button class="btn btn--ghost btn--sm action-row__btn" id="btn-unmark-paid" style="color:var(--danger);border-color:var(--danger)">↩ ${t('btn_cancel')}</button>
                  ` : ''}
                </div>
              ` : (damageBlocking || passportBlocking ? `
                <button class="btn btn--ghost btn--block" disabled style="cursor:not-allowed;opacity:0.55">
                  🔒 ${damageBlocking ? t('damage_locked_fix_first') : t('damage_locked_return_passport')}
                </button>
              ` : `
                <button class="btn btn--block" id="btn-mark-paid" style="box-shadow:0 4px 14px var(--brand-soft);font-weight:700;letter-spacing:0.2px">
                  💰 ${r.newDamage ? '2.' : '1.'} ${t('detail_step2_pay')}
                </button>
              `)}

              <!-- Step 3: Settle Owner (only enabled after payment) -->
              ${r.ownerSettled ? `
                <div class="action-row">
                  <div style="color:var(--success);min-width:0">
                    <div style="font-weight:600">${t('detail_settled_label')}</div>
                    <div class="muted" style="font-size:12px;margin-top:2px">${formatDate(r.ownerSettledAt)} · ${formatIDR(getOwnerPayout(r))}</div>
                  </div>
                  ${canUndoSettle ? `
                    <button class="btn btn--ghost btn--sm action-row__btn" id="btn-unmark-settle" style="color:var(--danger);border-color:var(--danger)">↩ ${t('btn_cancel')}</button>
                  ` : ''}
                </div>
              ` : (r.paid ? `
                <button class="btn btn--block" id="btn-mark-settle" style="background:var(--info, #4185d6);color:var(--text-inverse,#fff);box-shadow:0 4px 14px rgba(91,156,246,0.25);font-weight:700">
                  🔑 ${r.newDamage ? '3.' : '2.'} ${t('detail_step3_settle')} · ${formatIDR(getOwnerPayout(r))}
                </button>
              ` : `
                <button class="btn btn--ghost btn--block" disabled style="cursor:not-allowed;opacity:0.55">
                  🔒 ${t('damage_locked_pay_first')}
                </button>
              `)}

            </div>
          `}
        </div>
        `;
      })() : ''}

      ${(() => {
        const isFullyDone = (r.status === 'returned' || r.status === 'completed')
          && r.paid && r.ownerSettled && r.damageResolved;
        const settledDate = (r.ownerSettledAt || '').slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        const canCorrect = isFullyDone && settledDate === today;
        if (!isFullyDone) return '';
        return `
          <div class="card" style="border-color:var(--border);padding:14px;margin-top:4px">
            <div class="row row--between" style="margin-bottom:6px">
              <div>
                <div style="font-weight:700;font-size:13px">${t('detail_admin_correction')}</div>
                <div class="muted" style="font-size:11px;margin-top:2px">
                  ${canCorrect
                    ? t('detail_admin_can_correct')
                    : t('detail_admin_locked', { date: settledDate })}
                </div>
              </div>
              ${canCorrect ? `
                <button class="btn btn--ghost btn--sm" id="btn-admin-correct">${t('btn_correct_short')}</button>
              ` : `
                <span class="badge" style="opacity:0.5">${t('detail_locked_badge')}</span>
              `}
            </div>
          </div>
        `;
      })()}

      ${r.status === 'active' ? (() => {
        return `
        <div class="card" style="border-color:var(--brand);border-width:2px;padding:14px">
          <div style="font-weight:700;margin-bottom:10px">${t('detail_section_checkout')}</div>
          <div class="stack" style="gap:12px">
            <div class="field">
              <label class="field__label" for="co-finish">${t('detail_actual_return')}</label>
              ${(() => {
                // Non-admins can only adjust the return time inside the post-cut-off
                // grace window (today, until 11:30); otherwise it is locked to "now".
                // Authoritative enforcement lives in RentalManager.checkOut().
                const nowLocal = toISODateTime(new Date());
                const graceTime = '11:30';
                if (SessionManager.can('rental.editFinishTime')) {
                  return `<input id="co-finish" class="input" type="datetime-local" value="${nowLocal}" />`;
                }
                if (isWithinCheckoutGrace()) {
                  const todayStart = `${nowLocal.slice(0, 10)}T00:00`;
                  return `<input id="co-finish" class="input" type="datetime-local" value="${nowLocal}" min="${todayStart}" max="${nowLocal}" />
              <span class="field__hint">${t('co_finish_grace_hint', { time: graceTime })}</span>`;
                }
                return `<input id="co-finish" class="input" type="datetime-local" value="${nowLocal}" disabled style="opacity:0.65;cursor:not-allowed" />
              <span class="field__hint">${t('co_finish_locked_hint', { time: graceTime })}</span>`;
              })()}
              <span class="field__hint" id="co-cutoff-hint">${t('detail_pick_date_hint')}</span>
            </div>
            <div class="card" id="co-calc-card" style="background:var(--bg-subtle);padding:12px">
              <div class="row row--between"><span class="muted">${t('detail_total_days')}</span><strong id="co-calc-days">—</strong></div>
              <div class="row row--between" style="margin-top:6px"><span class="muted">${t('detail_total_cost')}</span><strong id="co-calc-total" style="color:var(--brand)">—</strong></div>
              <div class="row row--between" style="margin-top:6px"><span class="muted">${t('detail_pay_owner')}</span><strong id="co-calc-pto">—</strong></div>
              <div class="row row--between" style="margin-top:6px"><span class="muted">${t('detail_commission')}</span><strong id="co-calc-comm" style="color:var(--success)">—</strong></div>
            </div>
            <div class="field">
              ${staffSelectHtml({ id: 'co-staff', labelKey: 'detail_staff_receive_key' })}
            </div>
            ${r.suspectedDamage ? `
              <div class="card" style="background:var(--warning-soft,#fff3cd);border-left:4px solid var(--warning,#d97706);padding:10px;font-size:12px">
                ${t('damage_suspected_reported')} ${escapeHTML(r.suspectedDamageNote)}<br/>
                <span class="muted">${t('damage_confirm_below')}</span>
              </div>
            ` : ''}
            <div class="field-group">
              <div class="field">
                <label class="field__label" for="co-damage">${t('detail_any_damage')}</label>
                <select id="co-damage" class="select">
                  <option value="false" ${!r.suspectedDamage ? 'selected' : ''}>${t('damage_no')}</option>
                  <option value="true" ${r.suspectedDamage ? 'selected' : ''}>${t('damage_yes')}</option>
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="co-charge">${t('detail_damage_charge')}</label>
                <input id="co-charge" class="input" value="0" />
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="co-desc">${t('detail_damage_desc')}</label>
              <textarea id="co-desc" class="textarea" placeholder="${t('damage_report_placeholder')}">${escapeHTML(r.suspectedDamageNote || '')}</textarea>
            </div>
            <div class="field">
              <label class="field__label" for="co-reason">${t('detail_checkout_reason')} <span class="muted" style="font-weight:400">(${t('form_optional')})</span></label>
              <textarea id="co-reason" class="textarea" rows="2" placeholder="${t('co_reason_placeholder')}"></textarea>
              <span class="field__hint">${t('detail_checkout_reason_hint')}</span>
            </div>
            <div class="card" style="background:var(--bg-subtle);padding:10px;font-size:12px;color:var(--text-secondary)">
              ${t('detail_after_checkout_info')}
            </div>
          </div>
        </div>
        `;
      })() : ''}

      ${(() => {
        const isReturned = r.status === 'returned' || r.status === 'completed';
        const btns = [];
        if (r.status === 'active') {
          btns.push(`<button class="btn btn--ghost btn--sm btn--block" id="btn-wa-checkin">🟢 ${t('wa_checkin')}</button>`);
        }
        if (isReturned) {
          btns.push(`<button class="btn btn--ghost btn--sm btn--block" id="btn-wa-invoice">🟢 ${t('wa_invoice')}</button>`);
          btns.push(`<button class="btn btn--ghost btn--sm btn--block" id="btn-wa-owner-returned">🏍 ${t('wa_owner_returned')}</button>`);
          if (r.ownerSettled) {
            btns.push(`<button class="btn btn--ghost btn--sm btn--block" id="btn-wa-settlement">🏍 ${t('wa_owner_settlement')}</button>`);
          }
        }
        if (!btns.length) return '';
        return `
          <div class="card" style="border-color:var(--border);padding:14px">
            <div style="font-weight:700;margin-bottom:10px">${t('wa_section')}</div>
            <div class="stack" style="gap:8px">${btns.join('')}</div>
          </div>
        `;
      })()}
    </div>
  `;

  const footer = document.createElement('div');
  footer.className = 'modal-footer-split';

  if (r.status === 'active') {
    footer.innerHTML = `
      <button class="btn btn--ghost btn--sm" id="btn-cancel-rental"
        style="color:var(--danger);border-color:transparent;opacity:0.7;font-size:12px"
        title="${t('btn_cancel_rental')}">
        ✕ ${t('btn_cancel_rental')}
      </button>
      <div class="modal-footer-actions">
        <button class="btn btn--ghost btn--sm" id="btn-edit-rental" title="${t('btn_edit_rental_title')}">
          ✎ ${t('btn_edit')}
        </button>
        <button class="btn" id="btn-checkout">
          ${t('btn_checkout')}
        </button>
      </div>
    `;
  } else if ((r.status === 'returned' || r.status === 'completed') && !r.paid) {
    footer.innerHTML = `
      <button class="btn btn--ghost btn--sm" id="btn-undo-checkout"
        style="color:var(--warning,#856404);border-color:transparent;opacity:0.7;font-size:12px"
        title="${t('btn_back_to_active_title')}">
        ↩ ${t('btn_undo_checkout')}
      </button>
      <div></div>
    `;
  } else {
    const isFullyDone = (r.status === 'returned' || r.status === 'completed')
      && r.paid && r.ownerSettled && r.damageResolved;
    footer.innerHTML = isFullyDone
      ? `<button class="btn btn--block" data-close style="background:var(--success);color:#fff;font-weight:700">${t('btn_done')}</button>`
      : '';
  }

    Modal.open({
    title: t('modal_detail_rental'), body, footer, size: 'lg',
    onClose: () => window.dispatchEvent(new CustomEvent('route:refresh')),
  });

  // WhatsApp receipt buttons — open a read-only preview with Copy / Open WA.
  // Guest messages carry r.wa (enables Open WA); owner messages are Copy-only.
  const wireReceipt = (id, build, audience) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      showReceiptModal({
        title: t('wa_modal_title'),
        subtitle: `${invoiceNo(r)} · ${r.guestName}`,
        text: build(r),
        waNumber: audience === 'guest' ? r.wa : '',
        onClose: () => setTimeout(() => openRentalDetail(rentalId), 50),
      });
    });
  };
  wireReceipt('btn-wa-checkin', buildGuestCheckin, 'guest');
  wireReceipt('btn-wa-invoice', buildGuestInvoice, 'guest');
  wireReceipt('btn-wa-owner-returned', buildOwnerReturned, 'owner');
  wireReceipt('btn-wa-settlement', buildOwnerSettlement, 'owner');

  if (r.status === 'active') {
    // Live preview of the total cost based on the 11 AM rule
    const $$ = (id) => body.querySelector(id);
    const updateCoCalc = () => {
      const finish = $$('#co-finish').value;
      if (!finish) return;
      const days = calcRentalDays(r.startDate, finish);
      const total = (r.pricePerDay || 0) * days;
      const ptoPerDay = r.payToOwnerPerDay != null
        ? r.payToOwnerPerDay
        : (r.totalDays > 0 ? Math.round((r.payToOwner || 0) / r.totalDays) : 50000);
      const pto = ptoPerDay * days;
      const comm = total - pto;
      $$('#co-calc-days').textContent = `${days} ${t('page_days')}`;
      $$('#co-calc-total').textContent = formatIDR(total);
      $$('#co-calc-pto').textContent = formatIDR(pto);
      $$('#co-calc-comm').textContent = formatIDR(comm);

      // Cut-off hint
      const e = new Date(finish);
      const hint = $$('#co-cutoff-hint');
      if (e.getHours() < 11) {
        hint.innerHTML = t('co_cutoff_before');
        hint.style.color = 'var(--success)';
      } else {
        hint.innerHTML = t('co_cutoff_after');
        hint.style.color = 'var(--warning, #b58900)';
      }
    };
    $$('#co-finish').addEventListener('input', updateCoCalc);
    updateCoCalc();  // initial

    // Attach the thousand separator to the damage-charge input
    const getChargeValue = attachNumericInput($$('#co-charge'), { placeholder: '0' });

    document.getElementById('btn-checkout').addEventListener('click', () => {
      const staffReceivesKey = body.querySelector('#co-staff').value.trim();
      if (!staffReceivesKey) return Toast.error(t('err_staff_key_required'));

      const data = {
        actualFinishDate: body.querySelector('#co-finish').value,
        staffReceivesKey,
        newDamage: body.querySelector('#co-damage').value === 'true',
        damageDescription: body.querySelector('#co-desc').value.trim(),
        damageCharge: getChargeValue(),
        checkoutReason: body.querySelector('#co-reason').value.trim(),
      };
      try {
        RentalManager.checkOut(r.id, data);
        Toast.success(t('toast_checkout_done', { name: r.guestName }));
        refreshDetail();
      } catch (e) { Toast.error(e.message); }
    });
    document.getElementById('btn-cancel-rental').addEventListener('click', async () => {
      if (!SessionManager.can('rental.cancel')) { Toast.error(t('auth_no_access')); return; }
      try {
        // Guard check first — if it throws, show the message without a confirm dialog
        // Run a dry-run by manually checking elapsed days
        const daysSoFar = Math.max(0,
          Math.floor((Date.now() - new Date(r.startDate).getTime()) / 86400000)
        );
        if (daysSoFar > 0) {
          await Modal.confirm({
            title: t('confirm_cannot_cancel_title'),
            message: t('confirm_cannot_cancel_msg', { days: daysSoFar, date: formatDate(r.startDate) }),
            confirmText: t('btn_got_it'),
          });
          return;
        }
        const ok = await Modal.confirm({
          title: t('confirm_cancel_rental_title'),
          message: t('confirm_cancel_rental_msg'),
          variant: 'danger',
          confirmText: t('btn_yes_cancel'),
        });
        if (ok) {
          RentalManager.cancel(r.id);
          Toast.success(t('toast_rental_cancelled'));
          window.dispatchEvent(new CustomEvent('route:refresh'));
        }
      } catch (e) { Toast.error(e.message); }
    });

    // R10: Edit Detail
    const btnEdit = document.getElementById('btn-edit-rental');
    if (btnEdit) {
        btnEdit.addEventListener('click', () => {
        Modal.close();
        // small delay so the old modal closes first
        setTimeout(() => openRentalEditForm(r.id, () => openRentalDetail(rentalId)), 100);
      });
    }

    // Flag suspected damage while active
    const btnFlagDamage = document.getElementById('btn-flag-damage');
    if (btnFlagDamage) {
      btnFlagDamage.addEventListener('click', async () => {
        const note = await openTextInputModal({
          title: t('modal_report_damage'),
          label: t('damage_report_label'),
          placeholder: t('damage_report_placeholder'),
          confirmText: t('btn_save'),
        });
        if (!note) return;
        try {
          RentalManager.flagDamage(r.id, { note });
          Toast.success(t('toast_damage_reported'));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }

    const btnClearFlag = document.getElementById('btn-clear-damage-flag');
    if (btnClearFlag) {
      btnClearFlag.addEventListener('click', async () => {
        const ok = await Modal.confirm({
          title: t('confirm_delete_damage_flag_title'),
          message: t('confirm_delete_damage_flag_msg'),
          confirmText: t('btn_delete'),
        });
        if (!ok) return;
        try {
          RentalManager.clearDamageFlag(r.id);
          Toast.success(t('toast_damage_report_removed'));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }

    // R9: Hold passport
    const btnHold = document.getElementById('btn-hold-passport');
    if (btnHold) {
      btnHold.addEventListener('click', async () => {
        const passportNo = await openPassportInputModal(r.passportNo, r.guestName);
        if (!passportNo) return;
        try {
          RentalManager.holdPassport(r.id, { passportNo });
          Toast.success(t('passport_toast_held', { no: passportNo.slice(0, 4) + '***' }));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }
    const btnRelease = document.getElementById('btn-release-passport');
    if (btnRelease) {
      btnRelease.addEventListener('click', async () => {
        const ok = await Modal.confirm({
          title: t('confirm_return_passport_title'),
          message: t('confirm_return_passport_msg', { name: r.guestName }),
          confirmText: t('btn_return'),
        });
        if (!ok) return;
        try {
          RentalManager.releasePassport(r.id);
          Toast.success(t('toast_passport_returned'));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }
  }

  // Undo Check-Out (footer button, only shown when !paid)
  const btnUndoCheckout = document.getElementById('btn-undo-checkout');
  if (btnUndoCheckout) {
    btnUndoCheckout.addEventListener('click', async () => {
      const ok = await Modal.confirm({
        title: t('confirm_undo_checkout_title'),
        message: t('confirm_undo_checkout_msg', { name: r.guestName, plate: r.motorPlate }),
        variant: 'danger',
        confirmText: t('btn_yes_cancel'),
      });
      if (!ok) return;
      try {
          RentalManager.undoCheckOut(r.id);
        Toast.success(t('toast_checkout_undone'));
        refreshDetail();
      } catch (e) { Toast.error(e.message); }
    });
  }

  // R8: handlers for the 3 multi-flag actions (status='returned')
  if (r.status === 'returned' || r.status === 'completed') {
    const btnPaid   = document.getElementById('btn-mark-paid');
    const btnSettle = document.getElementById('btn-mark-settle');
    const btnDamage = document.getElementById('btn-mark-damage');

    if (btnPaid) {
      btnPaid.addEventListener('click', () => {
        Modal.close();
        setTimeout(() => openMarkPaidForm(r.id, () => openRentalDetail(rentalId)), 100);
      });
    }

    if (btnSettle) {
      btnSettle.addEventListener('click', async () => {
        if (!SessionManager.can('owner.settle')) { Toast.error(t('auth_no_access')); return; }
        const ok = await Modal.confirm({
          title: t('confirm_handover_title'),
          message: t('confirm_handover_msg', { amount: formatIDR(r.payToOwner), owner: r.ownerName || 'owner' }),
          confirmText: t('btn_confirm'),
        });
        if (!ok) return;
        try {
          RentalManager.markOwnerSettled(r.id);
          Toast.success(t('toast_handover_done'));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }

    if (btnDamage) {
      btnDamage.addEventListener('click', async () => {
        const ok = await Modal.confirm({
          title: t('confirm_mark_damage_done_title'),
          message: t('confirm_mark_damage_done_msg', { desc: r.damageDescription, amount: formatIDR(r.damageCharge) }),
          confirmText: t('btn_mark_done'),
        });
        if (!ok) return;
        try {
          RentalManager.markDamageResolved(r.id);
          Toast.success(t('toast_damage_resolved'));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }

    // Undo Damage Resolved
    const btnUnmarkDamage = document.getElementById('btn-unmark-damage');
    if (btnUnmarkDamage) {
      btnUnmarkDamage.addEventListener('click', async () => {
        const ok = await Modal.confirm({
          title: t('confirm_reopen_damage_title'),
          message: t('confirm_reopen_damage_msg', { desc: r.damageDescription }),
          variant: 'danger',
          confirmText: t('btn_reopen'),
        });
        if (!ok) return;
        try {
          RentalManager.unmarkDamageResolved(r.id);
          Toast.success(t('toast_damage_reopened'));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }

    // Admin Correction (only fullyDone + same day)
    const btnAdminCorrect = document.getElementById('btn-admin-correct');
    if (btnAdminCorrect) {
      btnAdminCorrect.addEventListener('click', () => {
        if (!SessionManager.can('rental.correct')) { Toast.error(t('auth_no_access')); return; }
        Modal.close();
        setTimeout(() => openAdminCorrectForm(r.id, () => openRentalDetail(rentalId)), 100);
      });
    }

    // Undo Settle Owner
    const btnUnmarkSettle = document.getElementById('btn-unmark-settle');
    if (btnUnmarkSettle) {
      btnUnmarkSettle.addEventListener('click', async () => {
        if (!SessionManager.can('owner.settle')) { Toast.error(t('auth_no_access')); return; }
        const ok = await Modal.confirm({
          title: t('confirm_cancel_handover_title'),
          message: t('confirm_cancel_handover_msg', { owner: r.ownerName || 'owner' }),
          variant: 'danger',
          confirmText: t('btn_yes_cancel'),
        });
        if (!ok) return;
        try {
          RentalManager.unmarkOwnerSettled(r.id);
          Toast.success(t('toast_handover_cancelled'));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }

    // Edit damage (description + charge) before resolved & before paid
    const btnEditDamage = document.getElementById('btn-edit-damage');
    if (btnEditDamage) {
      btnEditDamage.addEventListener('click', () => {
        Modal.close();
        setTimeout(() => openEditDamageForm(r.id, () => openRentalDetail(rentalId)), 100);
      });
    }

    // Release passport from the returned status (button in the warning card)
    const btnReleaseReturned = document.getElementById('btn-release-passport-returned');
    if (btnReleaseReturned) {
      btnReleaseReturned.addEventListener('click', async () => {
        const ok = await Modal.confirm({
          title: t('confirm_passport_returned_title'),
          message: t('confirm_passport_returned_msg', { passport: r.passportNo || '', name: r.guestName }),
          confirmText: t('btn_confirm'),
        });
        if (!ok) return;
        try {
          RentalManager.releasePassport(r.id);
          Toast.success(t('toast_passport_returned_proceed'));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }

    // Unmark Paid (only shown when paid && !ownerSettled)
    const btnUnmarkPaid = document.getElementById('btn-unmark-paid');
    if (btnUnmarkPaid) {
      btnUnmarkPaid.addEventListener('click', async () => {
        const ok = await Modal.confirm({
          title: t('confirm_cancel_payment_title'),
          message: t('confirm_cancel_payment_msg', { name: r.guestName }),
          variant: 'danger',
          confirmText: t('btn_yes_cancel'),
        });
        if (!ok) return;
        try {
          RentalManager.unmarkPaid(r.id);
          Toast.success(t('toast_payment_cancelled'));
          refreshDetail();
        } catch (e) { Toast.error(e.message); }
      });
    }
  }
}

// ---------- EDIT RENTAL (R10 — active only) ----------
export function openRentalEditForm(rentalId, afterSave = null) {
  const r = RentalManager.get(rentalId);
  if (!r) return Toast.error(t('err_rental_not_found'));
  if (r.status !== 'active') {
    return Toast.error(t('err_not_active'));
  }

  // Motor options: available + the current motor (so it does not disappear from the dropdown)
  const motorsAvail = MotorManager.available();
  const currentMotor = MotorManager.get(r.motorId);
  const motorOptions = currentMotor && !motorsAvail.some(m => m.id === currentMotor.id)
    ? [currentMotor, ...motorsAvail]
    : motorsAvail;

  const staffOptions = StaffManager.optionsForDropdown();

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <div class="card" style="background:var(--warning-soft, #fff3cd);padding:10px;font-size:12px;color:var(--warning, #856404)">
        ${t('page_edit_warning')}
      </div>

      <div style="font-weight:700;color:var(--brand);font-size:13px;text-transform:uppercase;letter-spacing:0.04em">${t('form_section_identity')}</div>
      <div class="field">
        <label class="field__label required" for="ef-guest">${t('form_guest_name')}</label>
        <input id="ef-guest" class="input" value="${escapeHTML(r.guestName || '')}" required />
      </div>
      <div class="field-group">
        <div class="field">
          <label class="field__label required" for="ef-wa">${t('form_wa')}</label>
          <input id="ef-wa" class="input" type="tel" value="${escapeHTML(r.wa || '')}" required />
        </div>
        <div class="field">
          <label class="field__label required" for="ef-email">${t('form_email')}</label>
          <input id="ef-email" class="input" type="email" value="${escapeHTML(r.email || '')}" required />
        </div>
      </div>

      <div style="font-weight:700;color:var(--brand);font-size:13px;text-transform:uppercase;letter-spacing:0.04em;margin-top:8px">${t('form_section_vehicle')}</div>
      <div class="field">
        <label class="field__label required" for="ef-motor">${t('form_section_vehicle')}</label>
        <select id="ef-motor" class="select" required>
          ${motorOptions.map(m => `
            <option value="${m.id}" ${m.id === r.motorId ? 'selected' : ''}>
              ${escapeHTML(m.plate)} — ${escapeHTML(m.description)}${m.hasSurfrack ? ' 🏄' : ''}${m.id === r.motorId ? ` ${t('form_edit_vehicle_current')}` : ''}
            </option>
          `).join('')}
        </select>
        <span class="field__hint">${t('form_edit_vehicle_hint')}</span>
      </div>

      <div style="font-weight:700;color:var(--brand);font-size:13px;text-transform:uppercase;letter-spacing:0.04em;margin-top:8px">${t('form_section_time')}</div>
      <div class="field-group">
        <div class="field">
          <label class="field__label required" for="ef-start">${t('form_start')}</label>
          <input id="ef-start" class="input" type="datetime-local" value="${toISODateTime(r.startDate)}" required />
        </div>
        <div class="field">
          <label class="field__label" for="ef-finish">${t('form_finish_estimate')}</label>
          <input id="ef-finish" class="input" type="datetime-local" value="${r.finishDate ? toISODateTime(r.finishDate) : ''}" />
        </div>
      </div>

      <div style="font-weight:700;color:var(--brand);font-size:13px;text-transform:uppercase;letter-spacing:0.04em;margin-top:8px">${t('form_section_details')}</div>
      <div class="field">
        <label class="field__label" for="ef-staff">${t('form_edit_staff_key')}</label>
        <select id="ef-staff" class="select">
          <option value="">${t('form_pick_staff')}</option>
          ${staffOptions.map(s => `<option value="${escapeHTML(s.value)}" ${s.value === r.staffGivesKey ? 'selected' : ''}>${escapeHTML(s.label)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="ef-notes">${t('form_owner_notes')}</label>
        <textarea id="ef-notes" class="textarea">${escapeHTML(r.notes || '')}</textarea>
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
    <button class="btn" id="btn-save-edit">${t('btn_save_changes')}</button>
  `;

  Modal.open({ title: t('modal_edit_rental_title'), body, footer, size: 'lg' });

  document.getElementById('btn-save-edit').addEventListener('click', () => {
    const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    const guestName = body.querySelector('#ef-guest').value.trim();
    const wa = body.querySelector('#ef-wa').value.trim();
    const email = body.querySelector('#ef-email').value.trim();

    if (!guestName) return Toast.error(t('err_guest_required'));
    if (!wa) return Toast.error(t('err_wa_required'));
    if (!email) return Toast.error(t('err_email_required'));
    if (!isValidEmail(email)) return Toast.error(t('err_email_format'));

    const patch = {
      guestName, wa, email,
      motorId: body.querySelector('#ef-motor').value,
      startDate: body.querySelector('#ef-start').value,
      finishDate: body.querySelector('#ef-finish').value || null,
      staffGivesKey: body.querySelector('#ef-staff').value,
      notes: body.querySelector('#ef-notes').value,
    };

    if (!patch.startDate) return Toast.error(t('err_start_required'));
    if (!patch.motorId) return Toast.error(t('err_vehicle_required'));

    try {
      RentalManager.editRental(rentalId, patch);
      Toast.success(t('toast_rental_updated'));
      if (afterSave) { Modal.close(); setTimeout(() => afterSave(rentalId), 50); }
      else { Modal.close(); window.dispatchEvent(new CustomEvent('route:refresh')); }
    } catch (e) {
      Toast.error(e.message);
    }
  });
}

// ---------- Passport input modal (R9) ----------
function openTextInputModal({ title, label, placeholder = '', confirmText = 'Simpan' }) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="field">
        <label class="field__label">${escapeHTML(label)}</label>
        <textarea id="ti-input" class="textarea" rows="3" placeholder="${escapeHTML(placeholder)}"></textarea>
      </div>
    `;
    const footer = document.createElement('div');
    footer.innerHTML = `
      <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
      <button class="btn" id="ti-confirm">${escapeHTML(confirmText)}</button>
    `;
    Modal.open({ title, body, footer, onClose: () => resolve(null) });
    document.getElementById('ti-confirm').addEventListener('click', () => {
      const val = body.querySelector('#ti-input').value.trim();
      if (!val) return Toast.error(t('err_field_required'));
      resolve(val);
      Modal.close();
    });
  });
}

function openPassportInputModal(currentPassport = '', guestName = '') {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="stack" style="gap:12px">
        <div style="font-size:13px;color:var(--text-secondary)">
          ${t('passport_modal_text', { name: escapeHTML(guestName) })}
        </div>
        <div class="field">
          <label class="field__label required" for="pp-no">${t('passport_modal_label')}</label>
          <input id="pp-no" class="input" placeholder="${t('form_passport_hold_placeholder')}" value="${escapeHTML(currentPassport)}" required />
          <span class="field__hint">${t('passport_modal_hint')}</span>
        </div>
      </div>
    `;
    const footer = document.createElement('div');
    footer.innerHTML = `
      <button class="btn btn--ghost" id="pp-cancel">${t('btn_cancel')}</button>
      <button class="btn" id="pp-confirm">${t('passport_modal_confirm')}</button>
    `;
    Modal.open({ title: t('modal_hold_passport'), body, footer });
    setTimeout(() => body.querySelector('#pp-no').focus(), 50);

    document.getElementById('pp-confirm').addEventListener('click', () => {
      const val = body.querySelector('#pp-no').value.trim();
      if (!val) { Toast.error(t('err_passport_required')); return; }
      Modal.close();
      resolve(val);
    });
    document.getElementById('pp-cancel').addEventListener('click', () => {
      Modal.close();
      resolve(null);
    });
  });
}

// ---------- Payment method picker (R8) ----------
function openPaymentMethodPicker(currentMethod = '') {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    const methods = ['Cash Box', 'Credit Card', 'Transfer', 'QRIS'];
    body.innerHTML = `
      <div class="stack" style="gap:10px">
        <div style="font-size:13px;color:var(--text-secondary)">${t('form_payment_pick_method')}</div>
        <div class="field">
          <select id="pm-pick" class="select">
            <option value="">${t('form_payment_pick_placeholder')}</option>
            ${methods.map(m => `<option ${currentMethod === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>
    `;
    const footer = document.createElement('div');
    footer.innerHTML = `
      <button class="btn btn--ghost" id="pm-cancel">${t('btn_cancel')}</button>
      <button class="btn" id="pm-confirm">${t('form_payment_confirm')}</button>
    `;
    Modal.open({ title: t('modal_mark_paid'), body, footer });

    document.getElementById('pm-confirm').addEventListener('click', () => {
      const val = body.querySelector('#pm-pick').value;
      if (!val) {
        Toast.error(t('err_payment_method'));
        return;
      }
      Modal.close();
      resolve(val);
    });
    document.getElementById('pm-cancel').addEventListener('click', () => {
      Modal.close();
      resolve(null);
    });
  });
}

// ---------- MOTOR FORM ----------
export function openMotorForm(motorId = null) {
  const m = motorId ? MotorManager.get(motorId) : null;
  const owners = OwnerManager.list();
  // Surfrack in edit mode: use the existing value. In create mode: not yet chosen (null).
  const initialSurfrack = m ? (m.hasSurfrack ? 'true' : 'false') : '';

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <div class="field">
        <label class="field__label required" for="m-plate">${t('form_motor_plate')}</label>
        <input id="m-plate" class="input" placeholder="${t('form_motor_plate_placeholder')}" value="${escapeHTML(m?.plate || '')}" required />
        <span class="field__hint">${t('form_motor_plate_hint')}</span>
      </div>
      <div class="field">
        <label class="field__label required" for="m-desc">${t('form_motor_desc')}</label>
        <input id="m-desc" class="input" placeholder="${t('form_motor_desc_placeholder')}" value="${escapeHTML(m?.description || '')}" required />
      </div>
      <div class="field-group">
        <div class="field">
          <label class="field__label" for="m-cc">${t('form_motor_cc')}</label>
          <select id="m-cc" class="select">
            <option ${m?.cc === '110 - 125' ? 'selected' : ''}>110 - 125</option>
            <option ${m?.cc === '150' ? 'selected' : ''}>150</option>
            <option ${m?.cc === '155' ? 'selected' : ''}>155</option>
            <option ${m?.cc === '160' ? 'selected' : ''}>160</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="m-price">${t('form_motor_price')}</label>
          <input id="m-price" class="input" type="number" step="5000" value="${m?.pricePerDay || 70000}" />
        </div>
      </div>
      <div class="field-group">
        <div class="field">
          <label class="field__label" for="m-owner">${t('form_motor_owner_label')}</label>
          <select id="m-owner" class="select">
            <option value="">${t('btn_select') || 'Select'} ${t('nav_owners').toLowerCase()}...</option>
            ${owners.map(o => `<option value="${o.id}" ${m?.ownerId === o.id ? 'selected' : ''}>${escapeHTML(o.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="m-cat">${t('form_motor_category')}</label>
          <select id="m-cat" class="select">
            <option value="A" ${m?.category === 'A' ? 'selected' : ''}>${t('form_motor_cat_a')}</option>
            <option value="B" ${m?.category === 'B' ? 'selected' : ''}>${t('form_motor_cat_b')}</option>
            <option value="C" ${m?.category === 'C' ? 'selected' : ''}>${t('form_motor_cat_c')}</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label class="field__label required" for="m-pto">${t('form_motor_pto')}</label>
        <input id="m-pto" class="input" type="number" step="5000" value="${m?.payToOwnerPerDay ?? Math.round((m?.pricePerDay || 70000) * 0.71)}" required />
        <span class="field__hint">${t('form_motor_pto_hint')}</span>
      </div>
      <div class="field">
        <label class="field__label required" for="m-surfrack">${t('form_motor_surfrack')} <span style="color:var(--danger)">*</span></label>
        <select id="m-surfrack" class="select" required>
          <option value="" ${initialSurfrack === '' ? 'selected' : ''} disabled>${t('form_motor_select_surfrack')}</option>
          <option value="false" ${initialSurfrack === 'false' ? 'selected' : ''}>${t('form_motor_surfrack_no')}</option>
          <option value="true"  ${initialSurfrack === 'true'  ? 'selected' : ''}>${t('form_motor_surfrack_yes')}</option>
        </select>
        <span class="field__hint">${t('form_motor_surfrack_hint')}</span>
      </div>
      <div class="field">
        <label class="field__label">${t('form_motor_accessories')}</label>
        <div class="row" style="gap:16px;flex-wrap:wrap;padding:8px 0">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="m-ph" ${m?.phoneHolder ? 'checked' : ''} />
            <span>📱 Phone Holder</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="m-gps" ${m?.gps ? 'checked' : ''} />
            <span>📍 GPS</span>
          </label>
        </div>
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
    ${m ? `<button class="btn btn--danger" id="btn-delete-motor">${t('btn_delete')}</button>` : ''}
    <button class="btn" id="btn-save-motor">${t('btn_save')}</button>
  `;

  Modal.open({ title: m ? t('modal_edit_motor') : t('modal_add_motor'), body, footer });

  // Attach the thousand separator to the motor price inputs
  const getPriceValue = attachNumericInput(body.querySelector('#m-price'), { placeholder: '70000' });
  const getPtoValue   = attachNumericInput(body.querySelector('#m-pto'),   { placeholder: '50000' });

  document.getElementById('btn-save-motor').addEventListener('click', () => {
    const surfrackVal = body.querySelector('#m-surfrack').value;
    if (surfrackVal !== 'true' && surfrackVal !== 'false') {
      return Toast.error(t('err_surfrack_required'));
    }
    const plate = body.querySelector('#m-plate').value.trim();
    const description = body.querySelector('#m-desc').value.trim();
    if (!plate || !description) return Toast.error(t('err_plate_desc_required'));

    const ownerId = body.querySelector('#m-owner').value || null;
    const owner = ownerId ? OwnerManager.get(ownerId) : null;

    const data = {
      plate,
      description,
      cc: body.querySelector('#m-cc').value,
      pricePerDay: getPriceValue() || 70000,
      payToOwnerPerDay: getPtoValue() || 0,
      ownerId,
      ownerName: owner?.name || '',
      category: body.querySelector('#m-cat').value,
      hasSurfrack: surfrackVal === 'true',
      phoneHolder: body.querySelector('#m-ph').checked,
      gps: body.querySelector('#m-gps').checked,
    };

    try {
      if (m) {
        MotorManager.update(m.id, data);
        Toast.success(t('toast_motor_updated'));
      } else {
        MotorManager.create(data);
        Toast.success(t('toast_motor_added'));
      }
      Modal.close();
      window.dispatchEvent(new CustomEvent('route:refresh'));
    } catch (e) {
      Toast.error(e.message);
    }
  });

  if (m) {
    document.getElementById('btn-delete-motor').addEventListener('click', async () => {
      const ok = await Modal.confirm({
        title: t('confirm_delete_motor_title'),
        message: t('confirm_delete_motor_msg', { plate: m.plate }),
        variant: 'danger',
        confirmText: t('btn_delete'),
      });
      if (ok) {
        MotorManager.remove(m.id);
        Modal.close();
        Toast.success(t('toast_motor_deleted'));
        window.dispatchEvent(new CustomEvent('route:refresh'));
      }
    });
  }
}

// ---------- OWNER FORM ----------
export function openOwnerForm(ownerId = null) {
  const o = ownerId ? OwnerManager.get(ownerId) : null;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <div class="field">
        <label class="field__label required" for="o-name">${t('form_owner_name')}</label>
        <input id="o-name" class="input" value="${escapeHTML(o?.name || '')}" required />
      </div>
      <div class="field-group">
        <div class="field">
          <label class="field__label" for="o-phone">${t('form_owner_phone')}</label>
          <input id="o-phone" class="input" type="tel" value="${escapeHTML(o?.phone || '')}" />
        </div>
        <div class="field">
          <label class="field__label" for="o-type">${t('form_owner_type')}</label>
          <select id="o-type" class="select">
            <option value="property" ${o?.type === 'property' ? 'selected' : ''}>${t('form_motor_cat_a')}</option>
            <option value="staff" ${o?.type === 'staff' ? 'selected' : ''}>${t('form_motor_cat_b')}</option>
            <option value="partner" ${o?.type === 'partner' ? 'selected' : ''}>${t('form_motor_cat_c')}</option>
          </select>
        </div>
      </div>
      <div class="card" style="background:var(--bg-subtle);padding:10px;font-size:12px;color:var(--text-secondary)">
        ${t('form_owner_pto_info')}
      </div>
      <div class="field">
        <label class="field__label" for="o-notes">${t('form_owner_notes')}</label>
        <textarea id="o-notes" class="textarea">${escapeHTML(o?.notes || '')}</textarea>
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
    ${o ? `<button class="btn btn--danger" id="btn-del-owner">${t('btn_delete')}</button>` : ''}
    <button class="btn" id="btn-save-owner">${t('btn_save')}</button>
  `;

  Modal.open({ title: o ? t('modal_edit_owner') : t('modal_add_owner'), body, footer });

  document.getElementById('btn-save-owner').addEventListener('click', () => {
    const data = {
      name: body.querySelector('#o-name').value,
      phone: body.querySelector('#o-phone').value,
      type: body.querySelector('#o-type').value,
      notes: body.querySelector('#o-notes').value,
    };
    if (!data.name) return Toast.error(t('err_owner_name_required'));
    if (o) OwnerManager.update(o.id, data);
    else OwnerManager.create(data);
    Modal.close();
    Toast.success(o ? t('toast_owner_updated') : t('toast_owner_added'));
    window.dispatchEvent(new CustomEvent('route:refresh'));
  });

  if (o) {
    document.getElementById('btn-del-owner').addEventListener('click', async () => {
      const ok = await Modal.confirm({
        title: t('confirm_delete_owner_title'),
        message: t('confirm_delete_owner_msg', { name: o.name }),
        variant: 'danger',
        confirmText: t('btn_delete'),
      });
      if (ok) {
        OwnerManager.remove(o.id);
        Modal.close();
        Toast.success(t('toast_owner_deleted'));
        window.dispatchEvent(new CustomEvent('route:refresh'));
      }
    });
  }
}

// ---------- MARK AS PAID FORM ----------
export function openMarkPaidForm(rentalId, afterSave = null) {
  const r = RentalManager.get(rentalId);
  if (!r) return Toast.error(t('err_rental_not_found'));

  const grandTotal = getRentalGrandTotal(r);

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <!-- System reference -->
      <div class="card" style="background:var(--bg-subtle);padding:12px">
        <div class="row row--between" style="font-size:13px">
          <span class="muted">${t('detail_rental_cost')}</span>
          <span>${formatIDR(r.totalCost)}</span>
        </div>
        ${r.newDamage ? `
          <div class="row row--between" style="font-size:13px;margin-top:4px">
            <span class="muted">${t('detail_damage_compensation')}</span>
            <span style="color:var(--danger)">+ ${formatIDR(r.damageCharge)}</span>
          </div>
        ` : ''}
        <div class="row row--between" style="font-size:14px;font-weight:800;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
          <span>${t('form_payment_system_total')}</span>
          <span style="color:var(--brand)">${formatIDR(grandTotal)}</span>
        </div>
      </div>

      <!-- Actual input -->
      <div class="field">
        <label class="field__label required" for="mp-amount">${t('form_payment_amount')}</label>
        <input id="mp-amount" class="input" value="${grandTotal}" />
        <span class="field__hint">${t('form_payment_amount_hint')}</span>
      </div>

      <div class="field">
        <label class="field__label required" for="mp-method">${t('detail_payment_method')}</label>
        <select id="mp-method" class="select">
          ${['Cash Box', 'Credit Card', 'Transfer', 'QRIS'].map(m =>
            `<option value="${m}" ${r.paymentMethod === m ? 'selected' : ''}>${m}</option>`
          ).join('')}
        </select>
      </div>

      <!-- Reason — shown when the amount differs (via JS) -->
      <div class="field" id="mp-reason-wrap" style="display:none">
        <label class="field__label required" for="mp-reason">${t('form_payment_adjustment_label')}</label>
        <textarea id="mp-reason" class="textarea" rows="2"
          placeholder="${t('form_payment_adjustment_placeholder')}"></textarea>
        <span class="field__hint" id="mp-diff-label" style="color:var(--warning,#d97706)"></span>
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
    <button class="btn" id="btn-confirm-paid">${t('btn_save')}</button>
  `;

  Modal.open({ title: t('modal_mark_paid'), body, footer });

  const getAmount = attachNumericInput(body.querySelector('#mp-amount'), { placeholder: '0' });

  // Live: show the reason field when the amount differs
  body.querySelector('#mp-amount').addEventListener('input', () => {
    const received = getAmount();
    const diff = received - grandTotal;
    const wrap = body.querySelector('#mp-reason-wrap');
    const label = body.querySelector('#mp-diff-label');
    if (diff !== 0) {
      wrap.style.display = '';
      const diffStr = `${diff > 0 ? '+' : ''}${diff.toLocaleString('id-ID')}`;
      label.textContent = t('form_payment_diff', { diff: diffStr });
    } else {
      wrap.style.display = 'none';
    }
  });

  document.getElementById('btn-confirm-paid').addEventListener('click', () => {
    const amountReceived  = getAmount();
    const paymentMethod   = body.querySelector('#mp-method').value;
    const adjustmentReason = body.querySelector('#mp-reason').value.trim();
    try {
      RentalManager.markPaid(r.id, { paymentMethod, amountReceived, adjustmentReason });
      const diff = amountReceived - grandTotal;
      const suffix = diff !== 0 ? t('toast_payment_diff_suffix', { diff: `${diff > 0 ? '+' : ''}${formatIDR(Math.abs(diff))}` }) : '';
      Toast.success(t('toast_payment_recorded', { amount: formatIDR(amountReceived), method: paymentMethod, suffix }));
      if (afterSave) { Modal.close(); setTimeout(() => afterSave(rentalId), 50); }
      else { Modal.close(); window.dispatchEvent(new CustomEvent('route:refresh')); }
    } catch (e) { Toast.error(e.message); }
  });
}

// ---------- ADMIN CORRECTION (fullyDone, same day) ----------
export function openAdminCorrectForm(rentalId, afterSave = null) {
  const r = RentalManager.get(rentalId);
  if (!r) return Toast.error(t('err_rental_not_found'));

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <div class="card" style="background:var(--warning-soft,#fff3cd);border-color:transparent;padding:10px;font-size:12px;color:var(--warning,#856404)">
        ${t('page_admin_correct_warning')}
      </div>

      ${r.newDamage ? `
        <div class="field">
          <label class="field__label" for="ac-damage">${t('form_admin_damage_charge')}</label>
          <input id="ac-damage" class="input" value="${r.damageCharge || 0}" />
          <span class="field__hint">${t('form_admin_current_value', { value: formatIDR(r.damageCharge) })}</span>
        </div>
      ` : ''}

      <div class="field">
        <label class="field__label" for="ac-method">${t('detail_payment_method')}</label>
        <select id="ac-method" class="select">
          ${['Cash Box', 'Credit Card', 'Transfer', 'QRIS'].map(m =>
            `<option value="${m}" ${r.paymentMethod === m ? 'selected' : ''}>${m}</option>`
          ).join('')}
        </select>
        <span class="field__hint">${t('form_admin_current_value', { value: escapeHTML(r.paymentMethod || '—') })}</span>
      </div>

      <div class="field">
        <label class="field__label" for="ac-notes">${t('form_owner_notes')}</label>
        <textarea id="ac-notes" class="textarea" placeholder="${t('form_admin_notes_placeholder')}">${escapeHTML(r.notes || '')}</textarea>
      </div>

      <div class="card" style="background:var(--bg-subtle);padding:10px;font-size:11px;color:var(--text-secondary)">
        ${t('page_immutable_info')}
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
    <button class="btn" id="btn-save-admin-correct">${t('btn_save_correction')}</button>
  `;

  Modal.open({ title: t('modal_admin_correct'), body, footer });

  const getDamageCharge = r.newDamage
    ? attachNumericInput(body.querySelector('#ac-damage'), { placeholder: '0' })
    : null;

  document.getElementById('btn-save-admin-correct').addEventListener('click', () => {
    try {
      RentalManager.adminCorrect(rentalId, {
        ...(r.newDamage ? { damageCharge: getDamageCharge() } : {}),
        paymentMethod: body.querySelector('#ac-method').value,
        notes: body.querySelector('#ac-notes').value.trim(),
      });
      Toast.success(t('toast_admin_correct_saved'));
      if (afterSave) { Modal.close(); setTimeout(() => afterSave(rentalId), 50); }
      else { Modal.close(); window.dispatchEvent(new CustomEvent('route:refresh')); }
    } catch (e) { Toast.error(e.message); }
  });
}

// ---------- EDIT DAMAGE (returned, not yet resolved, not yet paid) ----------
export function openEditDamageForm(rentalId, afterSave = null) {
  const r = RentalManager.get(rentalId);
  if (!r) return Toast.error(t('err_not_found'));

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="gap:14px">
      <div class="card" style="background:var(--bg-subtle);padding:10px;font-size:12px;color:var(--text-secondary)">
        ${t('damage_edit_info')}
      </div>
      <div class="field">
        <label class="field__label required" for="ed-desc">${t('detail_damage_desc')}</label>
        <textarea id="ed-desc" class="textarea" placeholder="${t('form_damage_desc_placeholder')}">${escapeHTML(r.damageDescription || '')}</textarea>
      </div>
      <div class="field">
        <label class="field__label required" for="ed-charge">${t('detail_damage_charge')}</label>
        <input id="ed-charge" class="input" value="${r.damageCharge || 0}" />
        <span class="field__hint">${t('form_damage_charge_hint')}</span>
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn--ghost" data-close>${t('btn_cancel')}</button>
    <button class="btn" id="btn-save-damage-edit">${t('btn_save')}</button>
  `;

  Modal.open({ title: t('modal_edit_damage'), body, footer });

  const getCharge = attachNumericInput(body.querySelector('#ed-charge'), { placeholder: '0' });

  document.getElementById('btn-save-damage-edit').addEventListener('click', () => {
    const desc = body.querySelector('#ed-desc').value.trim();
    if (!desc) return Toast.error(t('err_damage_desc_required'));
    try {
      RentalManager.editDamage(rentalId, {
        damageDescription: desc,
        damageCharge: getCharge(),
      });
      Toast.success(t('toast_damage_edited'));
      if (afterSave) { Modal.close(); setTimeout(() => afterSave(rentalId), 50); }
      else { Modal.close(); window.dispatchEvent(new CustomEvent('route:refresh')); }
    } catch (e) { Toast.error(e.message); }
  });
}
