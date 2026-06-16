import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The extension reads contributions.json and looks up by bioguide directly
// (data.members[bioguide]). Validate the seed file's shape + a real lookup.
const dataPath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "contributions.json");

test("contributions.json seed is well-formed and keyed by bioguide", async () => {
  const data = JSON.parse(await readFile(dataPath, "utf8"));
  assert.ok(data.members && typeof data.members === "object");

  const thune = data.members["T000250"]; // John Thune — the 680931 smoke speaker
  assert.ok(thune, "Thune present");
  assert.ok(Array.isArray(thune.contributors) && thune.contributors.length > 0);
  for (const c of thune.contributors) {
    assert.ok(c.name, "contributor has a name");
    assert.ok(Number.isFinite(c.total) && c.total > 0, "contributor has a positive total");
  }
  // sorted descending by total
  for (let i = 1; i < thune.contributors.length; i++) {
    assert.ok(thune.contributors[i].total <= thune.contributors[i - 1].total);
  }
});
