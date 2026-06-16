// Browser smoke test (Phase 1 / M6).
//
// Loads the ACTUAL unpacked extension into the system Chrome and opens a live
// C-SPAN program page, capturing the [SeeSpan] console output. Exercises the
// full in-browser pipeline Node tests can't: videoId extraction, same-origin
// transcript fetch (real browser → no CloudFront 403), crosswalk load via
// chrome.runtime.getURL, and the playback tracker.
//
// Chrome notes (as of Chrome 149):
//   - C-SPAN's CDN 403s headless Chrome, so this runs HEADFUL with a normal UA.
//   - `--load-extension` is disabled since Chrome 137; instead the extension is
//     loaded at runtime via CDP `Extensions.loadUnpacked`
//     (requires --enable-unsafe-extension-debugging).
//
// Dev tooling only — uses puppeteer-core against installed Chrome (no download).
//   node scripts/smoke-browser.mjs [pageUrl]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PAGE_URL =
  process.argv[2] ||
  "https://www.c-span.org/program/us-senate/senate-session/680931";
const SEEK_TARGETS = [180, 600, 1200];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const def = puppeteer.defaultArgs();
  const dfFeat = def.find((a) => a.startsWith("--disable-features="));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: mkdtempSync(join(tmpdir(), "seespan-smoke-")),
    protocolTimeout: 180000,
    // Drop puppeteer's --disable-extensions (kills all extensions).
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--enable-unsafe-extension-debugging", // enables CDP Extensions domain
      "--disable-blink-features=AutomationControlled",
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const seespan = [];
  try {
    // Load the unpacked extension at runtime (Chrome 137+ ignores --load-extension).
    const session = await browser.target().createCDPSession();
    const { id } = await session.send("Extensions.loadUnpacked", { path: ROOT });
    console.log("Extension loaded, id =", id);

    // No key seeding — financial data is read from the bundled datasets.
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes("[SeeSpan]")) {
        seespan.push(t);
        console.log("  »", t);
      }
    });
    page.on("pageerror", (e) => console.log("  ! pageerror:", e.message));

    console.log(`Opening ${PAGE_URL} …`);
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("URL after load:", page.url());
    const hasVideo = await page
      .waitForSelector("video", { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    console.log("HAS VIDEO:", hasVideo);

    await sleep(8000); // let the content script finish transcript + crosswalk fetch

    // Drive playback time so the tracker fires speaker changes. Non-blocking:
    // never await play() (it can hang on the HLS stream).
    for (const t of SEEK_TARGETS) {
      await page.evaluate((target) => {
        const v = document.querySelector("video");
        if (!v) return;
        v.muted = true;
        v.play().catch(() => {});
        try { v.currentTime = target; } catch {}
      }, t);
      await sleep(3000);
    }

    // Read the overlay (shadow DOM is open, so the main world can see it).
    const overlayText = await page.evaluate(() => {
      const h = document.getElementById("seespan-overlay");
      return h && h.shadowRoot ? h.shadowRoot.textContent.replace(/\s+/g, " ").trim() : null;
    });

    // Screenshot the collapsed (default) then expanded overlay states.
    async function shootOverlay(name) {
      const box = await page.evaluate(() => {
        const h = document.getElementById("seespan-overlay");
        if (!h || h.style.display === "none") return null;
        const r = h.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      });
      if (!box || box.width < 2) return console.log(`(no overlay to shoot for ${name})`);
      const pad = 14;
      await page.screenshot({
        path: `/tmp/seespan-${name}.png`,
        clip: {
          x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
          width: Math.min(box.width + pad * 2, 800), height: Math.min(box.height + pad * 2, 600),
        },
      });
      console.log(`screenshot: /tmp/seespan-${name}.png`);
    }
    await shootOverlay("collapsed");
    // Expand by clicking the toggle inside the shadow DOM.
    await page.evaluate(() => {
      const h = document.getElementById("seespan-overlay");
      h?.shadowRoot.querySelector(".toggle")?.click();
    });
    await sleep(400);
    await shootOverlay("expanded");

    const has = (re) => seespan.some((l) => re.test(l));
    const startupOk =
      has(/loader injected/) &&
      has(/fetching transcript/) &&
      has(/windows, hasTagging=/);
    const speakerLines = seespan.filter((l) => /\] \[\d{2}:\d{2}:\d{2}\]/.test(l));
    const contributorsLogged = has(/top contributors for/);

    console.log("\n── Result ──");
    console.log("loader injected:        ", has(/loader injected/));
    console.log("startup pipeline ran:   ", startupOk);
    console.log("speaker-change lines:   ", speakerLines.length);
    console.log("contributors fetched:   ", contributorsLogged);
    console.log("overlay text:           ", overlayText || "(no overlay)");
    console.log("total [SeeSpan] logs:   ", seespan.length);
    if (!startupOk) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exitCode = 1;
});
