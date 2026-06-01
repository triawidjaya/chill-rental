// =============================================================
// modules/storage.js
// LocalStorage adapter — single namespace, versioned
// Easy to swap with IndexedDB or remote API later
// =============================================================

const NAMESPACE = 'chill_rental_v1';
const KEYS = {
  motors:   `${NAMESPACE}:motors`,
  rentals:  `${NAMESPACE}:rentals`,
  owners:   `${NAMESPACE}:owners`,
  damages:  `${NAMESPACE}:damages`,
  staff:    `${NAMESPACE}:staff`,
  auditLog: `${NAMESPACE}:auditLog`,
  settings: `${NAMESPACE}:settings`,
};

class StorageService {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(KEYS[key] || key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('[Storage] read failed:', key, e);
      return fallback;
    }
  }

  set(key, value) {
    try {
      localStorage.setItem(KEYS[key] || key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[Storage] write failed:', key, e);
      return false;
    }
  }

  remove(key) {
    localStorage.removeItem(KEYS[key] || key);
  }

  clearAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  }

  // Bulk export — for backup
  exportAll() {
    const data = {};
    Object.entries(KEYS).forEach(([name, k]) => {
      data[name] = this.get(name);
    });
    return data;
  }

  importAll(data) {
    Object.entries(data).forEach(([name, value]) => {
      if (KEYS[name]) this.set(name, value);
    });
  }
}

export const storage = new StorageService();
export { KEYS };
