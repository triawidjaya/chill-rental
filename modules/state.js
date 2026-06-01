// =============================================================
// modules/state.js
// AppState — single source of truth with observer pattern
// Modules subscribe to changes; UI reactively re-renders
// =============================================================

import { storage } from './storage.js';

class AppState {
  constructor() {
    this.data = {
      motors:   storage.get('motors', []),
      rentals:  storage.get('rentals', []),
      owners:   storage.get('owners', []),
      damages:  storage.get('damages', []),
      staff:    storage.get('staff', []),
      auditLog: storage.get('auditLog', []),
      settings: storage.get('settings', { theme: 'light', currency: 'IDR' }),
    };
    this.listeners = new Map(); // key -> Set<fn>
  }

  get(key) { return this.data[key]; }

  // Replace whole slice
  set(key, value) {
    this.data[key] = value;
    storage.set(key, value);
    this._notify(key);
    this._notify('*');
  }

  // Add an item to a collection
  add(key, item) {
    const list = [...(this.data[key] || []), item];
    this.set(key, list);
    return item;
  }

  // Update item by id
  update(key, id, patch) {
    const list = (this.data[key] || []).map(it =>
      it.id === id ? { ...it, ...patch, updatedAt: new Date().toISOString() } : it
    );
    this.set(key, list);
  }

  // Remove item by id
  remove(key, id) {
    const list = (this.data[key] || []).filter(it => it.id !== id);
    this.set(key, list);
  }

  // Find by id
  find(key, id) {
    return (this.data[key] || []).find(it => it.id === id);
  }

  // ---- Observer ----
  subscribe(key, fn) {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(fn);
    return () => this.listeners.get(key)?.delete(fn);
  }

  _notify(key) {
    const subs = this.listeners.get(key);
    if (subs) subs.forEach(fn => {
      try { fn(this.data[key === '*' ? Object.keys(this.data)[0] : key]); }
      catch (e) { console.error('[State] listener error', e); }
    });
  }
}

export const state = new AppState();
