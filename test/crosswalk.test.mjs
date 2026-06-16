import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  createCrosswalk,
  resolveByPersonId,
  resolveBySpeakername,
  normalizeSurname,
} from "../src/crosswalk.js";
import { liveTranscriptOrNull } from "./helpers.mjs";

const dataPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "crosswalk.json",
);

async function loadCrosswalk() {
  const raw = JSON.parse(await readFile(dataPath, "utf8"));
  return { meta: raw, cw: createCrosswalk(raw.entries) };
}

test("normalizeSurname strips honorifics and isolates the surname", () => {
  assert.equal(normalizeSurname("MR. THUNE"), "THUNE");
  assert.equal(normalizeSurname("Chuck Schumer"), "SCHUMER");
  assert.equal(normalizeSurname("Senator Klobuchar"), "KLOBUCHAR");
  assert.equal(normalizeSurname("SCHUMER"), "SCHUMER");
  assert.equal(normalizeSurname("THE PRESIDING OFFICER"), "OFFICER");
  assert.equal(normalizeSurname(""), null);
});

test("crosswalk.json is well-formed", async () => {
  const { meta, cw } = await loadCrosswalk();
  assert.ok(meta.entries.length > 500, "has the full current Congress");
  assert.ok(cw.byCspanId.size > 200, "meaningful cspan id coverage");
  for (const e of meta.entries) {
    assert.ok(e.bioguide_id, "every entry has a bioguide spine");
  }
});

test("resolveByPersonId returns Schumer for 5929 (high confidence)", async () => {
  const { cw } = await loadCrosswalk();
  const r = resolveByPersonId(cw, 5929);
  assert.ok(r);
  assert.equal(r.entry.bioguide_id, "S000148");
  assert.equal(r.entry.full_name, "Charles E. Schumer");
  assert.equal(r.confidence, "high");
  // string/number agnostic
  assert.equal(resolveByPersonId(cw, "5929").entry.bioguide_id, "S000148");
  assert.equal(resolveByPersonId(cw, null), null);
});

test("resolveBySpeakername matches the all-caps fallback label (low confidence)", async () => {
  const { cw } = await loadCrosswalk();
  const r = resolveBySpeakername(cw, "MR. SCHUMER");
  assert.ok(r.entry);
  assert.equal(r.entry.bioguide_id, "S000148");
  assert.equal(r.confidence, "low");
});

test("resolveBySpeakername disambiguates shared surnames by state", async () => {
  const { cw } = await loadCrosswalk();
  // Find a surname shared by 2+ members to exercise the collision path.
  const shared = [...cw.bySurname.entries()].find(([, v]) => v.length >= 2);
  assert.ok(shared, "expected at least one shared surname in Congress");
  const [surname, members] = shared;
  const ambiguous = resolveBySpeakername(cw, surname);
  assert.equal(ambiguous.entry, null, "refuses to guess without a disambiguator");
  assert.equal(ambiguous.confidence, "ambiguous");
  const resolved = resolveBySpeakername(cw, surname, { state: members[0].state });
  assert.ok(resolved.entry, "state disambiguates");
});

// ---- live end-to-end: do real tagged personids resolve? --------------------

test("tagged personids from live video 680809 resolve via the crosswalk", async (t) => {
  const { cw } = await loadCrosswalk();
  const result = await liveTranscriptOrNull();
  if (!result) return t.skip("C-SPAN API unavailable (rate-limited)");
  const { windows } = result;
  const taggedIds = [...new Set(windows.filter((w) => w.personid != null).map((w) => w.personid))];
  assert.ok(taggedIds.length > 0, "video has tagged speakers");

  const resolved = taggedIds.filter((id) => resolveByPersonId(cw, id));
  const rate = resolved.length / taggedIds.length;
  console.log(
    `[live] 680809: ${resolved.length}/${taggedIds.length} distinct tagged ` +
      `personids resolved via crosswalk (${(rate * 100).toFixed(0)}%)`,
  );
  // These are current senators on the floor; the vast majority must join.
  assert.ok(rate >= 0.7, `resolution rate ${rate} below 0.7 threshold`);
});
