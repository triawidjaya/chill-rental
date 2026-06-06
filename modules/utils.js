// =============================================================
// modules/utils.js
// Helper functions: format, date, currency, ID generation
// =============================================================

export const formatIDR = (n) => {
  if (n == null || n === '' || isNaN(n)) return 'Rp 0';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
};

export const formatNumber = (n) => {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('id-ID');
};

export const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

export const toISODateTime = (date) => {
  const d = date ? new Date(date) : new Date();
  // Local datetime-local format
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const daysBetween = (startISO, endISO) => {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (isNaN(s) || isNaN(e)) return 0;
  const ms = e - s;
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return Math.max(days, 1);
};

/**
 * Compute total rental days using the 11:00 AM cut-off rule:
 * - Days are counted per CALENDAR DATE (not per 24 hours)
 * - Cut-off at 11:00 AM:
 *     - Returned before 11:00 → return date is NOT counted
 *     - Returned at/after 11:00 → return date IS counted
 * - Minimum 1 day
 *
 * @param {string} startISO - ISO datetime when the rental starts
 * @param {string} endISO   - ISO datetime when actually returned/finished
 * @param {number} cutoffHour - Default 11 (11:00 AM)
 * @returns {number} number of days to charge
 */
export const calcRentalDays = (startISO, endISO, cutoffHour = 11) => {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (isNaN(s) || isNaN(e)) return 0;

  // Calendar-date difference (ignoring the time component)
  const sDate = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const eDate = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  const dayDiff = Math.round((eDate - sDate) / 86400000);

  // Return time before cut-off → return date is not counted
  const beforeCutoff = e.getHours() < cutoffHour;
  const days = dayDiff + (beforeCutoff ? 0 : 1);
  return Math.max(days, 1);
};

/**
 * Dashboard reminder helper: check whether an active rental
 * has passed today's cut-off (ready for an extra day charge).
 */
export const isPastCutoffToday = (cutoffHour = 11) => {
  const now = new Date();
  return now.getHours() >= cutoffHour;
};

/**
 * Whether "now" is still within the post-cut-off grace window (default: 30 min
 * after the cut-off). Lets staff fine-tune the check-out time right around the
 * cut-off without an admin override; past it, the time is locked for non-admins.
 */
export const isWithinCheckoutGrace = (cutoffHour = 11, graceMinutes = 30) => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() < cutoffHour * 60 + graceMinutes;
};

/** True when two Date objects fall on the same local calendar day. */
export const isSameLocalDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Helper: check whether the estimated finishDate has already passed
 */
export const isEstimateExpired = (estimateISO) => {
  if (!estimateISO) return false;
  return new Date(estimateISO) < new Date();
};

/**
 * Attach a live thousand-separator to an input element.
 * Switches type="number" to type="text" with automatic formatting.
 * Returns a getter function to read the numeric value.
 *
 * Usage:
 *   const getCharge = attachNumericInput(document.getElementById('co-charge'));
 *   const value = getCharge(); // => 1500000
 */
export const attachNumericInput = (el, { placeholder = '0' } = {}) => {
  el.type = 'text';
  el.setAttribute('inputmode', 'numeric');
  el.placeholder = placeholder;

  const getRaw = () => Number(el.value.replace(/\D/g, '')) || 0;

  const applyFormat = () => {
    const n = getRaw();
    el.value = n === 0 ? '' : n.toLocaleString('id-ID');
  };

  // Format the initial value
  applyFormat();

  el.addEventListener('input', () => {
    const raw = el.value.replace(/\D/g, '');
    if (!raw) { el.value = ''; return; }
    el.value = Number(raw).toLocaleString('id-ID');
  });

  return getRaw;
};

/**
 * Wire a live-search <input> so typing filters results without losing the cursor.
 *
 * These pages re-render the whole #content on each change, which destroys and
 * recreates the input — so the browser drops focus after every keystroke. This
 * helper debounces the change, then re-focuses the freshly-rendered input (found
 * again by its id) and restores the caret position.
 *
 * @param {HTMLInputElement} inputEl  the current search input (must have an id)
 * @param {(value:string)=>void} onValue  update page state + trigger the rerender
 * @param {{delay?:number}} [opts]
 */
export const bindSearchInput = (inputEl, onValue, { delay = 200 } = {}) => {
  if (!inputEl) return;
  const id = inputEl.id;
  let timer;
  inputEl.addEventListener('input', (e) => {
    const value = e.target.value;
    const caret = e.target.selectionStart;
    clearTimeout(timer);
    timer = setTimeout(() => {
      onValue(value); // page sets its state and re-renders #content (new input node)
      const next = id && document.getElementById(id);
      if (next) {
        next.focus();
        const pos = caret == null ? next.value.length : caret;
        try { next.setSelectionRange(pos, pos); } catch (_) { /* type may not support it */ }
      }
    }, delay);
  });
};

export const uid = (prefix = 'id') => {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
};

export const escapeHTML = (str) => {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const groupBy = (arr, key) => {
  return arr.reduce((acc, item) => {
    const k = typeof key === 'function' ? key(item) : item[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
};

export const sumBy = (arr, key) => {
  return arr.reduce((acc, item) => acc + (Number(typeof key === 'function' ? key(item) : item[key]) || 0), 0);
};

// CSV export
export const toCSV = (rows, columns) => {
  const header = columns.map(c => `"${c.label}"`).join(',');
  const body = rows.map(row =>
    columns.map(c => {
      const val = typeof c.value === 'function' ? c.value(row) : row[c.value];
      const s = val == null ? '' : String(val);
      return `"${s.replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
  return header + '\n' + body;
};

// =============================================================
// WhatsApp & clipboard helpers (for plain-text receipts)
// =============================================================

/**
 * Normalize a phone number into the digits-only international form wa.me wants.
 *   "08123456789"        -> "628123456789"
 *   "+62 812-3456-789"   -> "628123456789"
 *   "812..." (bare)      -> "62812..."
 * A leading 0 becomes 62; a bare 8xxxx gets 62 prepended; anything already
 * starting with a country code (62, 61, 1, ...) is kept as-is.
 */
export const normalizeWa = (num) => {
  const digits = String(num || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('8')) return '62' + digits;
  return digits;
};

/**
 * Build a wa.me deep link that opens WhatsApp with the message pre-filled.
 * Returns '' when there is no usable number.
 */
export const waLink = (num, text) => {
  const n = normalizeWa(num);
  if (!n) return '';
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
};

/**
 * Copy text to the clipboard. Uses the async Clipboard API when available
 * (secure context) and falls back to a hidden textarea + execCommand for
 * older browsers / non-secure origins (e.g. plain http://localhost setups).
 * Returns true on success.
 */
export const copyText = async (text) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through to legacy path */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
};

export const downloadFile = (content, filename, mime = 'text/csv') => {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
