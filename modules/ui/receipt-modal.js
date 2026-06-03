// =============================================================
// modules/ui/receipt-modal.js
// Read-only preview of a plain-text WhatsApp receipt, with
// Copy and (when a number is available) Open WhatsApp actions.
// Editing happens in WhatsApp itself, so the preview is not editable.
// =============================================================

import { Modal, Toast } from './notify.js';
import { copyText, waLink } from '../utils.js';
import { t } from '../i18n.js';

/**
 * @param {object} opts
 * @param {string} opts.title    Modal title (e.g. "WhatsApp · Invoice").
 * @param {string} [opts.subtitle] Small line under the title (invoice no · name).
 * @param {string} opts.text     The full receipt string (already fenced).
 * @param {string} [opts.waNumber] Recipient's number; enables the Open WA button.
 * @param {Function} [opts.onClose] Called when the modal is dismissed.
 */
export function showReceiptModal({ title, subtitle = '', text, waNumber = '', onClose }) {
  const link = waNumber ? waLink(waNumber, text) : '';

  // ---- Body (built with DOM nodes so guest data is never injected as HTML) ----
  const body = document.createElement('div');
  body.className = 'receipt-modal';

  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'receipt-modal__sub';
    sub.textContent = subtitle;
    body.appendChild(sub);
  }

  const pre = document.createElement('pre');
  pre.className = 'receipt-modal__preview';
  pre.textContent = text;
  body.appendChild(pre);

  const hint = document.createElement('p');
  hint.className = 'receipt-modal__hint';
  hint.textContent = t('receipt_hint');
  body.appendChild(hint);

  // ---- Footer actions ----
  const footer = document.createElement('div');

  const btnCopy = document.createElement('button');
  // When a WA link exists, Open WA is the primary action and Copy is secondary.
  btnCopy.className = link ? 'btn btn--ghost' : 'btn';
  btnCopy.textContent = '📋 ' + t('receipt_copy');
  btnCopy.addEventListener('click', async () => {
    const ok = await copyText(text);
    if (ok) Toast.success(t('receipt_copied'));
    else Toast.error(t('receipt_copy_failed'));
  });
  footer.appendChild(btnCopy);

  if (link) {
    const btnWa = document.createElement('a');
    btnWa.className = 'btn btn--wa';
    btnWa.href = link;
    btnWa.target = '_blank';
    btnWa.rel = 'noopener';
    btnWa.textContent = '🟢 ' + t('receipt_open_wa');
    btnWa.addEventListener('click', () => Modal.close());
    footer.appendChild(btnWa);
  }

  Modal.open({ title, body, footer, size: 'lg', closeOnBackdrop: true, onClose });
}
