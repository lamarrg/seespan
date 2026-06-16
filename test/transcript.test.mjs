import { test } from "node:test";
import assert from "node:assert/strict";

import {
  offsetToSeconds,
  buildTranscriptUrl,
  parseTranscript,
  fetchTranscript,
} from "../src/transcript.js";
import { extractVideoId, extractVideoIdFromPage } from "../src/videoid.js";
import { SAMPLE_VIDEO_ID, liveTranscriptOrNull } from "./helpers.mjs";

// ---- pure unit tests -------------------------------------------------------

test("offsetToSeconds parses HH:MM:SS", () => {
  assert.equal(offsetToSeconds("00:00:04"), 4);
  assert.equal(offsetToSeconds("01:02:03"), 3723);
  assert.equal(offsetToSeconds("-1:-1:-6"), 0, "negative opening offset clamps to 0");
  assert.equal(offsetToSeconds("garbage"), null);
  assert.equal(offsetToSeconds(null), null);
});

test("buildTranscriptUrl sets the required query params", () => {
  const url = new URL(buildTranscriptUrl("680809"));
  assert.equal(url.searchParams.get("videoId"), "680809");
  assert.equal(url.searchParams.get("videoType"), "program");
  assert.equal(url.searchParams.get("transcriptType"), "cc");
});

test("extractVideoId handles both C-SPAN URL shapes", () => {
  assert.equal(
    extractVideoId("https://www.c-span.org/program/us-senate/senate-session/680809"),
    "680809",
  );
  assert.equal(
    extractVideoId("https://www.c-span.org/video/?680809-1/senate-session"),
    "680809",
  );
  assert.equal(
    extractVideoId("https://www.c-span.org/video/?532749-1/washington-journal"),
    "532749",
  );
  assert.equal(extractVideoId("https://www.c-span.org/"), null);
  // Regression: the date-chronicle redirect must NOT yield the year from ?date=.
  assert.equal(
    extractVideoId("https://www.c-span.org/congress/?chamber=senate&date=2026-06-15"),
    null,
    "must not grab 2026 out of the date",
  );
});

test("extractVideoIdFromPage reads the id from the C-SPAN HLS source", () => {
  assert.equal(
    extractVideoIdFromPage(
      'x <source src="https://m3u8-1.c-spanvideo.org/program/program.680931.clean.m3u8"> y',
    ),
    "680931",
  );
  assert.equal(
    extractVideoIdFromPage("... program.680931.tsc.m3u8 ..."),
    "680931",
  );
  assert.equal(extractVideoIdFromPage("no video here"), null);
  assert.equal(extractVideoIdFromPage(null), null);
});

test("parseTranscript normalizes, sorts, and detects tagging", () => {
  const fixture = {
    parts: [
      { offset: "00:01:00", origBeg: 100, origEnd: 110, personid: 5929, speakername: "Chuck Schumer", cc_name: "MR. SCHUMER", text: "b" },
      { offset: "00:00:04", origBeg: 4, origEnd: 9, personid: null, speakername: "THE CLERK", cc_name: "THE CLERK", text: "a" },
    ],
    disclaimer: "*uncorrected",
  };
  const { windows, hasTagging, disclaimer } = parseTranscript(fixture);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].startSec, 4, "sorted by start time");
  assert.equal(windows[1].startSec, 60);
  assert.equal(windows[1].endSec, 70, "duration from origEnd-origBeg");
  assert.equal(windows[0].personid, null);
  assert.equal(windows[1].personid, 5929);
  assert.equal(hasTagging, true);
  assert.equal(disclaimer, "*uncorrected");
});

test("parseTranscript tolerates malformed input", () => {
  assert.deepEqual(parseTranscript(null), { windows: [], hasTagging: false, disclaimer: null });
  assert.deepEqual(parseTranscript({}), { windows: [], hasTagging: false, disclaimer: null });
});

test("fetchTranscript surfaces a clear error on throttled/empty responses", async () => {
  const empty202 = () =>
    Promise.resolve({ ok: true, status: 202, text: () => Promise.resolve("") });
  await assert.rejects(
    fetchTranscript("680809", { fetchImpl: empty202 }),
    /rate-limited/,
    "empty 2xx → rate-limit error",
  );
  const htmlChallenge = () =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("<html>403</html>") });
  await assert.rejects(
    fetchTranscript("680809", { fetchImpl: htmlChallenge }),
    /non-JSON/,
    "HTML challenge → non-JSON error",
  );
});

// ---- live integration test (real C-SPAN API, no mocks) ---------------------

test("fetchTranscript returns sorted windows from the live API", async (t) => {
  const result = await liveTranscriptOrNull();
  if (!result) return t.skip("C-SPAN API unavailable (rate-limited)");
  assert.ok(result.windows.length > 0, "got transcript segments");

  // Sorted ascending by start time.
  for (let i = 1; i < result.windows.length; i++) {
    assert.ok(
      result.windows[i].startSec >= result.windows[i - 1].startSec,
      "windows are time-sorted",
    );
  }

  // Every window has the fields the rest of the pipeline relies on.
  for (const w of result.windows) {
    assert.ok(typeof w.startSec === "number");
    assert.ok(typeof w.endSec === "number");
    assert.ok("personid" in w);
    assert.ok("speakername" in w);
  }

  console.log(
    `[live] video ${SAMPLE_VIDEO_ID}: ${result.windows.length} windows, ` +
      `hasTagging=${result.hasTagging}, ` +
      `tagged segments=${result.windows.filter((w) => w.personid != null).length}`,
  );
});
