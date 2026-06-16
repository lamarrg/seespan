import { test } from "node:test";
import assert from "node:assert/strict";

import { formatContributor, clampPosition } from "../src/overlay.js";

test("formatContributor shows amount + meaningful detail", () => {
  assert.equal(
    formatContributor({ name: "BARAKETT, TIMOTHY", total: 6600, employer: "TRB ADVISORS", occupation: "INVESTOR" }),
    "BARAKETT, TIMOTHY — $6,600 · TRB ADVISORS",
  );
  // employer N/A → fall back to occupation
  assert.equal(
    formatContributor({ name: "STIEFEL, BARBARA", total: 3300, employer: "N/A", occupation: "RETIRED" }),
    "STIEFEL, BARBARA — $3,300 · RETIRED",
  );
  // both boilerplate → amount only
  assert.equal(
    formatContributor({ name: "HEINRICHS, JOEL", total: 3300, employer: "NOT EMPLOYED", occupation: "NOT EMPLOYED" }),
    "HEINRICHS, JOEL — $3,300",
  );
  // missing fields → amount only, no trailing separator
  assert.equal(
    formatContributor({ name: "X, Y", total: 1000 }),
    "X, Y — $1,000",
  );
});

test("clampPosition keeps the panel within the viewport", () => {
  // 300x60 panel in a 1000x800 viewport, margin 8.
  // In bounds → unchanged.
  assert.deepEqual(clampPosition(100, 100, 300, 60, 1000, 800), { left: 100, top: 100 });
  // Off the right/bottom → clamped to max.
  assert.deepEqual(clampPosition(9999, 9999, 300, 60, 1000, 800), { left: 692, top: 732 });
  // Negative → clamped to margin.
  assert.deepEqual(clampPosition(-50, -50, 300, 60, 1000, 800), { left: 8, top: 8 });
});
