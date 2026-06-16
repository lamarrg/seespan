// FEC OpenFEC client (PROJECT.md §5.1 — contributions).
//
// Two real-world facts drive the design (verified live 2026-06-15):
//   - There is no good pre-aggregated "top contributors" endpoint. by_employer
//     is dominated by NOT EMPLOYED / SELF EMPLOYED / N/A; raw top-by-amount
//     surfaces non-individual receipts (transfers, brokerage entries) far above
//     the individual limit. So we query individual contributions for the recent
//     cycle, sorted by amount, and aggregate by contributor name client-side.
//   - The crosswalk has fec_candidate_id but not fec_committee_id; resolve the
//     principal committee at runtime (cached).
//
// IO is injectable (fetchImpl) and the aggregation is pure, so both are testable.

const FEC_BASE = "https://api.open.fec.gov/v1";

export function buildFecUrl(path, params, apiKey) {
  const q = new URLSearchParams({ ...params, api_key: apiKey });
  return `${FEC_BASE}${path}?${q.toString()}`;
}

async function fetchFecJson(url, fetchImpl, label) {
  const res = await fetchImpl(url);
  const body = await res.text();
  if (!res.ok || body.trim() === "") {
    throw new Error(
      `FEC ${label} failed: HTTP ${res.status}` +
        (res.status === 429 ? " (rate limited — check your api.data.gov key)" : ""),
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`FEC ${label} returned non-JSON (HTTP ${res.status})`);
  }
}

// Resolve a candidate's principal campaign committee + most recent cycle.
export async function resolveCommittee(candidateId, { apiKey, fetchImpl = fetch }) {
  const url = buildFecUrl(
    `/candidate/${candidateId}/committees/`,
    { designation: "P", per_page: 20 },
    apiKey,
  );
  const json = await fetchFecJson(url, fetchImpl, `committees(${candidateId})`);
  const results = json.results || [];
  if (results.length === 0) return null;

  // Prefer the principal committee active in the most recent cycle.
  let best = null;
  let bestCycle = -Infinity;
  for (const c of results) {
    const cycle = Math.max(0, ...(c.cycles || []));
    if (cycle > bestCycle) {
      best = c;
      bestCycle = cycle;
    }
  }
  return { committeeId: best.committee_id, name: best.name, latestCycle: bestCycle || null };
}

// Pure: aggregate raw Schedule A records by contributor, summing amounts and
// dropping null/zero amounts (memo/other receipt types). Keeps the most recent
// employer/occupation seen for each contributor.
export function aggregateContributors(records, topN = 5) {
  const byName = new Map();
  for (const r of records || []) {
    const amount = Number(r.contribution_receipt_amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const name = (r.contributor_name || "").trim();
    if (!name) continue;
    const key = name.toUpperCase();
    const cur =
      byName.get(key) ||
      { name, total: 0, count: 0, employer: null, occupation: null };
    cur.total += amount;
    cur.count += 1;
    if (!cur.employer && r.contributor_employer) cur.employer = r.contributor_employer;
    if (!cur.occupation && r.contributor_occupation) cur.occupation = r.contributor_occupation;
    byName.set(key, cur);
  }
  return [...byName.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
    .map((c) => ({ ...c, total: Math.round(c.total) }));
}

// Fetch + aggregate top individual contributors for a committee/cycle.
export async function fetchTopContributors(
  committeeId,
  { apiKey, fetchImpl = fetch, cycle, pageSize = 30, topN = 5 } = {},
) {
  const params = {
    committee_id: committeeId,
    is_individual: "true",
    sort: "-contribution_receipt_amount",
    per_page: pageSize,
  };
  if (cycle) params.two_year_transaction_period = cycle;
  const url = buildFecUrl(`/schedules/schedule_a/`, params, apiKey);
  const json = await fetchFecJson(url, fetchImpl, `schedule_a(${committeeId})`);
  return aggregateContributors(json.results || [], topN);
}

// Convenience: candidate_id → committee → top contributors.
// Returns { committee, contributors } or null if no committee resolves.
export async function getContributorsForCandidate(candidateId, opts) {
  const committee = await resolveCommittee(candidateId, opts);
  if (!committee) return null;
  const contributors = await fetchTopContributors(committee.committeeId, {
    ...opts,
    cycle: committee.latestCycle,
  });
  return { committee, contributors };
}
