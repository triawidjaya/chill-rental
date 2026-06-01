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

export const formatDateShort = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
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

export const toISODate = (date) => {
  const d = date ? new Date(date) : new Date();
  return d.toISOString().slice(0, 10);
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
 * Hitung total hari rental sesuai aturan cut-off 11:00 AM:
 * - Hari dihitung per TANGGAL kalender (bukan 24 jam)
 * - Cut-off jam 11:00 AM:
 *     - Kembali < 11:00 → tanggal kembali TIDAK dihitung
 *     - Kembali >= 11:00 → tanggal kembali IKUT dihitung
 * - Minimum 1 hari
 *
 * @param {string} startISO - ISO datetime mulai sewa
 * @param {string} endISO   - ISO datetime selesai/kembali aktual
 * @param {number} cutoffHour - Default 11 (jam 11:00 AM)
 * @returns {number} jumlah hari yang di-charge
 */
export const calcRentalDays = (startISO, endISO, cutoffHour = 11) => {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (isNaN(s) || isNaN(e)) return 0;

  // Selisih tanggal kalender (tanpa komponen jam)
  const sDate = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const eDate = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  const dayDiff = Math.round((eDate - sDate) / 86400000);

  // Jam kembali < cutoff → tanggal kembali tidak dihitung
  const beforeCutoff = e.getHours() < cutoffHour;
  const days = dayDiff + (beforeCutoff ? 0 : 1);
  return Math.max(days, 1);
};

/**
 * Helper untuk dashboard reminder: cek apakah rental aktif
 * sudah melewati cut-off hari ini (siap di-charge tambahan).
 */
export const isPastCutoffToday = (cutoffHour = 11) => {
  const now = new Date();
  return now.getHours() >= cutoffHour;
};

/**
 * Helper: cek apakah finishDate (perkiraan) sudah lewat
 */
export const isEstimateExpired = (estimateISO) => {
  if (!estimateISO) return false;
  return new Date(estimateISO) < new Date();
};

/**
 * Parse angka dari string berformat (hapus semua non-digit)
 */
export const parseFormattedNumber = (str) => {
  if (str == null || str === '') return 0;
  return Number(String(str).replace(/\D/g, '')) || 0;
};

/**
 * Attach live thousand-separator ke input element.
 * Ganti type="number" ke type="text" dengan format otomatis.
 * Returns getter function untuk ambil nilai numerik.
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

  // Format nilai awal
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

export const debounce = (fn, delay = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
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
