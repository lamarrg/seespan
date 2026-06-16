import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findActiveWindowIndex,
  findActiveWindow,
  createPlaybackTracker,
} from "../src/playback-sync.js";
import { liveTranscriptOrNull } from "./helpers.mjs";

const W = [
  { startSec: 0, endSec: 10, speakername: "A" },
  { startSec: 10, endSec: 20, speakername: "B" },
  { startSec: 30, endSec: 40, speakername: "C" }, // gap 20–30 before C
];

test("findActiveWindow selects the latest-started window", () => {
  assert.equal(findActiveWindowIndex(W, -5), -1, "before first → none");
  assert.equal(findActiveWindow(W, 0).speakername, "A", "boundary inclusive");
  assert.equal(findActiveWindow(W, 5).speakername, "A");
  assert.equal(findActiveWindow(W, 10).speakername, "B");
  assert.equal(findActiveWindow(W, 25).speakername, "B", "gap keeps last speaker");
  assert.equal(findActiveWindow(W, 35).speakername, "C");
  assert.equal(findActiveWindow(W, 999).speakername, "C", "after last → last");
});

test("tracker fires only on speaker change", () => {
  let clock = -1;
  const fired = [];
  const tracker = createPlaybackTracker({
    getCurrentTime: () => clock,
    windows: W,
    onSpeakerChange: (w) => fired.push(w ? w.speakername : null),
  });

  // Walk the clock second-by-second; tracker should emit one event per change.
  for (clock = 0; clock <= 40; clock++) tracker.tick();
  assert.deepEqual(fired, ["A", "B", "C"], "one event per distinct speaker");
});

test("tracker emits null before the first window then the first speaker", () => {
  let clock = -5;
  const fired = [];
  const tracker = createPlaybackTracker({
    getCurrentTime: () => clock,
    windows: W,
    onSpeakerChange: (w) => fired.push(w ? w.speakername : null),
  });
  tracker.tick(); // at -5 → null
  clock = 2;
  tracker.tick(); // → A
  assert.deepEqual(fired, [null, "A"]);
});

// ---- live: drive the tracker across a real transcript timeline -------------

test("tracker produces an ordered speaker sequence over live 680809", async (t) => {
  const result = await liveTranscriptOrNull();
  if (!result) return t.skip("C-SPAN API unavailable (rate-limited)");
  const { windows } = result;
  assert.ok(windows.length > 0);

  const lastSec = windows[windows.length - 1].startSec;
  let clock = 0;
  const changes = [];
  const tracker = createPlaybackTracker({
    getCurrentTime: () => clock,
    windows,
    onSpeakerChange: (w, t) => changes.push({ t, name: w ? w.speakername : null }),
  });

  // Sample every 5s across the whole program.
  for (clock = 0; clock <= lastSec; clock += 5) tracker.tick();

  assert.ok(changes.length > 1, "multiple speaker changes detected");
  // Change events must be in non-decreasing playback order.
  for (let i = 1; i < changes.length; i++) {
    assert.ok(changes[i].t >= changes[i - 1].t, "events in playback order");
  }
  console.log(
    `[live] 680809: ${changes.length} speaker changes across ${Math.round(lastSec)}s`,
  );
});
