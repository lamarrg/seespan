// Overlay UI (PROJECT.md §6.3 component 6, §7, §8).
//
// Unobtrusive shadow-DOM panel pinned to a corner of the player. Shows a
// glanceable headline (speaker name/title/state/party + confidence) that
// expands — on hover (peek) or click (pin) — to reveal top FEC contributors.
// Draggable to reposition; dismissible; position/collapsed state persisted to
// chrome.storage. Shadow DOM isolates it from C-SPAN's page styles.
//
// Honesty (§7): FEC contributions are PRECISE. Estimated data (net worth,
// Phase 3) gets its own visually-distinct section when added — not here yet.

import { formatTrade } from "./trades.js";

const OVERLAY_ID = "seespan-overlay";
const PREFS_KEY = "overlayPrefs";

// ---- pure helpers (unit-tested) --------------------------------------------

function informative(s) {
  const v = (s || "").trim();
  return v && !/^(n\/a|not employed|self employed|none|information requested|requested)$/i.test(v)
    ? v
    : "";
}

export function formatContributor(c) {
  const amount = `$${Number(c.total).toLocaleString()}`;
  const detail = informative(c.employer) || informative(c.occupation);
  return detail ? `${c.name} — ${amount} · ${detail}` : `${c.name} — ${amount}`;
}

// Keep a point within the viewport (drag clamp).
export function clampPosition(left, top, width, height, vw, vh, margin = 8) {
  const maxLeft = Math.max(margin, vw - width - margin);
  const maxTop = Math.max(margin, vh - height - margin);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
}

// ---- prefs persistence (graceful; browser-only) ----------------------------

async function loadPrefs() {
  try {
    const got = await chrome.storage.local.get(PREFS_KEY);
    return got[PREFS_KEY] || {};
  } catch {
    return {};
  }
}

function savePrefs(patch) {
  try {
    chrome.storage.local.get(PREFS_KEY).then((got) => {
      chrome.storage.local.set({ [PREFS_KEY]: { ...(got[PREFS_KEY] || {}), ...patch } });
    });
  } catch {
    /* no-op outside the extension */
  }
}

// ---- DOM -------------------------------------------------------------------

const STYLE = `
  :host { all: initial; }
  .panel { font: 13px/1.45 -apple-system, system-ui, sans-serif; color:#f2f2f2;
    background:rgba(18,20,26,.95); border:1px solid rgba(255,255,255,.12);
    border-radius:10px; box-shadow:0 8px 28px rgba(0,0,0,.45);
    overflow:hidden; backdrop-filter:saturate(1.2) blur(2px); }
  .bar { display:flex; align-items:center; gap:7px; padding:8px 10px;
    cursor:grab; user-select:none; }
  .bar.dragging { cursor:grabbing; }
  .name { font-weight:600; font-size:14px; white-space:nowrap; }
  .meta { color:#9aa0aa; font-size:12px; white-space:nowrap; }
  .grow { flex:1 1 auto; }
  .badge { font-size:10px; padding:1px 6px; border-radius:8px; white-space:nowrap; }
  .badge.low  { background:#5a3d00; color:#ffcf66; }
  .badge.high { background:#0d3a1f; color:#7ee2a8; }
  .iconbtn { cursor:pointer; color:#9aa0aa; background:none; border:none;
    font-size:13px; line-height:1; padding:2px 3px; border-radius:5px; }
  .iconbtn:hover { color:#fff; background:rgba(255,255,255,.1); }
  .body { display:none; padding:0 10px 10px; }
  .panel.expanded .body, .panel.peek .body { display:block; }
  .sec h4 { margin:6px 0 4px; font-size:10px; text-transform:uppercase;
    letter-spacing:.05em; color:#8a909a; font-weight:700; }
  ul { margin:0; padding:0; list-style:none; }
  li { padding:3px 0; border-bottom:1px solid rgba(255,255,255,.06); font-size:12.5px; }
  li:last-child { border-bottom:none; }
  .amt { color:#7ee2a8; }
  .caveat { margin-top:7px; color:#727884; font-size:10px; line-height:1.35; }
  .status { color:#9aa0aa; font-style:italic; font-size:12px; padding:2px 0; }
`;

// `anchor` (the <video> element) sets the default position: the overlay's
// top-right corner is placed at the video's top-right corner (a saved drag
// position takes precedence). Always clamped to the viewport.
export function ensureOverlay({ anchor = null } = {}) {
  let host = document.getElementById(OVERLAY_ID);
  if (host) return host;

  host = document.createElement("div");
  host.id = OVERLAY_ID;
  Object.assign(host.style, {
    position: "fixed", top: "16px", right: "16px",
    zIndex: "2147483647", width: "300px", maxWidth: "92vw",
  });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${STYLE}</style>
    <div class="panel collapsed">
      <div class="bar">
        <span class="name">—</span>
        <span class="meta"></span>
        <span class="badge" hidden></span>
        <span class="grow"></span>
        <button class="iconbtn toggle" title="Expand" aria-label="Expand">▸</button>
        <button class="iconbtn close" title="Hide" aria-label="Hide">✕</button>
      </div>
      <div class="body"><div class="sec contrib"></div><div class="sec trades"></div></div>
    </div>`;
  document.body.appendChild(host);
  wireInteractions(host);
  restorePrefs(host, anchor);
  return host;
}

function panel(host) {
  return host.shadowRoot.querySelector(".panel");
}

// Re-clamp the panel's current position to the viewport (after a size change
// from expanding, a hover-peek, or a window resize) so the whole panel stays
// within the visible page.
function reclamp(host) {
  const r = host.getBoundingClientRect();
  if (r.width < 2) return;
  const { left, top } = clampPosition(
    r.left, r.top, r.width, r.height, window.innerWidth, window.innerHeight,
  );
  Object.assign(host.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
}

function setExpanded(host, expanded, persist = true) {
  const p = panel(host);
  p.classList.toggle("expanded", expanded);
  p.classList.toggle("collapsed", !expanded);
  const toggle = host.shadowRoot.querySelector(".toggle");
  toggle.textContent = expanded ? "▾" : "▸";
  toggle.title = expanded ? "Collapse" : "Expand";
  if (persist) savePrefs({ collapsed: !expanded });
}

function wireInteractions(host) {
  const s = host.shadowRoot;
  const p = panel(host);

  s.querySelector(".toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    setExpanded(host, p.classList.contains("collapsed"));
    reclamp(host); // expanding may grow past the bottom edge
  });

  s.querySelector(".close").addEventListener("click", (e) => {
    e.stopPropagation();
    host.dataset.dismissed = "1";
    host.style.display = "none";
  });

  // Hover peek: temporarily reveal the body while collapsed.
  const bar = s.querySelector(".bar");
  p.addEventListener("mouseenter", () => {
    if (p.classList.contains("collapsed")) {
      p.classList.add("peek");
      reclamp(host);
    }
  });
  p.addEventListener("mouseleave", () => p.classList.remove("peek"));

  // Keep the panel on-screen if the window resizes.
  window.addEventListener("resize", () => reclamp(host));

  // Drag to reposition (bar is the handle; ignore button clicks).
  let drag = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const rect = host.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height, moved: false };
    bar.classList.add("dragging");
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.moved = true;
    const { left, top } = clampPosition(
      e.clientX - drag.dx, e.clientY - drag.dy, drag.w, drag.h,
      window.innerWidth, window.innerHeight,
    );
    Object.assign(host.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
  });
  bar.addEventListener("pointerup", (e) => {
    if (!drag) return;
    bar.classList.remove("dragging");
    if (drag.moved) {
      host.dataset.moved = "1"; // stop auto-snapping to the video
      const r = host.getBoundingClientRect();
      savePrefs({ left: r.left, top: r.top });
    }
    drag = null;
  });
}

const ANCHOR_MARGIN = 12;

function place(host, left, top) {
  const c = clampPosition(
    left, top, host.offsetWidth || 300, host.offsetHeight || 60,
    window.innerWidth, window.innerHeight,
  );
  Object.assign(host.style, { left: `${c.left}px`, top: `${c.top}px`, right: "auto", bottom: "auto" });
}

// Place the overlay's top-right corner at the anchor's (video's) top-right.
// Returns false if the anchor has no layout yet.
function snapToAnchor(host, anchor) {
  const r = anchor.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  place(host, r.right - (host.offsetWidth || 300) - ANCHOR_MARGIN, r.top + ANCHOR_MARGIN);
  return true;
}

function inViewport(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
}

// The C-SPAN player usually loads below the fold, so the "top-right of video"
// default can't apply until the user scrolls to it. Snap there the first time
// the video is on-screen — unless the user has moved or dismissed the panel.
function snapWhenAnchorVisible(host, anchor) {
  if (typeof IntersectionObserver === "undefined") return;
  const io = new IntersectionObserver((entries, obs) => {
    if (host.dataset.moved === "1" || host.dataset.dismissed === "1") return obs.disconnect();
    if (entries.some((e) => e.isIntersecting)) {
      snapToAnchor(host, anchor);
      obs.disconnect();
    }
  }, { threshold: 0.01 });
  io.observe(anchor);
}

async function restorePrefs(host, anchor) {
  const prefs = await loadPrefs();
  // Default collapsed (glanceable); honor a saved expanded preference.
  setExpanded(host, prefs.collapsed === false, false);

  if (typeof prefs.left === "number" && typeof prefs.top === "number") {
    place(host, prefs.left, prefs.top); // saved drag position wins
    host.dataset.moved = "1"; // don't auto-snap over it
    return;
  }

  // Default: top-right of the video. If the video is off-screen (below the
  // fold), park top-right of the viewport and snap once it scrolls into view.
  if (anchor && inViewport(anchor)) {
    snapToAnchor(host, anchor);
  } else {
    place(host, window.innerWidth - (host.offsetWidth || 300) - 16, 16);
  }
  if (anchor) snapWhenAnchorVisible(host, anchor);
}

// ---- render (called by content-main on speaker change) ---------------------

export function showSpeaker(host, { title, fullName, party, state, confidence }) {
  // Re-show on a new speaker unless the user explicitly dismissed it.
  if (host.dataset.dismissed !== "1") host.style.display = "";
  const s = host.shadowRoot;
  s.querySelector(".name").textContent = [title, fullName].filter(Boolean).join(" ");
  s.querySelector(".meta").textContent = party && state ? `${party}-${state}` : state || "";
  const badge = s.querySelector(".badge");
  if (confidence === "low") {
    badge.hidden = false; badge.className = "badge low"; badge.textContent = "fuzzy match";
  } else if (confidence === "high") {
    badge.hidden = false; badge.className = "badge high"; badge.textContent = "confirmed";
  } else {
    badge.hidden = true;
  }
  s.querySelector(".contrib").innerHTML = "";
  s.querySelector(".trades").innerHTML = "";
}

export function showContributorsStatus(host, message) {
  host.shadowRoot.querySelector(".contrib").innerHTML =
    `<h4>Top contributors</h4><div class="status">${escapeHtml(message)}</div>`;
}

export function showContributors(host, { contributors }) {
  const items = (contributors || [])
    .map((c) => `<li>${escapeHtml(formatContributor(c))}</li>`)
    .join("");
  host.shadowRoot.querySelector(".contrib").innerHTML =
    `<h4>Top contributors</h4><ul>${items}</ul>` +
    `<div class="caveat">FEC itemized individual contributions, aggregated by donor. ` +
    `Attributed to individuals &amp; their employer, not the organization.</div>`;
}

export function showTradesStatus(host, message) {
  host.shadowRoot.querySelector(".trades").innerHTML =
    `<h4>Recent trades</h4><div class="status">${escapeHtml(message)}</div>`;
}

export function showTrades(host, { trades }) {
  const items = (trades || [])
    .map((t) => `<li>${escapeHtml(formatTrade(t))}</li>`)
    .join("");
  host.shadowRoot.querySelector(".trades").innerHTML =
    `<h4>Recent trades</h4><ul>${items}</ul>` +
    `<div class="caveat">Disclosed as amount ranges; filed up to 45 days after the trade.</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
