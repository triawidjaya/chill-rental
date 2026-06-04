// =============================================================
// modules/property.js
// Business / property name used in staff-sent WhatsApp messages.
//
// Source of truth: settings.propertyName (per-device, NOT synced — same as
// theme/lang). Falls back to the compile-time default in terms.js.
//
// Note: the public booking page (booking.html) is standalone and cannot read
// these settings — it uses terms.PROPERTY_NAME directly. They start identical;
// they only diverge if a staff device overrides the name here.
// =============================================================

import { state } from './state.js';
import { PROPERTY_NAME as DEFAULT_PROPERTY_NAME } from './terms.js';

export function getPropertyName() {
  const s = state.get('settings') || {};
  const n = (s.propertyName || '').trim();
  return n || DEFAULT_PROPERTY_NAME || 'PIPES HOSTEL';
}

export function setPropertyName(name) {
  const next = { ...(state.get('settings') || {}) };
  next.propertyName = (name || '').trim();
  state.set('settings', next);   // persists + notifies; settings is not synced
  return getPropertyName();
}
