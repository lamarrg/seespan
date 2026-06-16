// Caching (PROJECT.md §6.3 component 5).
//
// Persists looked-up financial data keyed by member with a TTL. Financial data
// does not change intraday, so refresh daily-to-weekly. Uses browser-extension
// persistent storage (chrome.storage.local), NOT in-page web storage.
//
// The storage backend is injected so the TTL logic is testable without chrome.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function createCache({ store, now = () => Date.now(), ttlMs = WEEK_MS }) {
  return {
    // Returns the cached value, or null if missing/expired.
    async get(key) {
      const entry = await store.get(key);
      if (!entry || typeof entry.storedAt !== "number") return null;
      if (now() - entry.storedAt > ttlMs) return null;
      return entry.value;
    },
    async set(key, value) {
      await store.set(key, { value, storedAt: now() });
    },
    // Fetch-through helper: return cached value, else compute, store, and return.
    async getOrFetch(key, compute) {
      const hit = await this.get(key);
      if (hit !== null) return hit;
      const value = await compute();
      if (value !== null && value !== undefined) await this.set(key, value);
      return value;
    },
  };
}

// chrome.storage.local-backed store (browser).
export function chromeStorageStore(namespace = "seespan") {
  const k = (key) => `${namespace}:${key}`;
  return {
    async get(key) {
      const kk = k(key);
      const obj = await chrome.storage.local.get(kk);
      return obj[kk];
    },
    async set(key, entry) {
      await chrome.storage.local.set({ [k(key)]: entry });
    },
  };
}

// In-memory store (tests / non-browser fallback).
export function memoryStore() {
  const m = new Map();
  return {
    async get(key) {
      return m.get(key);
    },
    async set(key, entry) {
      m.set(key, entry);
    },
  };
}
