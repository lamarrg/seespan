// Trades dataset reader (PROJECT.md §7 — recent trades).
//
// Pure index/lookup/format over data/trades.json (produced by the standalone
// parser; see decisions.md [2026-06-16]). Amounts are kept as disclosed ranges,
// never point values (§7 honesty).

// Group trades by bioguide_id, most-recently-disclosed first.
export function indexTrades(data) {
  const byBio = new Map();
  for (const t of (data && data.trades) || []) {
    if (!t.bioguide_id) continue;
    if (!byBio.has(t.bioguide_id)) byBio.set(t.bioguide_id, []);
    byBio.get(t.bioguide_id).push(t);
  }
  for (const arr of byBio.values()) {
    arr.sort((a, b) =>
      String(b.disclosure_date || "").localeCompare(String(a.disclosure_date || "")),
    );
  }
  return byBio;
}

export function recentTrades(index, bioguide, limit = 5) {
  if (!bioguide) return [];
  return (index.get(bioguide) || []).slice(0, limit);
}

const VERB = { purchase: "Bought", sale: "Sold", exchange: "Exchanged" };

export function formatTrade(t) {
  const verb = VERB[t.type] || "Traded";
  const what = t.ticker || t.asset || "?";
  const range =
    t.amount_range ||
    (Number.isFinite(t.amount_low) ? `$${t.amount_low.toLocaleString()}+` : "");
  const date = t.transaction_date || t.disclosure_date || "";
  return `${verb} ${what}${range ? ` · ${range}` : ""}${date ? ` · ${date}` : ""}`;
}
