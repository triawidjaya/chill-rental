// =============================================================
// pages/booking.js
// Staff "Booking Queue" — review online bookings submitted by guests.
//   list + status filters → review modal → confirm / reject / send WA.
// Physical check-in conversion (confirmed → rental) is wired in Fase 5.
// =============================================================

import { BookingManager, BookingStatus, bookingLabel } from '../modules/booking.js';
import { formatIDR, formatDate, escapeHTML } from '../modules/utils.js';
import { t } from '../modules/i18n.js';
import { Modal, Toast } from '../modules/ui/notify.js';
import { showReceiptModal } from '../modules/ui/receipt-modal.js';
import { buildBookingConfirm } from '../modules/receipts.js';
import { openRentalForm } from '../modules/ui/forms.js';

let bkFilter = BookingStatus.PENDING; // pending | confirmed | rejected | checked_in | all

const STATUS_META = {
  pending:    { cls: 'badge--warning', key: 'booking_status_pending' },
  confirmed:  { cls: 'badge--success', key: 'booking_status_confirmed' },
  rejected:   { cls: 'badge--danger',  key: 'booking_status_rejected' },
  cancelled:  { cls: 'badge--danger',  key: 'booking_status_cancelled' },
  checked_in: { cls: 'badge--info',    key: 'booking_status_checked_in' },
  expired:    { cls: 'badge',          key: 'booking_status_expired' },
};

export function renderBookingBadge(b) {
  const m = STATUS_META[b?.status] || STATUS_META.pending;
  return `<span class="badge ${m.cls}">${t(m.key)}</span>`;
}

const FILTERS = [
  { key: 'pending',    labelKey: 'booking_status_pending' },
  { key: 'confirmed',  labelKey: 'booking_status_confirmed' },
  { key: 'rejected',   labelKey: 'booking_status_rejected' },
  { key: 'cancelled',  labelKey: 'booking_status_cancelled' },
  { key: 'checked_in', labelKey: 'booking_status_checked_in' },
  { key: 'all',        labelKey: 'booking_filter_all' },
];

function bookingCard(b) {
  const dates = b.startDate
    ? `${formatDate(b.startDate)}${b.finishDate ? ' → ' + formatDate(b.finishDate) : ''}`
    : '—';
  return `
    <button class="card booking-card" data-action="open-booking" data-id="${escapeHTML(b.id)}"
            style="text-align:left;width:100%;border:1px solid var(--border-subtle);padding:14px;margin-bottom:10px;background:var(--bg-elev);cursor:pointer">
      <div class="row row--between" style="align-items:flex-start">
        <div>
          <div style="font-family:var(--font-display);font-weight:800;font-size:16px">${escapeHTML(b.guestName || '—')}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">${escapeHTML(b.ccClass || '—')} cc · ${b.surfrack ? '🏄 rack' : 'no rack'} · ${b.quotedPricePerDay ? formatIDR(b.quotedPricePerDay) + '/day' : '—'}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">📅 ${dates}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--font-mono);font-weight:700;letter-spacing:.08em;font-size:15px">${escapeHTML(b.code || '—')}</div>
          <div style="margin-top:6px">${renderBookingBadge(b)}</div>
        </div>
      </div>
    </button>`;
}

export function renderBooking() {
  const counts = {};
  FILTERS.forEach(f => { counts[f.key] = BookingManager.byStatus(f.key).length; });

  let list = BookingManager.byStatus(bkFilter);
  list = [...list].sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));

  const filterBtns = FILTERS.map(f => `
    <button class="btn btn--ghost btn--sm ${bkFilter === f.key ? 'is-active' : ''}" data-bkfilter="${f.key}"
            style="${bkFilter === f.key ? 'background:var(--brand);color:var(--text-on-brand);border-color:var(--brand)' : ''}">
      ${t(f.labelKey)}${counts[f.key] ? ` (${counts[f.key]})` : ''}
    </button>`).join('');

  const empty = `
    <div class="card" style="padding:32px;text-align:center;background:var(--bg-subtle)">
      <div style="font-size:32px">📭</div>
      <p class="muted" style="margin-top:8px">${t('booking_empty') || 'No bookings in this view.'}</p>
    </div>`;

  return `
    <div class="page__header">
      <div>
        <h1 class="page__title">${t('nav_bookings') || 'Bookings'}</h1>
        <p class="page__lede">${t('booking_lede') || 'Review online booking requests from guests.'}</p>
      </div>
    </div>

    <div class="toolbar toolbar--stacked">
      <div class="filter-row" id="bk-filters" style="flex-wrap:wrap;gap:8px">${filterBtns}</div>
    </div>

    <div id="bk-list">
      ${list.length ? list.map(bookingCard).join('') : empty}
    </div>`;
}

export function setupBookingPage(rerender) {
  document.querySelectorAll('#bk-filters [data-bkfilter]').forEach(btn => {
    btn.addEventListener('click', () => {
      bkFilter = btn.dataset.bkfilter;
      rerender();
    });
  });
}

// ---------- Review modal ----------
export function openBookingDetail(id) {
  const b = BookingManager.get(id);
  if (!b) return Toast.error(t('err_not_found') || 'Not found');

  const refresh = () => { Modal.close(); setTimeout(() => openBookingDetail(id), 50); };

  const dupes = BookingManager.matchesByWa(b.wa, b.id);
  const dupWarning = dupes.length ? `
    <div class="card" style="background:var(--warning-soft);padding:10px;font-size:12px">
      ⚠ ${t('booking_dup_warn') || 'This WhatsApp number appears on other bookings'}:
      ${dupes.map(d => `<strong>${escapeHTML(d.code || '—')}</strong> (${escapeHTML(d.status)})`).join(', ')}
    </div>` : '';

  const dates = b.startDate
    ? `${formatDate(b.startDate)}${b.finishDate ? ' → ' + formatDate(b.finishDate) : ''}`
    : '—';

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack" style="display:flex;flex-direction:column;gap:12px">
      <div class="card" style="background:var(--bg-subtle);padding:14px">
        <div class="row row--between" style="align-items:flex-start">
          <div style="font-family:var(--font-display);font-weight:800;font-size:20px">${escapeHTML(b.guestName || '—')}</div>
          <div style="font-family:var(--font-mono);font-weight:700;letter-spacing:.08em">${escapeHTML(b.code || '—')}</div>
        </div>
        <div style="margin-top:8px">${renderBookingBadge(b)}</div>
      </div>

      ${dupWarning}

      <div class="card" style="background:var(--bg-subtle);padding:12px;font-size:13px">
        ${b.wa ? `<div>📱 WA: <strong>${escapeHTML(b.wa)}</strong></div>` : ''}
        ${b.email ? `<div>✉ Email: <strong>${escapeHTML(b.email)}</strong></div>` : ''}
        ${b.passportNo ? `<div>📘 Passport: <strong>${escapeHTML(b.passportNo)}</strong></div>` : ''}
      </div>

      <div class="card" style="background:var(--bg-subtle);padding:12px;font-size:13px">
        <div class="row row--between"><span class="muted">Bike</span><strong>${escapeHTML(b.ccClass || '—')} cc</strong></div>
        <div class="row row--between" style="margin-top:4px"><span class="muted">Surfboard rack</span><strong>${b.surfrack ? 'Yes' : 'No'}</strong></div>
        <div class="row row--between" style="margin-top:4px"><span class="muted">Est. price</span><strong>${b.quotedPricePerDay ? formatIDR(b.quotedPricePerDay) + '/day' : '—'}</strong></div>
        <div class="row row--between" style="margin-top:4px"><span class="muted">Dates</span><strong>${dates}</strong></div>
      </div>

      <div class="card" style="background:var(--bg-subtle);padding:10px;font-size:11.5px;color:var(--text-secondary)">
        Agreed to T&C <strong>${escapeHTML(b.agreedTermsVersion || '—')}</strong>${b.agreedAt ? ' · ' + formatDate(b.agreedAt) : ''}
        ${b.rejectionReason ? `<div style="margin-top:6px;color:var(--danger)">Rejected: ${escapeHTML(b.rejectionReason)}</div>` : ''}
        ${b.cancellationReason ? `<div style="margin-top:6px;color:var(--danger)">Cancelled: ${escapeHTML(b.cancellationReason)}</div>` : ''}
        ${b.rentalId ? `<div style="margin-top:6px">Linked rental: <strong>${escapeHTML(b.rentalId)}</strong></div>` : ''}
      </div>
    </div>`;

  const footer = document.createElement('div');
  if (b.status === BookingStatus.PENDING) {
    const btnReject = document.createElement('button');
    btnReject.className = 'btn btn--ghost';
    btnReject.textContent = '✕ ' + t('booking_reject');
    btnReject.onclick = () => openReasonDialog({
      title: t('booking_reject'),
      placeholder: t('booking_reject_ph'),
      onConfirm: (reason) => {
        try {
          BookingManager.reject(id, reason);
          Toast.success(t('booking_rejected_toast'));
          Modal.close();
          refresh();
        } catch (e) { Toast.error(e.message); }
      },
    });

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'btn';
    btnConfirm.textContent = '✓ ' + (t('booking_confirm') || 'Confirm');
    btnConfirm.onclick = () => {
      try {
        BookingManager.confirm(id);
        Toast.success(t('booking_confirmed_toast') || 'Booking confirmed');
        refresh();
      } catch (e) { Toast.error(e.message); }
    };
    footer.appendChild(btnReject);
    footer.appendChild(btnConfirm);
  } else if (b.status === BookingStatus.CONFIRMED) {
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn--ghost';
    btnCancel.textContent = '✕ ' + t('booking_cancel');
    btnCancel.onclick = () => openReasonDialog({
      title: t('booking_cancel'),
      placeholder: t('booking_cancel_ph'),
      onConfirm: (reason) => {
        try {
          BookingManager.cancel(id, reason);
          Toast.success(t('booking_cancelled_toast'));
          Modal.close();
          refresh();
        } catch (e) { Toast.error(e.message); }
      },
    });

    const btnWa = document.createElement('button');
    btnWa.className = 'btn btn--ghost';
    btnWa.textContent = '🟢 ' + (t('booking_send_wa') || 'Send WhatsApp confirmation');
    btnWa.onclick = () => {
      showReceiptModal({
        title: (t('booking_send_wa') || 'WhatsApp · Booking'),
        subtitle: bookingLabel(b),
        text: buildBookingConfirm(b),
        waNumber: b.wa || '',
      });
    };

    const btnCheckin = document.createElement('button');
    btnCheckin.className = 'btn';
    btnCheckin.textContent = '🏍️ ' + (t('booking_checkin_now') || 'Check-in now');
    btnCheckin.onclick = () => {
      Modal.close();
      openRentalForm({
        bookingId: b.id, bookingCode: b.code,
        guestName: b.guestName, wa: b.wa, email: b.email, passportNo: b.passportNo,
        finishDate: b.finishDate, ccClass: b.ccClass, surfrack: b.surfrack,
      });
    };

    footer.appendChild(btnCancel);
    footer.appendChild(btnWa);
    footer.appendChild(btnCheckin);
  }

  Modal.open({
    title: t('booking_detail_title') || 'Booking',
    body, footer: footer.childNodes.length ? footer : null,
    size: 'lg',
    closeOnBackdrop: true,
    onClose: () => window.dispatchEvent(new CustomEvent('route:refresh')),
  });
}

// Generic reason-capture dialog, reused for Reject (pending) and Cancel (confirmed).
function openReasonDialog({ title, placeholder = '', onConfirm }) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field">
      <label class="field__label" for="bk-reason">${t('booking_reject_reason')}</label>
      <textarea id="bk-reason" class="textarea" placeholder="${escapeHTML(placeholder)}"></textarea>
    </div>`;
  const footer = document.createElement('div');
  const cancel = document.createElement('button');
  cancel.className = 'btn btn--ghost';
  cancel.textContent = t('btn_cancel');
  cancel.setAttribute('data-close', '');
  const ok = document.createElement('button');
  ok.className = 'btn btn--danger';
  ok.textContent = title;
  ok.onclick = () => onConfirm(body.querySelector('#bk-reason').value);
  footer.appendChild(cancel);
  footer.appendChild(ok);
  Modal.open({ title, body, footer, closeOnBackdrop: true });
}
