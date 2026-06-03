// =============================================================
// modules/supabase.js
// Offline-first sync engine between localStorage (state.js) and Supabase.
//
// Design:
//   - The app always reads/writes localStorage synchronously (state.js).
//   - This engine runs in the background: it PUSHES the local outbox
//     (dirty records + tombstones) and PULLS remote changes since a cursor,
//     plus a Realtime subscription for live multi-device updates.
//   - Conflict resolution: last-write-wins by record.updatedAt (see state.js).
//   - Loads @supabase/supabase-js from a CDN (no build step / no node_modules),
//     matching this project's zero-dependency philosophy.
//
// Activation: copy modules/config.example.js -> modules/config.js and fill in
// your Project URL + anon key. Without config.js the app runs 100% local.
// =============================================================

import { state, SYNCED_KEYS } from './state.js';
import { storage } from './storage.js';

// Map local state keys -> Supabase table names.
const TABLE_BY_KEY = {
  motors:   'motors',
  rentals:  'rentals',
  owners:   'owners',
  damages:  'damages',
  staff:    'staff',
  auditLog: 'audit_log',
};
const TABLES = SYNCED_KEYS.map(key => ({ key, table: TABLE_BY_KEY[key] }));

const EPOCH = '1970-01-01T00:00:00.000Z';
const CURSOR_KEY = '_sync:cursor';
const INIT_KEY = '_sync:initialized';

class SyncEngine {
  constructor(client, { onRemoteChange, onStatus } = {}) {
    this.client = client;
    this.onRemoteChange = onRemoteChange || (() => {});
    this.onStatus = onStatus || (() => {});
    this._flushing = false;
    this._pendingFlush = false;
    this._pushTimer = null;
    this._flushInterval = null;
  }

  async start() {
    // First-ever run: queue all existing local records so pre-sync data uploads.
    if (!storage.get(INIT_KEY)) {
      SYNCED_KEYS.forEach(k => state.markCollectionDirty(k));
      storage.set(INIT_KEY, true);
    }

    this._setStatus('syncing');
    await this.pull();          // remote -> local
    await this.push();          // local outbox -> remote
    this.subscribeRealtime();   // live updates from other devices

    // Drain the outbox shortly after every local mutation (debounced)…
    state.onLocalChange(() => this._scheduleDebouncedPush());
    // …and a periodic safety flush (also acts as a Realtime fallback).
    this._flushInterval = setInterval(() => this.flush(), 20000);
    // …and whenever connectivity returns.
    window.addEventListener('online', () => this.flush());

    this._setStatus(state.hasPendingChanges() ? 'pending' : 'synced');
  }

  // ---- PULL: apply remote rows changed since the cursor ----
  async pull() {
    const cursor = storage.get(CURSOR_KEY, EPOCH);
    let maxTs = cursor;
    let changed = false;

    for (const { key, table } of TABLES) {
      const { data, error } = await this.client
        .from(table)
        .select('id,data,updated_at,deleted_at')
        .gt('updated_at', cursor)
        .order('updated_at', { ascending: true });

      if (error) { console.warn('[Sync] pull failed:', table, error.message); continue; }

      for (const row of data || []) {
        if (row.updated_at > maxTs) maxTs = row.updated_at;
        if (row.deleted_at) {
          if (state.applyRemoteDelete(key, row.id)) changed = true;
        } else {
          const rec = row.data || {};
          if (!rec.updatedAt) rec.updatedAt = row.updated_at; // keep LWW comparable
          if (state.applyRemoteUpsert(key, rec)) changed = true;
        }
      }
    }

    if (maxTs > cursor) storage.set(CURSOR_KEY, maxTs);
    if (changed) this.onRemoteChange();
    return changed;
  }

  // ---- PUSH: drain the outbox to Supabase ----
  async push() {
    const { dirty, tombstones } = state.getOutbox();
    const pushed = { dirty: {}, tombstones: [] };

    // Upserts
    for (const [key, ids] of Object.entries(dirty)) {
      if (!ids.length) continue;
      const table = TABLE_BY_KEY[key];
      const rows = [];
      const orphans = []; // dirty ids with no local record (deleted before push) — clear them
      ids.forEach(id => {
        const rec = state.find(key, id);
        if (rec) rows.push({ id: rec.id, data: rec, updated_at: rec.updatedAt || nowISO(), deleted_at: null });
        else orphans.push(id);
      });

      if (rows.length) {
        const { error } = await this.client.from(table).upsert(rows, { onConflict: 'id' });
        if (error) { console.warn('[Sync] push failed:', table, error.message); continue; } // keep dirty, retry
        pushed.dirty[key] = rows.map(r => r.id);
      }
      if (orphans.length) pushed.dirty[key] = [...(pushed.dirty[key] || []), ...orphans];
    }

    // Tombstones (soft-delete): set deleted_at; update-only preserves payload and
    // is a harmless no-op if the row never reached the server.
    for (const tomb of tombstones) {
      const table = TABLE_BY_KEY[tomb.key];
      const { error } = await this.client
        .from(table)
        .update({ deleted_at: tomb.deletedAt, updated_at: tomb.deletedAt })
        .eq('id', tomb.id);
      if (error) { console.warn('[Sync] tombstone failed:', table, error.message); continue; }
      pushed.tombstones.push(tomb);
    }

    state.clearOutbox(pushed);
    this._setStatus(state.hasPendingChanges() ? 'pending' : 'synced');
  }

  // push then pull, guarded against overlap
  async flush() {
    if (this._flushing) { this._pendingFlush = true; return; }
    this._flushing = true;
    try {
      await this.push();
      await this.pull();
    } catch (e) {
      console.warn('[Sync] flush error:', e);
    } finally {
      this._flushing = false;
      if (this._pendingFlush) { this._pendingFlush = false; this.flush(); }
    }
  }

  _scheduleDebouncedPush() {
    this._setStatus('pending');
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.flush(), 1500);
  }

  // ---- Realtime: live updates from other devices ----
  subscribeRealtime() {
    const channel = this.client.channel('chill-rental-sync');
    for (const { key, table } of TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if (!row || !row.id) return;
        let changed = false;
        if (payload.eventType === 'DELETE' || row.deleted_at) {
          changed = state.applyRemoteDelete(key, row.id);
        } else {
          const rec = row.data || {};
          if (!rec.updatedAt) rec.updatedAt = row.updated_at;
          changed = state.applyRemoteUpsert(key, rec);
        }
        if (row.updated_at && row.updated_at > storage.get(CURSOR_KEY, EPOCH)) {
          storage.set(CURSOR_KEY, row.updated_at);
        }
        if (changed) this.onRemoteChange();
      });
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') this._setStatus(state.hasPendingChanges() ? 'pending' : 'synced');
    });
    this._channel = channel;
  }

  _setStatus(s) { try { this.onStatus(s); } catch (_) {} }
}

function nowISO() { return new Date().toISOString(); }

/**
 * Initialise sync. Safe to call unconditionally on boot — degrades to a no-op
 * (local-only mode) when config.js is missing or SYNC_ENABLED is false.
 *
 * @param {Object} hooks
 * @param {Function} hooks.onRemoteChange  called after remote data is applied (re-render the UI)
 * @param {Function} [hooks.onStatus]      called with 'syncing'|'synced'|'pending'|'offline'|'disabled'
 * @returns {Promise<SyncEngine|null>}
 */
export async function initSync({ onRemoteChange, onStatus } = {}) {
  let cfg;
  try {
    cfg = await import('./config.js');
  } catch (_) {
    console.info('[Sync] modules/config.js not found — running local-only.');
    onStatus?.('disabled');
    return null;
  }
  if (!cfg.SYNC_ENABLED) {
    console.info('[Sync] SYNC_ENABLED=false — running local-only.');
    onStatus?.('disabled');
    return null;
  }
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) {
    console.warn('[Sync] Supabase URL/key not configured in modules/config.js — running local-only.');
    onStatus?.('disabled');
    return null;
  }

  let createClient;
  try {
    ({ createClient } = await import('https://esm.sh/@supabase/supabase-js@2'));
  } catch (e) {
    console.warn('[Sync] failed to load supabase-js from CDN — running local-only.', e);
    onStatus?.('offline');
    return null;
  }

  const client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const engine = new SyncEngine(client, { onRemoteChange, onStatus });
  try {
    await engine.start();
  } catch (e) {
    console.warn('[Sync] start failed — will keep working locally.', e);
    onStatus?.('offline');
  }
  return engine;
}
