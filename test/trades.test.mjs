import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { indexTrades, recentTrades, formatTrade } from "../src/trades.js";

const dataPath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "trades.json");

test("formatTrade renders verb + asset + range + date", () => {
  assert.equal(
    formatTrade({ type: "purchase", ticker: "EXPE", amount_range: "$1,001 - $15,000", transaction_date: "2026-05-06" }),
    "Bought EXPE · $1,001 - $15,000 · 2026-05-06",
  );
  assert.equal(
    formatTrade({ type: "sale", ticker: "GOOGL", amount_range: "$15,001 - $50,000", transaction_date: "2026-06-05" }),
    "Sold GOOGL · $15,001 - $50,000 · 2026-06-05",
  );
  assert.equal(formatTrade({ type: "exchange", asset: "Some Fund" }), "Exchanged Some Fund");
});

test("indexTrades groups by bioguide, newest disclosure first; drops unkeyed", () => {
  const idx = indexTrades({
    trades: [
      { bioguide_id: "A", disclosure_date: "2026-01-01", ticker: "X" },
      { bioguide_id: "A", disclosure_date: "2026-03-01", ticker: "Y" },
      { bioguide_id: "B", disclosure_date: "2026-02-01", ticker: "Z" },
      { bioguide_id: null, ticker: "NOPE" },
    ],
  });
  assert.equal(idx.get("A").length, 2);
  assert.equal(idx.get("A")[0].ticker, "Y", "newest disclosure first");
  assert.equal(idx.get("B").length, 1);
  assert.equal(idx.has(null), false);
});

test("recentTrades returns up to N, [] for unknown/null", () => {
  const idx = indexTrades({
    trades: Array.from({ length: 8 }, (_, i) => ({ bioguide_id: "A", disclosure_date: `2026-01-0${i}`, ticker: `T${i}` })),
  });
  assert.equal(recentTrades(idx, "A", 5).length, 5);
  assert.equal(recentTrades(idx, "ZZZ").length, 0);
  assert.equal(recentTrades(idx, null).length, 0);
});

test("real data/trades.json seed parses + indexes", async () => {
  const data = JSON.parse(await readFile(dataPath, "utf8"));
  assert.ok(Array.isArray(data.trades) && data.trades.length > 0);
  const idx = indexTrades(data);
  assert.ok(idx.size > 0, "has bioguide-resolved members");
  const fetterman = idx.get("F000479");
  assert.ok(fetterman && fetterman.length, "Fetterman (F000479) present");
  assert.ok(fetterman.some((t) => t.ticker === "EXPE"), "Fetterman bought EXPE");
  console.log(`[seed] trades.json: ${data.trades.length} trades, ${idx.size} members`);
});
