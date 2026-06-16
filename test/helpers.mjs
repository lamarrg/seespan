// Shared test helpers.
//
// browserFetch mimics the headers a real in-browser content-script request
// carries, so Node tests can hit the live C-SPAN API (which CloudFront 403s for
// bare non-browser requests). The shipped extension does NOT need this — its
// same-origin fetch already carries these headers.
export function browserFetch(referer = "https://www.c-span.org/") {
  return (url, opts = {}) =>
    fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: referer,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
}

// A known archived Senate session with substantive floor speech (used across
// integration tests as a live fixture).
export const SAMPLE_VIDEO_ID = "680809";
export const SAMPLE_REFERER =
  "https://www.c-span.org/program/us-senate/senate-session/680809";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// FEC's free demo key — real API, low rate limit (~30/hr). Fine for a couple of
// live test calls; the extension itself needs a real api.data.gov key.
export const FEC_DEMO_KEY = "DEMO_KEY";

// Live candidate→committee→top-contributors, retry/skip on rate-limit. Returns
// null when the FEC API is confirmed unavailable (caller should t.skip).
export async function fecContributorsOrNull(candidateId, tries = 2) {
  const { getContributorsForCandidate } = await import("../src/fec.js");
  for (let i = 0; i < tries; i++) {
    try {
      return await getContributorsForCandidate(candidateId, { apiKey: FEC_DEMO_KEY });
    } catch (err) {
      if (i === tries - 1) {
        console.log(`[live] FEC unavailable after ${tries} tries: ${err.message}`);
        return null;
      }
      await sleep(2000 * (i + 1));
    }
  }
  return null;
}

// Fetch the sample transcript from the LIVE API with retry/backoff. C-SPAN's
// CDN intermittently throttles (empty 202 / 403) under repeated automated hits.
// Returns the parsed result, or null if the API is confirmed unavailable after
// retries — callers should t.skip() in that case rather than hard-fail (the
// parsing logic is covered by fixture-based unit tests; no mocks).
export async function liveTranscriptOrNull(videoId = SAMPLE_VIDEO_ID, tries = 3) {
  // Imported lazily to avoid a load-order cycle with the module under test.
  const { fetchTranscript } = await import("../src/transcript.js");
  const fetchImpl = browserFetch(SAMPLE_REFERER);
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchTranscript(videoId, { fetchImpl });
    } catch (err) {
      if (i === tries - 1) {
        console.log(`[live] API unavailable after ${tries} tries: ${err.message}`);
        return null;
      }
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}
