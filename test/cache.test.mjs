import { test } from "node:test";
import assert from "node:assert/strict";

import { createCache, memoryStore } from "../src/cache.js";

test("cache returns stored value within TTL, null after expiry", async () => {
  let clock = 1000;
  const cache = createCache({ store: memoryStore(), now: () => clock, ttlMs: 100 });

  await cache.set("schumer", { contributors: ["a", "b"] });
  assert.deepEqual(await cache.get("schumer"), { contributors: ["a", "b"] });

  clock += 50; // within TTL
  assert.deepEqual(await cache.get("schumer"), { contributors: ["a", "b"] });

  clock += 100; // now 150 past store → expired
  assert.equal(await cache.get("schumer"), null);
});

test("cache returns null for missing keys", async () => {
  const cache = createCache({ store: memoryStore() });
  assert.equal(await cache.get("nobody"), null);
});

test("getOrFetch computes + stores on miss, serves cache on hit", async () => {
  let clock = 0;
  const cache = createCache({ store: memoryStore(), now: () => clock, ttlMs: 1000 });
  let calls = 0;
  const compute = async () => {
    calls += 1;
    return { v: calls };
  };

  const first = await cache.getOrFetch("k", compute);
  assert.deepEqual(first, { v: 1 });
  const second = await cache.getOrFetch("k", compute);
  assert.deepEqual(second, { v: 1 }, "served from cache, compute not called again");
  assert.equal(calls, 1);

  clock += 2000; // expire
  const third = await cache.getOrFetch("k", compute);
  assert.deepEqual(third, { v: 2 }, "recomputed after expiry");
  assert.equal(calls, 2);
});

test("getOrFetch does not cache null results", async () => {
  const cache = createCache({ store: memoryStore() });
  let calls = 0;
  const compute = async () => {
    calls += 1;
    return null;
  };
  await cache.getOrFetch("k", compute);
  await cache.getOrFetch("k", compute);
  assert.equal(calls, 2, "null is not cached, so compute runs each time");
});
