// Build data/crosswalk.json from the unitedstates/congress-legislators project
// (public domain). One entry per current member of Congress, keyed for joining
// C-SPAN identity → bioguide → FEC + financial-provider names (PROJECT.md §4).
//
// Note on cspan ids: congress-legislators carries id.cspan, which empirically
// equals C-SPAN's transcript `personid` (verified: Schumer → 5929). Coverage is
// ~50% of current members; the remainder need manual resolution later
// (PROJECT.md §9 risk #2). Entries without a cspan id still resolve via the
// surname-alias fallback path.
//
// Source is the published JSON (the repo commits only YAML; JSON is built to
// the project's GitHub Pages site).
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE =
  "https://unitedstates.github.io/congress-legislators/legislators-current.json";

const PARTY = { Democrat: "D", Republican: "R", Independent: "I" };
const CHAMBER = { sen: "senate", rep: "house" };

function commonName(name) {
  return `${name.nickname || name.first} ${name.last}`.trim();
}

function honorific(gender) {
  return gender === "F" ? "MS." : "MR.";
}

function buildAliases(name, gender) {
  const last = name.last;
  const aliases = new Set([
    name.official_full || commonName(name),
    `${name.first} ${last}`,
    commonName(name),
    last,
    `${honorific(gender)} ${last}`.toUpperCase(),
    last.toUpperCase(),
  ]);
  return [...aliases].filter(Boolean);
}

function pickFecCandidateId(fecIds, chamber) {
  if (!Array.isArray(fecIds) || fecIds.length === 0) return null;
  const prefix = chamber === "senate" ? "S" : chamber === "house" ? "H" : null;
  if (prefix) {
    const match = fecIds.find((id) => id.startsWith(prefix));
    if (match) return match;
  }
  return fecIds[0];
}

function toEntry(leg) {
  const term = leg.terms[leg.terms.length - 1];
  const chamber = CHAMBER[term.type] || null;
  const fecIds = Array.isArray(leg.id.fec) ? leg.id.fec : [];
  const commonNameStr = commonName(leg.name);
  return {
    bioguide_id: leg.id.bioguide,
    full_name: leg.name.official_full || commonNameStr,
    cspan_personid: leg.id.cspan ?? null,
    fec_candidate_id: pickFecCandidateId(fecIds, chamber),
    fec_candidate_ids: fecIds,
    fec_committee_id: null, // resolved in Phase 2 via FEC /candidates/search/
    fmp_name: commonNameStr,
    quiver_name: commonNameStr,
    aliases: buildAliases(leg.name, leg.bio?.gender),
    party: PARTY[term.party] || term.party || null,
    state: term.state,
    chamber,
  };
}

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`source fetch failed: HTTP ${res.status}`);
  const legislators = await res.json();
  const entries = legislators.map(toEntry);

  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "crosswalk.json");

  const withCspan = entries.filter((e) => e.cspan_personid != null).length;
  const payload = {
    generated_at: new Date().toISOString(),
    source: SOURCE,
    count: entries.length,
    cspan_id_coverage: `${withCspan}/${entries.length}`,
    entries,
  };
  await writeFile(outPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${entries.length} entries to ${outPath} ` +
      `(cspan id coverage ${withCspan}/${entries.length})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
