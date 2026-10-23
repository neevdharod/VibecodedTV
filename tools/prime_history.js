// Reads your Prime Video watch history, for Queue's recommendations.
//
// Run it in a browser tab that is signed in to Amazon and open on
//     https://www.amazon.com/gp/video/settings/watch-history
// (paste it into the developer console, or have Claude run it in the browser pane). It scrolls the page
// until every entry has loaded, then returns JSON: [{"title", "date", "asin"}, ...], newest first.
// Save that as a file and run:  python3 -I tools/import_prime_history.py <file>
//
// It only reads the page you are on. Nothing is sent anywhere, and no account details are touched.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The page loads older entries as you scroll: keep going until the height stops growing.
  let last = -1;
  for (let i = 0; i < 200 && document.body.scrollHeight !== last; i++) {
    last = document.body.scrollHeight;
    window.scrollTo(0, last);
    await sleep(1200);
    const more = [...document.querySelectorAll("button, a")].find((b) => /^(show|see|load) more/i.test(b.textContent.trim()));
    if (more) { more.click(); await sleep(1500); last = -1; }
  }
  // Entries sit under date headings. Walk the page in order, remembering the last date seen, and take
  // every link to a title's detail page (its ASIN is in the link).
  const DATE = /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}$/;
  const DETAIL = /\/(?:gp\/video\/)?detail\/(?:[^/?#]*\/)?([A-Z0-9]{10})(?:[/?#]|$)/;
  const out = [];
  const seen = new Set();
  let date = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.currentNode; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent.trim();
      if (DATE.test(t)) date = t;
      continue;
    }
    if (n.tagName !== "A") continue;
    const m = (n.getAttribute("href") || "").match(DETAIL);
    const title = (n.getAttribute("aria-label") || n.textContent || "").replace(/\s+/g, " ").trim();
    if (!m || !title || /^(watch|play|resume|remove|delete|hide)\b/i.test(title)) continue;
    const key = m[1] + "|" + title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, date, asin: m[1] });
  }
  return JSON.stringify(out);
})();
