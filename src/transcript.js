// Transcript ingestion (PROJECT.md §6.3 component 1).
//
// Fetches and parses C-SPAN's transcript API into a time-indexed list of
// speaker windows. Parsing is pure and IO is injectable so the parser can be
// tested against live API responses without a browser.

const TRANSCRIPT_BASE = "https://www.c-span.org/common/services/transcript/";

// "HH:MM:SS" → integer seconds from video start.
// C-SPAN occasionally emits negative components on the opening segment (the
// caption clock leads the official video-start marker by a few seconds); clamp
// the result at 0 rather than dropping the segment.
export function offsetToSeconds(offset) {
  if (typeof offset !== "string") return null;
  const parts = offset.split(":");
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n))) return null;
  const [h, m, s] = nums;
  return Math.max(0, h * 3600 + m * 60 + s);
}

// Build the transcript API URL. videoType defaults to "program" (the MVP
// scope; clip-type videos return empty transcripts per PROJECT.md §3.1).
export function buildTranscriptUrl(videoId, videoType = "program") {
  const q = new URLSearchParams({
    videoId: String(videoId),
    videoType,
    mentionId: "",
    transcriptType: "cc",
    transcriptQuery: "",
  });
  return `${TRANSCRIPT_BASE}?${q.toString()}`;
}

// parts[] → normalized, time-sorted speaker windows.
// Each window's duration is taken from the Unix timestamps (origEnd-origBeg),
// which are more reliable than diffing successive offsets, and anchored at the
// offset-derived start so it lines up with the player's currentTime.
export function parseTranscript(json) {
  const empty = { windows: [], hasTagging: false, disclaimer: null };
  if (!json || !Array.isArray(json.parts)) return empty;

  const windows = json.parts
    .map((p) => {
      const startSec = offsetToSeconds(p.offset);
      if (startSec == null) return null;
      const hasUnix = Number.isFinite(p.origBeg) && Number.isFinite(p.origEnd);
      const durSec = hasUnix ? Math.max(0, p.origEnd - p.origBeg) : 0;
      return {
        personid: p.personid ?? null,
        speakername: p.speakername ?? null,
        ccName: p.cc_name ?? null,
        text: p.text ?? "",
        startSec,
        endSec: startSec + durSec,
        origBeg: Number.isFinite(p.origBeg) ? p.origBeg : null,
        origEnd: Number.isFinite(p.origEnd) ? p.origEnd : null,
      };
    })
    .filter((w) => w !== null)
    .sort((a, b) => a.startSec - b.startSec);

  return {
    windows,
    // Runtime tagging detection (PROJECT.md §3.4): does ANY segment carry a
    // non-null personid? Drives the clean-join vs. fuzzy-fallback decision.
    hasTagging: windows.some((w) => w.personid != null),
    disclaimer: json.disclaimer ?? null,
  };
}

// Fetch + parse for a given videoId.
// In the browser, the same-origin content-script fetch carries the browser's
// User-Agent and cookies, so CloudFront serves it. Outside the browser (Node
// tests), CloudFront 403s a bare request — pass a fetchImpl that adds a browser
// User-Agent/Referer.
export async function fetchTranscript(
  videoId,
  { fetchImpl = fetch, videoType = "program" } = {},
) {
  const url = buildTranscriptUrl(videoId, videoType);
  const res = await fetchImpl(url, {
    credentials: "include",
    headers: { Accept: "application/json, text/plain, */*" },
  });
  const body = await res.text();
  // C-SPAN's CDN throttles with an empty 2xx (observed: HTTP 202, 0 bytes) or a
  // 403 HTML challenge. Surface these as clear, distinct errors rather than a
  // cryptic JSON-parse failure — callers (and the overlay) can then retry/back off.
  if (!res.ok || body.trim() === "") {
    throw new Error(
      `transcript API unavailable for ${videoId}: HTTP ${res.status}` +
        (body.trim() === "" ? " (empty body — likely rate-limited)" : ""),
    );
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(
      `transcript API returned non-JSON for ${videoId} (HTTP ${res.status}) — likely a CDN challenge`,
    );
  }
  return parseTranscript(json);
}
