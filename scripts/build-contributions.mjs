// Build data/contributions.json — the pre-aggregated top-contributors dataset
// the extension reads (no runtime FEC calls, no user API key).
//
// This is the "external build job" (decisions.md [2026-06-16]): it holds ONE
// FEC key (env FEC_API_KEY, falling back to the rate-limited DEMO_KEY) and
// reuses src/fec.js to resolve each member's committee + top donors, keyed by
// bioguide_id. Re-run on a schedule (daily-to-weekly) and publish the file.
//
// Usage:
//   node scripts/build-contributions.mjs [--limit N] [--senate]
//
// The FEC key is read from a gitignored .env at the repo root (FEC_API_KEY=...),
// so you set it once. An inline env var still wins if you prefer:
//   FEC_API_KEY=xxxx node scripts/build-contributions.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getContributorsForCandidate } from "../src/fec.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env (repo root) if present — values already in the environment win.
const ENV_PATH = join(ROOT, ".env");
if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

const API_KEY = process.env.FEC_API_KEY || "DEMO_KEY";
if (!process.env.FEC_API_KEY) {
  console.warn(
    "⚠ No FEC_API_KEY found (.env at repo root or env var). Falling back to DEMO_KEY,\n" +
      "  which is rate-limited (~30/hr) and cannot build the full member list.\n" +
      "  Get a free key at https://api.data.gov/signup/ and put it in .env: FEC_API_KEY=...\n",
  );
} else if (/your_key_here|^\s*$/.test(process.env.FEC_API_KEY)) {
  console.error("✖ FEC_API_KEY in .env is still the placeholder — edit it with your real key.");
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const LIMIT = Number(arg("--limit", "0")) || Infinity;
const SENATE_ONLY = process.argv.includes("--senate");
const FRESH = process.argv.includes("--fresh"); // ignore existing file, rebuild from scratch

const OUT_PATH = join(ROOT, "data", "contributions.json");
const RETRY_WAIT_MS = 60_000; // on a 429, wait this long then retry the same member
const MAX_RETRY_WAITS = 30; // give up after this many consecutive rate-limit waits

// api.data.gov's practical ceiling is hit well before the nominal 1,000/hr and
// the full roster is ~2 calls/member > 1,000 calls, so a single run can't finish
// inside one rate window. The builder is therefore RESUMABLE: it loads whatever's
// already in contributions.json, skips those members, and on a 429 it saves
// progress, waits, and retries — so re-running (or one long background run) walks
// the roster across rate-limit windows without losing or re-fetching work.

async function loadExisting() {
  if (FRESH || !existsSync(OUT_PATH)) return {};
  try {
    return JSON.parse(await readFile(OUT_PATH, "utf8")).members || {};
  } catch {
    return {};
  }
}

async function save(out) {
  await mkdir(join(ROOT, "data"), { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    source: "FEC OpenFEC API (Schedule A, individual contributions aggregated by donor)",
    member_count: Object.keys(out).length,
    members: out,
  };
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
}

async function main() {
  const crosswalk = JSON.parse(await readFile(join(ROOT, "data", "crosswalk.json"), "utf8"));
  let members = crosswalk.entries.filter((e) => e.fec_candidate_id);
  if (SENATE_ONLY) members = members.filter((e) => e.chamber === "senate");
  members = members.slice(0, LIMIT);

  const out = await loadExisting();
  const startCount = Object.keys(out).length;
  if (startCount) console.log(`Resuming — ${startCount} members already in contributions.json (skipping those).`);

  let processed = 0;
  let fetched = 0;
  let consecutive429 = 0;
  let stopped = null;

  outer: for (const m of members) {
    processed += 1;
    if (out[m.bioguide_id]) continue; // already have this one (resume)

    while (true) {
      try {
        const data = await getContributorsForCandidate(m.fec_candidate_id, { apiKey: API_KEY });
        if (data && data.contributors && data.contributors.length) {
          out[m.bioguide_id] = {
            full_name: m.full_name,
            committee_id: data.committee.committeeId,
            committee_name: data.committee.name,
            cycle: data.committee.latestCycle,
            contributors: data.contributors,
          };
          fetched += 1;
          if (fetched % 25 === 0) await save(out); // periodic checkpoint
        }
        consecutive429 = 0;
        process.stdout.write(
          `\r  ${processed}/${members.length} · have ${Object.keys(out).length} (${m.full_name})            `,
        );
        await sleep(800); // be gentle on the rate limit
        break;
      } catch (err) {
        if (/HTTP 429|rate limit/i.test(err.message)) {
          consecutive429 += 1;
          await save(out); // never lose progress to a rate limit
          if (consecutive429 > MAX_RETRY_WAITS) {
            stopped = `gave up after ${MAX_RETRY_WAITS} rate-limit waits — re-run later to continue`;
            break outer;
          }
          process.stdout.write(
            `\n  ⏳ rate limited — saved ${Object.keys(out).length} members; ` +
              `waiting ${RETRY_WAIT_MS / 1000}s then retrying ${m.full_name} ` +
              `(wait ${consecutive429}/${MAX_RETRY_WAITS})\n`,
          );
          await sleep(RETRY_WAIT_MS);
          continue; // retry the SAME member
        }
        // non-429 (no committee, etc.) — skip this member, keep going
        consecutive429 = 0;
        break;
      }
    }
  }
  process.stdout.write("\n");

  await save(out);
  const total = Object.keys(out).length;
  console.log(`Wrote data/contributions.json (${total} members; +${fetched} this run).`);
  if (stopped) console.log(`NOTE: ${stopped}`);
  else if (total < members.length)
    console.log(`NOTE: ${members.length - total} members have no resolvable committee/contributors (skipped).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
