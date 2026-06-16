// Resolve C-SPAN's numeric video id for the current page.
//
// Two layers, because C-SPAN's URLs are inconsistent:
//   1. From the URL, when it carries the id:
//        /program/us-senate/senate-session/680931   → trailing path segment
//        /video/?680809-1/senate-session            → leading query token
//   2. From the page, when it doesn't: archived sessions redirect to a date
//      chronicle (/congress/?chamber=senate&date=YYYY-MM-DD) that has no id in
//      the URL, but the JWPlayer HLS source still references the real id, e.g.
//      https://m3u8-1.c-spanvideo.org/program/program.680931.clean.m3u8

export function extractVideoId(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  // /video/?680809-1/... — id is the leading run of digits in the query.
  if (url.pathname.includes("/video")) {
    const m = url.search.match(/\b(\d{3,})/);
    if (m) return m[1];
  }

  // /program/.../680931 — id is the trailing numeric path segment.
  const pathMatch = url.pathname.match(/\/(\d{3,})\/?$/);
  if (pathMatch) return pathMatch[1];

  // No id in the URL (e.g. the date-chronicle redirect). Caller should fall
  // back to extractVideoIdFromPage. NOTE: deliberately no generic
  // "any number in the query" fallback — that wrongly grabs the year out of
  // ?date=2026-06-15.
  return null;
}

// Scan page HTML for the C-SPAN video-host reference that carries the id.
// Matches both the m3u8 filename (program.<id>.clean.m3u8 / .tsc.m3u8) and the
// bare c-spanvideo.org/program/program.<id> form.
export function extractVideoIdFromPage(html) {
  if (typeof html !== "string") return null;
  const m =
    html.match(/c-spanvideo\.org\/program\/program\.(\d{3,})/i) ||
    html.match(/program\.(\d{3,})\.[a-z]*\.?m3u8/i);
  return m ? m[1] : null;
}
