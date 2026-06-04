// =============================================================
// modules/state.js
// AppState — single source of truth with observer pattern
// Modules subscribe to changes; UI reactively re-renders
//
// Sync layer (offline-first):
//   - localStorage stays the synchronous working store (UI never waits on network)
//   - local mutations (add/update/remove) record an OUTBOX of dirty ids / tombstones
//   - the sync engine (modules/supabase.js) drains the outbox to Supabase and
//     applies remote changes back via applyRemoteUpsert / applyRemoteDelete
//   - 'settings' is intentionally NOT synced (per-device preference: theme, lang)
// =============================================================

import { storage } from './storage.js';

// Collections that mirror to Supabase. 'settings' stays local-only.
export const SYNCED_KEYS = ['motors', 'rentals', 'owners', 'damages', 'staff', 'auditLog', 'bookings'];

class AppState {
  constructor() {
    this.data = {
      motors:   storage.get('motors', []),
      rentals:  storage.get('rentals', []),
      owners:   storage.get('owners', []),
      damages:  storage.get('damages', []),
      staff:    storage.get('staff', []),
      auditLog: storage.get('auditLog', []),
      bookings: storage.get('bookings', []),   // booking online (form tamu) — Fase B booking
      settings: storage.get('settings', { theme: 'light', currency: 'IDR' }),
    };
    this.listeners = new Map(); // key -> Set<fn>

    // Outbox: pending local changes waiting to be pushed to Supabase.
    //   dirty:      { collectionKey: { id: true } }  — records to upsert
    //   tombstones: [ { key, id, deletedAt } ]       — soft-deletes to propagate
    this._outbox = storage.get('_outbox', { dirty: {}, tombstones: [] });
    this._localChangeListeners = new Set(); // fns notified after a local mutation
  }

  get(key) { return this.data[key]; }

  // Replace whole slice (bulk). Does NOT touch the outbox — bulk ops that must
  // sync (seed/import) call markCollectionDirty() explicitly afterward.
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
    this._markDirty(key, item.id);
    return item;
  }

  // Update item by id
  update(key, id, patch) {
    const list = (this.data[key] || []).map(it =>
      it.id === id ? { ...it, ...patch, updatedAt: new Date().toISOString() } : it
    );
    this.set(key, list);
    this._markDirty(key, id);
  }

  // Remove item by id. For synced collections this is a SOFT delete: the record
  // disappears from the local UI (filtered out of data[key]) but a tombstone is
  // queued so the deletion propagates to other devices. Hard-removing locally is
  // fine because the tombstone carries the id + deletedAt to the server.
  remove(key, id) {
    const list = (this.data[key] || []).filter(it => it.id !== id);
    this.set(key, list);
    this._markTombstone(key, id);
  }

  // Find by id
  find(key, id) {
    return (this.data[key] || []).find(it => it.id === id);
  }

  // ---- Outbox (push side) ----
  _markDirty(key, id) {
    if (!SYNCED_KEYS.includes(key) || !id) return;
    if (!this._outbox.dirty[key]) this._outbox.dirty[key] = {};
    this._outbox.dirty[key][id] = true;
    this._persistOutbox();
    this._emitLocalChange();
  }

  _markTombstone(key, id) {
    if (!SYNCED_KEYS.includes(key) || !id) return;
    // A delete supersedes any pending upsert for the same id.
    if (this._outbox.dirty[key]) delete this._outbox.dirty[key][id];
    this._outbox.tombstones = this._outbox.tombstones.filter(t => !(t.key === key && t.id === id));
    this._outbox.tombstones.push({ key, id, deletedAt: new Date().toISOString() });
    this._persistOutbox();
    this._emitLocalChange();
  }

  // Mark every current record in a collection dirty (used after seed/import).
  markCollectionDirty(key) {
    (this.data[key] || []).forEach(it => { if (it && it.id) this._markDirty(key, it.id); });
  }

  _persistOutbox() { storage.set('_outbox', this._outbox); }

  // Snapshot of pending work for the sync engine to drain.
  getOutbox() {
    return {
      dirty: Object.fromEntries(
        Object.entries(this._outbox.dirty).map(([k, ids]) => [k, Object.keys(ids)])
      ),
      tombstones: [...this._outbox.tombstones],
    };
  }

  // Clear the entries the engine successfully pushed (called on ack).
  clearOutbox({ dirty = {}, tombstones = [] } = {}) {
    Object.entries(dirty).forEach(([k, ids]) => {
      if (!this._outbox.dirty[k]) return;
      ids.forEach(id => delete this._outbox.dirty[k][id]);
      if (Object.keys(this._outbox.dirty[k]).length === 0) delete this._outbox.dirty[k];
    });
    const gone = new Set(tombstones.map(t => `${t.key}:${t.id}`));
    this._outbox.tombstones = this._outbox.tombstones.filter(t => !gone.has(`${t.key}:${t.id}`));
    this._persistOutbox();
  }

  hasPendingChanges() {
    return this._outbox.tombstones.length > 0 ||
      Object.values(this._outbox.dirty).some(ids => Object.keys(ids).length > 0);
  }

  // ---- Apply remote changes (pull side) — never re-dirties the outbox ----
  // Last-write-wins: only apply if the remote copy is strictly newer than ours.
  applyRemoteUpsert(key, record) {
    if (!record || !record.id) return false;
    const list = this.data[key] || [];
    const idx = list.findIndex(it => it.id === record.id);
    if (idx >= 0) {
      const localTs = list[idx].updatedAt || '';
      const remoteTs = record.updatedAt || '';
      if (remoteTs <= localTs) return false; // ours is same/newer — ignore (also drops our own echo)
      const next = list.slice();
      next[idx] = record;
      this.data[key] = next;
    } else {
      this.data[key] = [...list, record];
    }
    storage.set(key, this.data[key]);
    this._notify(key);
    this._notify('*');
    return true;
  }

  applyRemoteDelete(key, id) {
    const list = this.data[key] || [];
    if (!list.some(it => it.id === id)) return false;
    this.data[key] = list.filter(it => it.id !== id);
    storage.set(key, this.data[key]);
    this._notify(key);
    this._notify('*');
    return true;
  }

  // ---- Local-change signal (drives debounced push in the sync engine) ----
  onLocalChange(fn) {
    this._localChangeListeners.add(fn);
    return () => this._localChangeListeners.delete(fn);
  }
  _emitLocalChange() {
    this._localChangeListeners.forEach(fn => {
      try { fn(); } catch (e) { console.error('[State] localChange listener error', e); }
    });
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
