// SeeSpan content-script entry (ESM, dynamic-imported by loader.js).
//
// On a C-SPAN program page: fetch the transcript, load the crosswalk, identify
// the active speaker as the video plays, and render their top FEC contributors
// + recent trades in the overlay. Financial data comes from pre-built datasets
// the extension READS (no live third-party APIs, no user keys).
//
// This file is the browser glue (DOM + chrome.* APIs); all logic lives in the
// imported, separately-tested modules.

import { fetchTranscript } from "./transcript.js";
import { extractVideoId, extractVideoIdFromPage } from "./videoid.js";
import { createCrosswalk } from "./crosswalk.js";
import { createPlaybackTracker } from "./playback-sync.js";
import { resolveSpeaker, formatSpeaker } from "./identify.js";
import { loadDataset } from "./datasets.js";
import { indexTrades, recentTrades } from "./trades.js";
import {
  ensureOverlay,
  showSpeaker,
  showContributors,
  showContributorsStatus,
  showTrades,
  showTradesStatus,
} from "./overlay.js";

const TAG = "[SeeSpan]";

async function loadCrosswalk() {
  const res = await fetch(chrome.runtime.getURL("data/crosswalk.json"));
  if (!res.ok) throw new Error(`crosswalk load failed: HTTP ${res.status}`);
  const data = await res.json();
  return createCrosswalk(data.entries);
}

// The C-SPAN player can mount its <video> after document_idle; poll briefly.
function waitForVideo({ timeoutMs = 20000, intervalMs = 500 } = {}) {
  return new Promise((resolve) => {
    const existing = document.querySelector("video");
    if (existing) return resolve(existing);
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      const v = document.querySelector("video");
      if (v || Date.now() > deadline) {
        clearInterval(timer);
        resolve(v || null);
      }
    }, intervalMs);
  });
}

// Resolve the video id from the URL, falling back to the player's HLS source
// in the page (archived sessions redirect to a date chronicle with no URL id).
// The HLS source appears only after the player initializes, so retry briefly.
async function resolveVideoId({ tries = 20, intervalMs = 500 } = {}) {
  const fromUrl = extractVideoId(location.href);
  if (fromUrl) return fromUrl;
  for (let i = 0; i < tries; i++) {
    const fromPage = extractVideoIdFromPage(document.documentElement.innerHTML);
    if (fromPage) return fromPage;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function main() {
  const video = await waitForVideo();
  if (!video) {
    console.log(`${TAG} no <video> element found — idle`);
    return;
  }

  const videoId = await resolveVideoId();
  if (!videoId) {
    console.log(`${TAG} could not resolve a videoId — idle`);
    return;
  }

  console.log(`${TAG} videoId=${videoId} — fetching transcript…`);
  const [{ windows, hasTagging, disclaimer }, crosswalk] = await Promise.all([
    fetchTranscript(videoId),
    loadCrosswalk(),
  ]);

  if (windows.length === 0) {
    console.log(`${TAG} empty transcript — nothing to identify`);
    return;
  }
  console.log(
    `${TAG} ${windows.length} windows, hasTagging=${hasTagging}` +
      (hasTagging ? "" : " — surname fallback path (low confidence)"),
  );
  if (disclaimer) console.log(`${TAG} ${disclaimer}`);

  // Financial datasets: pre-built JSON the extension READS (no live APIs, no
  // user keys). Bundled snapshot in dev; hosted + daily-cached in production
  // (src/datasets.js). Loaded once; speaker lookups are synchronous.
  const overlay = ensureOverlay();
  const [contribData, tradesData] = await Promise.all([
    loadDataset("contributions").catch((e) => {
      console.log(`${TAG} contributions dataset unavailable: ${e.message}`);
      return null;
    }),
    loadDataset("trades").catch((e) => {
      console.log(`${TAG} trades dataset unavailable: ${e.message}`);
      return null;
    }),
  ]);
  const contribMembers = (contribData && contribData.members) || {};
  const tradesIndex = tradesData ? indexTrades(tradesData) : new Map();

  function showFinancials(entry) {
    const c = contribMembers[entry.bioguide_id];
    if (c && c.contributors && c.contributors.length) {
      console.log(
        `${TAG} top contributors for ${entry.full_name}: ` +
          c.contributors.map((x) => `${x.name} $${x.total.toLocaleString()}`).join("; "),
      );
      showContributors(overlay, { contributors: c.contributors });
    } else {
      showContributorsStatus(overlay, "No contributor data.");
    }
    const trades = recentTrades(tradesIndex, entry.bioguide_id);
    if (trades.length) {
      console.log(`${TAG} ${trades.length} recent trade(s) for ${entry.full_name}`);
      showTrades(overlay, { trades });
    } else {
      showTradesStatus(overlay, "No recent disclosed trades.");
    }
  }

  const tracker = createPlaybackTracker({
    getCurrentTime: () => video.currentTime,
    windows,
    onSpeakerChange: (w, t) => {
      const resolution = resolveSpeaker(crosswalk, w);
      console.log(`${TAG} ${formatSpeaker(w, resolution, t)}`);
      const entry = resolution && resolution.entry;
      if (!entry) return;
      showSpeaker(overlay, {
        title: entry.chamber === "senate" ? "Sen." : entry.chamber === "house" ? "Rep." : "",
        fullName: entry.full_name,
        party: entry.party,
        state: entry.state,
        confidence: resolution.confidence,
      });
      showFinancials(entry);
    },
  });

  tracker.start();
  video.addEventListener("emptied", () => tracker.stop(), { once: true });
  console.log(`${TAG} tracking started — play the video to see speakers.`);
}

main().catch((err) => console.error(`${TAG} fatal:`, err));
