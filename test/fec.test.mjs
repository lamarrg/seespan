import { test } from "node:test";
import assert from "node:assert/strict";

import { buildFecUrl, aggregateContributors } from "../src/fec.js";
import { fecContributorsOrNull } from "./helpers.mjs";

test("buildFecUrl appends the api key and params", () => {
  const url = new URL(buildFecUrl("/candidate/S8NY00082/committees/", { designation: "P" }, "KEY123"));
  assert.equal(url.pathname, "/v1/candidate/S8NY00082/committees/");
  assert.equal(url.searchParams.get("designation"), "P");
  assert.equal(url.searchParams.get("api_key"), "KEY123");
});

test("aggregateContributors sums per contributor, drops null/empty, sorts desc", () => {
  // Representative Schedule A records (split primary/general for one donor).
  const records = [
    { contributor_name: "BARAKETT, TIMOTHY", contribution_receipt_amount: 3300, contributor_employer: "TRB ADVISORS", contributor_occupation: "INVESTOR" },
    { contributor_name: "BARAKETT, TIMOTHY", contribution_receipt_amount: 3300, contributor_employer: "TRB ADVISORS", contributor_occupation: "INVESTOR" },
    { contributor_name: "STIEFEL, BARBARA", contribution_receipt_amount: 3300, contributor_employer: "N/A", contributor_occupation: "RETIRED" },
    { contributor_name: "MEMO ENTRY", contribution_receipt_amount: null }, // dropped
    { contributor_name: "", contribution_receipt_amount: 1000 }, // dropped (no name)
    { contributor_name: "ZERO, Z", contribution_receipt_amount: 0 }, // dropped (<=0)
  ];
  const top = aggregateContributors(records, 5);
  assert.equal(top.length, 2);
  assert.equal(top[0].name, "BARAKETT, TIMOTHY");
  assert.equal(top[0].total, 6600, "primary + general summed");
  assert.equal(top[0].count, 2);
  assert.equal(top[0].employer, "TRB ADVISORS");
  assert.equal(top[1].name, "STIEFEL, BARBARA");
  assert.equal(top[1].total, 3300);
});

test("aggregateContributors respects topN and tolerates junk", () => {
  assert.deepEqual(aggregateContributors(null), []);
  assert.deepEqual(aggregateContributors([]), []);
  const many = Array.from({ length: 10 }, (_, i) => ({
    contributor_name: `D${i}`,
    contribution_receipt_amount: (i + 1) * 100,
  }));
  const top3 = aggregateContributors(many, 3);
  assert.equal(top3.length, 3);
  assert.equal(top3[0].name, "D9", "highest first");
});

// ---- live (real FEC API via DEMO_KEY, no mocks) ----------------------------

test("live: resolve Schumer committee + top contributors", async (t) => {
  const r = await fecContributorsOrNull("S8NY00082");
  if (!r) return t.skip("FEC API unavailable / rate-limited (DEMO_KEY)");

  assert.equal(r.committee.committeeId, "C00346312", "FRIENDS OF SCHUMER");
  assert.ok(r.contributors.length > 0, "got aggregated contributors");
  assert.ok(r.contributors[0].total > 0);
  // sorted descending
  for (let i = 1; i < r.contributors.length; i++) {
    assert.ok(r.contributors[i].total <= r.contributors[i - 1].total);
  }
  console.log(
    "[live] Schumer top contributors:",
    r.contributors.slice(0, 3).map((c) => `${c.name} $${c.total.toLocaleString()}`),
  );
});
