import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createCrosswalk } from "../src/crosswalk.js";
import { resolveSpeaker, formatSpeaker, formatTimestamp } from "../src/identify.js";
import { createPlaybackTracker } from "../src/playback-sync.js";
import { liveTranscriptOrNull } from "./helpers.mjs";

const dataPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "crosswalk.json",
);

async function loadCrosswalk() {
  const raw = JSON.parse(await readFile(dataPath, "utf8"));
  return createCrosswalk(raw.entries);
}

test("formatTimestamp renders HH:MM:SS", () => {
  assert.equal(formatTimestamp(0), "00:00:00");
  assert.equal(formatTimestamp(3661), "01:01:01");
  assert.equal(formatTimestamp(NaN), "??:??:??");
});

test("resolveSpeaker prefers personid, falls back to surname", async () => {
  const cw = await loadCrosswalk();
  const tagged = resolveSpeaker(cw, { personid: 5929, speakername: "Chuck Schumer" });
  assert.equal(tagged.confidence, "high");
  assert.equal(tagged.entry.bioguide_id, "S000148");

  const untagged = resolveSpeaker(cw, { personid: null, speakername: "MR. SCHUMER" });
  assert.equal(untagged.confidence, "low");
  assert.equal(untagged.entry.bioguide_id, "S000148");

  assert.equal(resolveSpeaker(cw, null), null);
});

test("formatSpeaker marks confidence levels distinctly", async () => {
  const cw = await loadCrosswalk();
  const high = formatSpeaker(
    { personid: 5929, speakername: "Chuck Schumer" },
    resolveSpeaker(cw, { personid: 5929, speakername: "Chuck Schumer" }),
    65,
  );
  assert.match(high, /Sen\. Charles E\. Schumer \(D-NY\)/);
  assert.doesNotMatch(high, /low-confidence/);

  const low = formatSpeaker(
    { personid: null, speakername: "MR. SCHUMER" },
    resolveSpeaker(cw, { personid: null, speakername: "MR. SCHUMER" }),
    65,
  );
  assert.match(low, /low-confidence/);

  const unknown = formatSpeaker(
    { personid: null, speakername: "THE PRESIDING OFFICER" },
    resolveSpeaker(cw, { personid: null, speakername: "THE PRESIDING OFFICER" }),
    65,
  );
  assert.match(unknown, /unidentified/);
});

// ---- full pipeline over live data, exactly as content-main runs it ---------

test("end-to-end: identify speakers across live 680809", async (t) => {
  const cw = await loadCrosswalk();
  const result = await liveTranscriptOrNull();
  if (!result) return t.skip("C-SPAN API unavailable (rate-limited)");
  const { windows, hasTagging } = result;
  assert.ok(hasTagging, "fixture video is tagged");

  const lines = [];
  const lastSec = windows[windows.length - 1].startSec;
  let clock = 0;
  const tracker = createPlaybackTracker({
    getCurrentTime: () => clock,
    windows,
    onSpeakerChange: (w, t) => {
      // Must never throw on any real window.
      const line = formatSpeaker(w, resolveSpeaker(cw, w), t);
      assert.equal(typeof line, "string");
      lines.push(line);
    },
  });
  for (clock = 0; clock <= lastSec; clock += 5) tracker.tick();

  const identified = lines.filter((l) => /Sen\.|Rep\./.test(l) && !/low-confidence/.test(l));
  assert.ok(identified.length > 0, "produced high-confidence identifications");

  console.log(`[live] 680809 produced ${lines.length} speaker-change lines. Sample:`);
  for (const l of lines.slice(0, 12)) console.log("   " + l);
});
