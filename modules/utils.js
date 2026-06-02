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
