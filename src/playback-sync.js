// Playback sync (PROJECT.md §6.3 component 2).
//
// Reads the video's current playback time, determines the active speaker
// window, and signals on speaker change (not continuously, per PROJECT.md §7).
// The clock source is injected (getCurrentTime) so the selection logic is
// testable without a DOM.

// Index of the active window: the latest window that has started at or before
// `t`. Windows are assumed sorted ascending by startSec (parseTranscript
// guarantees this). Returns -1 if `t` precedes the first window.
//
// "Latest started" naturally handles caption gaps: between segments the most
// recently started speaker remains active until the next one begins.
export function findActiveWindowIndex(windows, t) {
  let lo = 0;
  let hi = windows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (windows[mid].startSec <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function findActiveWindow(windows, t) {
  const i = findActiveWindowIndex(windows, t);
  return i >= 0 ? windows[i] : null;
}

// Poll the clock and invoke onSpeakerChange(window, currentSec) only when the
// active window changes. `window` is null while playback precedes the first
// segment. Returns { tick, start, stop }; tick() does one poll (exposed for
// deterministic testing), start()/stop() drive it on an interval.
export function createPlaybackTracker({
  getCurrentTime,
  windows,
  onSpeakerChange,
  intervalMs = 1000,
}) {
  let timer = null;
  let lastIndex = -2; // sentinel distinct from -1 (= before first window)

  function tick() {
    const t = getCurrentTime();
    if (typeof t !== "number" || Number.isNaN(t)) return;
    const idx = findActiveWindowIndex(windows, t);
    if (idx === lastIndex) return;
    lastIndex = idx;
    onSpeakerChange(idx >= 0 ? windows[idx] : null, t);
  }

  return {
    tick,
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
