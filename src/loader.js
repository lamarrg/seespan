// SeeSpan content-script loader.
//
// MV3 classic content scripts cannot be ES modules directly (the manifest "js"
// array runs them in a classic script context). To keep the real logic as
// plain, Node-testable ES modules, we dynamic-import the entry point from an
// extension URL. content-main.js and its deps are exposed via
// web_accessible_resources in manifest.json.
console.log("[SeeSpan] loader injected on", location.href);
import(chrome.runtime.getURL("src/content-main.js")).catch((err) => {
  console.error("[SeeSpan] failed to load content-main:", err);
});
