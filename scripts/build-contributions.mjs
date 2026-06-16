// Build data/contributions.json — the pre-aggregated top-contributors dataset
// the extension reads (no runtime FEC calls, no user API key).
//
// This is the "external build job" (decisions.md [2026-06-16]): it holds ONE
// FEC key (env FEC_API_KEY, falling back to the rate-limited DEMO_KEY) and
// reuses src/fec.js to resolve each member's committee + top donors, keyed by
// bioguide_id. Re-run on a schedule (daily-to-weekly) and publish the file.
//
// Usage:
//   FEC_API_KEY=xxxx node scripts/build-contributions.mjs [--limit N] [--senate]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getContributorsForCandidate } from "../src/fec.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_KEY = process.env.FEC_API_KEY || "DEMO_KEY";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const LIMIT = Number(arg("--limit", "0")) || Infinity;
const SENATE_ONLY = process.argv.includes("--senate");

async function main() {
  const crosswalk = JSON.parse(
    await readFile(join(ROOT, "data", "crosswalk.json"), "utf8"),
  );
  let members = crosswalk.entries.filter((e) => e.fec_candidate_id);
  if (SENATE_ONLY) members = members.filter((e) => e.chamber === "senate");
  members = members.slice(0, LIMIT);

  const out = {};
  let done = 0;
  let stopped = null;
  for (const m of members) {
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
      }
      done += 1;
      process.stdout.write(`\r  ${done}/${members.length} (${m.full_name})            `);
      await sleep(800); // be gentle on the rate limit
    } catch (err) {
      if (/HTTP 429|rate limit/i.test(err.message)) {
        stopped = `rate limited after ${done} members — re-run later or use a real FEC key`;
        break;
      }
      // skip members that error (no committee, etc.) but keep going
    }
  }
  process.stdout.write("\n");

  const payload = {
    generated_at: new Date().toISOString(),
    source: "FEC OpenFEC API (Schedule A, individual contributions aggregated by donor)",
    member_count: Object.keys(out).length,
    members: out,
  };
  const outDir = join(ROOT, "data");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "contributions.json"), JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote data/contributions.json (${payload.member_count} members).`);
  if (stopped) console.log(`NOTE: ${stopped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
