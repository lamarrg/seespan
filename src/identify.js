// Speaker identification + formatting — the orchestration core shared by the
// content script and tests. Pure (no DOM/chrome), so it can be exercised
// end-to-end against live transcript data.

import { resolveByPersonId, resolveBySpeakername } from "./crosswalk.js";

// Resolve a transcript window to a member identity. Prefers the clean personid
// join (PROJECT.md §3.4 happy path); falls back to the surname label when the
// segment is untagged OR tagged with a personid not in the crosswalk (the
// ~50% id.cspan gap, or a former member).
export function resolveSpeaker(crosswalk, window) {
  if (!window) return null;
  if (window.personid != null) {
    const byId = resolveByPersonId(crosswalk, window.personid);
    if (byId) return byId;
  }
  return resolveBySpeakername(crosswalk, window.speakername);
}

export function formatTimestamp(sec) {
  if (typeof sec !== "number" || Number.isNaN(sec)) return "??:??:??";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

// A glanceable one-line description for the console spike (Phase 1 output).
// Distinguishes high-confidence personid joins from low-confidence fallback
// matches and from unresolved speakers.
export function formatSpeaker(window, resolution, currentSec) {
  const ts = formatTimestamp(currentSec);
  if (!window) return `[${ts}] (no active speaker yet)`;

  if (resolution && resolution.entry) {
    const e = resolution.entry;
    const title = e.chamber === "senate" ? "Sen." : e.chamber === "house" ? "Rep." : "";
    const who = `${title} ${e.full_name} (${e.party}-${e.state})`.trim();
    if (resolution.confidence === "high") return `[${ts}] ${who}`;
    return `[${ts}] ${who}  ⚠ low-confidence (${resolution.via})`;
  }

  const label = window.speakername || window.ccName || "UNKNOWN";
  if (resolution && resolution.confidence === "ambiguous") {
    return `[${ts}] ${label} — ambiguous surname, ${resolution.candidates.length} matches`;
  }
  const reason =
    window.personid != null
      ? `personid ${window.personid} not in crosswalk`
      : "no crosswalk match";
  return `[${ts}] ${label} — unidentified (${reason})`;
}
