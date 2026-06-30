// Dataset loader (PROJECT.md §6.3 component 5 + decisions.md [2026-06-16]).
//
// The extension reads pre-built JSON datasets (contributions, trades) rather
// than calling third-party APIs at runtime — no user keys, no secrets. In dev
// it reads the snapshot bundled in data/. In production, set HOSTED_BASE_URL to
// your published data host and the loader fetches the fresh file daily, caches
// it (chrome.storage via cache.js), and falls back to the bundled snapshot if
// the host is unreachable. Switching dev → production is this one constant.

import { createCache, chromeStorageStore } from "./cache.js";

const HOSTED_BASE_URL = "https://cdn.jsdelivr.net/gh/lamarrg/seespan-data@main/data";
const DAY_MS = 24 * 60 * 60 * 1000;

const cache = createCache({ store: chromeStorageStore(), ttlMs: DAY_MS });

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`dataset fetch ${url}: HTTP ${res.status}`);
  return res.json();
}

// Load a named dataset ("contributions" | "trades").
export async function loadDataset(name) {
  if (HOSTED_BASE_URL) {
    try {
      return await cache.getOrFetch(`dataset:${name}`, () =>
        fetchJson(`${HOSTED_BASE_URL}/${name}.json`),
      );
    } catch {
      /* host unreachable — fall back to the bundled snapshot */
    }
  }
  return fetchJson(chrome.runtime.getURL(`data/${name}.json`));
}
