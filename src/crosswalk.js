// Identity crosswalk (PROJECT.md §6.3 component 3).
//
// Maps C-SPAN identity → bioguide → FEC + financial-provider keys. Two resolve
// paths matching PROJECT.md §3.4:
//   - clean join:   personid → entry (happy path, high confidence)
//   - fuzzy fallback: all-caps speakername label → entry by surname (+ state),
//                     flagged low confidence.
//
// Data (data/crosswalk.json) is loaded by the caller — fetch() in the browser,
// fs in tests — and the parsed entries handed to createCrosswalk(). This keeps
// the module pure and testable.

// "MR. THUNE", "Senator Schumer", "Ms. Klobuchar" → "THUNE" / "SCHUMER" / ...
const HONORIFICS = /^(MR|MRS|MS|DR|SEN|SENATOR|REP|REPRESENTATIVE|THE)\b\.?\s*/i;

export function normalizeSurname(speakername) {
  if (typeof speakername !== "string") return null;
  let s = speakername.trim();
  // Strip a leading honorific (possibly repeated, e.g. "THE SENATOR FROM ...").
  while (HONORIFICS.test(s)) {
    const next = s.replace(HONORIFICS, "");
    if (next === s) break;
    s = next;
  }
  if (!s) return null;
  // Proper-name form ("Chuck Schumer") → last token; all-caps label
  // ("SCHUMER") → itself.
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens[tokens.length - 1].toUpperCase().replace(/[.,]/g, "");
}

export function createCrosswalk(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const byCspanId = new Map();
  const bySurname = new Map();

  for (const entry of list) {
    if (entry.cspan_personid != null) {
      byCspanId.set(String(entry.cspan_personid), entry);
    }
    const surnames = new Set();
    for (const alias of entry.aliases || []) {
      const sn = normalizeSurname(alias);
      if (sn) surnames.add(sn);
    }
    for (const sn of surnames) {
      if (!bySurname.has(sn)) bySurname.set(sn, []);
      bySurname.get(sn).push(entry);
    }
  }

  return { byCspanId, bySurname, all: list };
}

// Clean join via personid. Returns { entry, confidence:"high" } or null.
export function resolveByPersonId(crosswalk, personid) {
  if (personid == null) return null;
  const entry = crosswalk.byCspanId.get(String(personid));
  return entry ? { entry, confidence: "high", via: "personid" } : null;
}

// Fuzzy fallback via the all-caps speakername label.
// Disambiguates collisions (same surname, different members) by state when
// provided. Always flagged low confidence.
export function resolveBySpeakername(crosswalk, speakername, { state } = {}) {
  const surname = normalizeSurname(speakername);
  if (!surname) return null;
  const candidates = crosswalk.bySurname.get(surname);
  if (!candidates || candidates.length === 0) return null;

  if (candidates.length === 1) {
    return { entry: candidates[0], confidence: "low", via: "surname" };
  }
  if (state) {
    const byState = candidates.filter((c) => c.state === state);
    if (byState.length === 1) {
      return { entry: byState[0], confidence: "low", via: "surname+state" };
    }
  }
  // Ambiguous surname with no disambiguator — refuse to guess.
  return { entry: null, confidence: "ambiguous", via: "surname", candidates };
}
