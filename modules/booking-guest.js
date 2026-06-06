// =============================================================
// modules/booking-guest.js
// Public guest booking page (booking.html). Standalone & lightweight:
// it does NOT load the staff app (state/sync/router). It only:
//   1. shows the binding PIPES HOSTEL agreement (must scroll + accept),
//   2. collects guest details + booking preferences,
//   3. submits via the `submit_booking` RPC (anon — no table access),
//   4. shows the short booking code to quote to staff.
//
// English-only (foreign guests). The actual rental price model is untouched —
// PRICE_BY_CC here is indicative info shown to the guest only.
// =============================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { TERMS, TIPS, PROPERTY_NAME } from './terms.js';
import { PRICE_BY_CC, BOOKING_CC_OPTIONS } from './pricing.js';
import { formatIDR } from './utils.js';

const root = document.getElementById('booking-root');

// Carried across screens once the guest accepts the agreement.
const consent = { agreedTermsVersion: null, agreedAt: null };

let _client = null;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Walk-in channel token. Present only when the form was opened from the
// reception QR (booking.html#wt=<token>). Kept in the #hash (not the query
// string) so it never leaks to server logs / Referer. null for the public
// online link — the server then records the booking as 'online'.
const walkinToken = () => {
  const m = String(location.hash || '').match(/(?:^|[#&])wt=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

function configured() {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY && !SUPABASE_URL.includes('YOUR-PROJECT');
}

async function getClient() {
  if (_client) return _client;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

const brandHeader = () => `
  <div class="bk__brand">
    <h1>${esc(PROPERTY_NAME)}</h1>
    <p>Motorbike Rental — Online Booking</p>
  </div>`;

// ---------- Screen 1: Agreement gate ----------
function renderAgreement() {
  root.innerHTML = `
    ${brandHeader()}
    <h2 style="font-family:var(--font-display);font-size:17px;margin:0 0 4px">${esc(TERMS.title)}</h2>
    <p class="muted" style="font-size:12px;margin:0 0 10px;color:var(--text-secondary)">Please read the full terms before booking.</p>

    <div class="bk__terms" id="terms-box">${esc(TERMS.body)}</div>
    <p class="bk__scrollhint" id="scroll-hint">↓ Scroll to the end to continue</p>

    <div class="bk__agree" id="agree-box">
      <label class="field" style="display:flex;gap:10px;align-items:flex-start;opacity:.5;margin:0" id="agree-wrap">
        <input type="checkbox" id="agree-check" disabled style="margin-top:3px;width:18px;height:18px;flex:none" />
        <span style="font-size:13.5px">I have read and agree to the Terms &amp; Conditions of ${esc(PROPERTY_NAME)}.</span>
      </label>
      <button class="btn btn--block" id="btn-agree" disabled style="margin-top:12px">Agree &amp; Continue</button>
    </div>
  `;

  const box = document.getElementById('terms-box');
  const hint = document.getElementById('scroll-hint');
  const wrap = document.getElementById('agree-wrap');
  const check = document.getElementById('agree-check');
  const btn = document.getElementById('btn-agree');

  let reachedEnd = false;
  const markRead = () => {
    if (reachedEnd) return;
    reachedEnd = true;
    check.disabled = false;
    wrap.style.opacity = '1';
    hint.style.display = 'none';
  };
  const atBottom = () => box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  // If the terms fit without scrolling, treat as already read.
  if (box.scrollHeight <= box.clientHeight + 8) markRead();
  box.addEventListener('scroll', () => { if (atBottom()) markRead(); });

  check.addEventListener('change', () => { btn.disabled = !check.checked; });
  btn.addEventListener('click', () => {
    if (!check.checked) return;
    consent.agreedTermsVersion = TERMS.version;
    consent.agreedAt = new Date().toISOString();
    renderForm();
    window.scrollTo(0, 0);
  });
}

// ---------- Screen 2: Booking form ----------
function renderForm() {
  const ccOptions = BOOKING_CC_OPTIONS
    .map(cc => `<option value="${esc(cc)}">${esc(cc)} cc — ${formatIDR(PRICE_BY_CC[cc])}/day</option>`)
    .join('');

  root.innerHTML = `
    ${brandHeader()}
    <h2 style="font-family:var(--font-display);font-size:18px;margin:0 0 14px">Your details</h2>

    <div class="bk__field field">
      <label class="field__label required" for="g-name">Full name</label>
      <input id="g-name" class="input" type="text" autocomplete="name" />
    </div>
    <div class="bk__field field">
      <label class="field__label required" for="g-wa">WhatsApp number</label>
      <input id="g-wa" class="input" type="tel" inputmode="tel" placeholder="+62…" autocomplete="tel" />
    </div>
    <div class="bk__field field">
      <label class="field__label required" for="g-email">Email</label>
      <input id="g-email" class="input" type="email" inputmode="email" autocomplete="email" />
    </div>
    <div class="bk__field field">
      <label class="field__label" for="g-passport">Passport number <span class="muted" style="font-weight:400">(optional)</span></label>
      <input id="g-passport" class="input" type="text" />
    </div>

    <h2 style="font-family:var(--font-display);font-size:18px;margin:18px 0 14px">Booking</h2>

    <div class="bk__field field">
      <label class="field__label required" for="g-cc">Engine class</label>
      <select id="g-cc" class="select">
        <option value="">— Select —</option>
        ${ccOptions}
      </select>
    </div>
    <div class="card" id="price-card" style="background:var(--bg-subtle);padding:12px;display:none;margin-bottom:14px">
      <div class="row row--between" style="align-items:center">
        <span class="muted" style="font-size:13px">Estimated price</span>
        <span class="bk__price" id="price-val">—</span>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:4px">Final price is confirmed by staff at check-in.</div>
    </div>

    <div class="bk__field field">
      <label class="field__label">Surfboard rack?</label>
      <div class="bk__seg" id="surf-seg">
        <button type="button" class="btn btn--ghost seg-opt" data-surf="yes">Yes</button>
        <button type="button" class="btn btn--ghost seg-opt is-active" data-surf="no">No</button>
      </div>
    </div>

    <div class="bk__row2">
      <div class="bk__field field">
        <label class="field__label required" for="g-start">Start date</label>
        <input id="g-start" class="input" type="date" />
      </div>
      <div class="bk__field field">
        <label class="field__label" for="g-finish">End date <span class="muted" style="font-weight:400">(est.)</span></label>
        <input id="g-finish" class="input" type="date" />
      </div>
    </div>

    <div id="form-err" class="muted" style="color:var(--danger);font-size:13px;min-height:18px;margin-bottom:8px"></div>
    <button class="btn btn--block" id="btn-submit">Submit booking</button>
    <p class="muted" style="font-size:11.5px;text-align:center;margin-top:10px;color:var(--text-tertiary)">
      Payment is collected at the end of the rental period, not before.
    </p>
  `;

  const $ = (id) => document.getElementById(id);
  let surfrack = false;

  // CC -> price
  const ccSel = $('g-cc');
  ccSel.addEventListener('change', () => {
    const price = PRICE_BY_CC[ccSel.value];
    if (price != null) {
      $('price-card').style.display = '';
      $('price-val').textContent = `${formatIDR(price)}/day`;
    } else {
      $('price-card').style.display = 'none';
    }
  });

  // Surfrack toggle
  document.querySelectorAll('#surf-seg .seg-opt').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#surf-seg .seg-opt').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      surfrack = b.dataset.surf === 'yes';
    });
  });

  $('btn-submit').addEventListener('click', () => submitBooking({ $, getSurfrack: () => surfrack }));
}

async function submitBooking({ $, getSurfrack }) {
  const err = $('form-err');
  const setErr = (m) => { err.textContent = m || ''; };

  const guestName = $('g-name').value.trim();
  const wa = $('g-wa').value.trim();
  const email = $('g-email').value.trim();
  const passportNo = $('g-passport').value.trim();
  const ccClass = $('g-cc').value;
  const startDate = $('g-start').value;
  const finishDate = $('g-finish').value;

  if (!guestName) return setErr('Please enter your full name.');
  if (!wa) return setErr('Please enter your WhatsApp number.');
  if (!email || !isValidEmail(email)) return setErr('Please enter a valid email.');
  if (!ccClass) return setErr('Please select an engine class.');
  if (!startDate) return setErr('Please select a start date.');
  if (!configured()) return setErr('Booking is not available right now. Please contact the front desk.');
  setErr('');

  const btn = $('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  const payload = {
    guestName, wa, email, passportNo,
    ccClass, surfrack: getSurfrack(),
    startDate, finishDate,
    agreedTermsVersion: consent.agreedTermsVersion,
    agreedAt: consent.agreedAt,
    walkinToken: walkinToken(),   // null from the public link -> server records 'online'
  };

  try {
    const client = await getClient();
    const { data, error } = await client.rpc('submit_booking', { p: payload });
    if (error) throw error;
    renderSuccess(String(data), { guestName, ccClass });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error('[Booking] submit failed', e);
    btn.disabled = false;
    btn.textContent = 'Submit booking';
    setErr('Could not submit. Check your connection and try again.');
  }
}

// ---------- Screen 3: Success ----------
function renderSuccess(code, { guestName, ccClass }) {
  root.innerHTML = `
    ${brandHeader()}
    <div class="bk__center">
      <div style="font-size:46px;line-height:1">✅</div>
      <h2 style="font-family:var(--font-display);font-size:20px;margin:8px 0 4px">Booking received!</h2>
      <p class="muted" style="font-size:13.5px;color:var(--text-secondary);margin:0 0 6px">
        Thanks${guestName ? ', ' + esc(guestName) : ''}. Show this code to our staff at the front desk:
      </p>
    </div>
    <div class="bk__code">${esc(code)}</div>
    <div class="card" style="background:var(--bg-subtle);padding:12px;font-size:13px">
      <div class="row row--between"><span class="muted">Engine class</span><strong>${esc(ccClass)} cc</strong></div>
    </div>
    <div class="card" style="background:var(--bg-subtle);padding:12px;margin-top:12px">
      <div style="font-weight:700;font-size:13px;margin-bottom:6px">💡 Riding Tips</div>
      <ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.5;color:var(--text-secondary)">
        ${TIPS.map(tip => `<li>${esc(tip)}</li>`).join('')}
      </ul>
    </div>
    <p class="muted bk__center" style="font-size:12px;margin-top:16px;color:var(--text-tertiary)">
      Our staff will confirm your bike and pricing on arrival.
    </p>
  `;
}

// ---------- Boot ----------
if (!root) {
  console.error('[Booking] #booking-root not found');
} else {
  renderAgreement();
}
