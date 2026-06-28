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

test("real data/trades.json parses + indexes (House + Senate)", async () => {
  const data = JSON.parse(await readFile(dataPath, "utf8"));
  assert.ok(Array.isArray(data.trades) && data.trades.length > 100, "full file, not a seed");
  const idx = indexTrades(data);
  assert.ok(idx.size >= 50, "many bioguide-resolved members");

  // every trade is keyed and keeps its amount as a disclosed range (§7 honesty)
  for (const t of data.trades) {
    assert.ok(t.bioguide_id, "trade keyed by bioguide");
    assert.ok(typeof t.amount_range === "string" && t.amount_range.includes("$"), "amount is a range string");
    assert.ok(["purchase", "sale", "exchange"].includes(t.type), "known transaction type");
  }
  // both chambers represented (Senate filings come from efdsearch.senate.gov)
  const hasSenate = data.trades.some((t) => /efdsearch\.senate\.gov/.test(t.source_url));
  const hasHouse = data.trades.some((t) => /disclosures-clerk\.house\.gov/.test(t.source_url));
  assert.ok(hasSenate, "includes Senate eFD trades");
  assert.ok(hasHouse, "includes House Clerk trades");
  console.log(`[data] trades.json: ${data.trades.length} trades, ${idx.size} members`);
});
