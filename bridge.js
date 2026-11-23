// ShipCube Bot - relay between the page script and the extension (so the
// bot can reach your Google Sheet without ShipHero's page blocking it).
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.__shipcube !== "req") return;
  const { id, url, body } = e.data;
  try {
    chrome.runtime.sendMessage({ type: "sheet", url, body }, (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage({ __shipcube: "res", id, res: res || { ok: false, error: err ? err.message : "no reply" } }, "*");
    });
  } catch (er) {
    window.postMessage({ __shipcube: "res", id, res: { ok: false, error: "Extension was updated — refresh this page (" + er.message + ")" } }, "*");
  }
});

// Team settings: a "team-settings.json" file in the bot folder is shared with every PC
// that has this folder, so nobody has to set the bot up again.
let __teamSettings;
const __teamReady = fetch(chrome.runtime.getURL("team-settings.json"))
  .then((r) => (r.ok ? r.json() : null)).catch(() => null)
  .then((d) => { __teamSettings = d; window.postMessage({ __shipcube: "team", data: d }, "*"); });
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.__shipcube !== "getTeam") return;
  __teamReady.then(() => window.postMessage({ __shipcube: "team", data: __teamSettings || null }, "*"));
});

// Close this tab when the bot asks (after the batch is saved) - only the extension may close tabs.
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.__shipcube !== "closeTab") return;
  try { chrome.runtime.sendMessage({ type: "closeTab" }); } catch (er) {}
});

// Downloads: the page asks, the extension renames/saves the PDFs.
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.__shipcube !== "dl") return;
  const { id, payload } = e.data;
  try {
    chrome.runtime.sendMessage(Object.assign({ type: "dl" }, payload), (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage({ __shipcube: "dlres", id, res: res || { ok: false, error: err ? err.message : "no reply" } }, "*");
    });
  } catch (er) {
    window.postMessage({ __shipcube: "dlres", id, res: { ok: false, error: "Extension was updated — refresh this page" } }, "*");
  }
});

// Sheet queue (open the batch links one after another)
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.__shipcube !== "queue") return;
  const { id, payload } = e.data;
  try {
    chrome.runtime.sendMessage(Object.assign({ type: "queue" }, payload), (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage({ __shipcube: "queueres", id, res: res || { ok: false, error: err ? err.message : "no reply" } }, "*");
    });
  } catch (er) {
    window.postMessage({ __shipcube: "queueres", id, res: { ok: false, error: "Extension was updated — refresh this page" } }, "*");
  }
});

// v2: generic relay (Single Orders jobs, bot clock) - the page asks, the background answers
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.__shipcube !== "rt") return;
  const { id, payload } = e.data;
  try {
    chrome.runtime.sendMessage(payload, (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage({ __shipcube: "rtres", id, res: res || { ok: false, error: err ? err.message : "no reply" } }, "*");
    });
  } catch (er) {
    window.postMessage({ __shipcube: "rtres", id, res: { ok: false, error: "Extension was updated — refresh this page" } }, "*");
  }
});

// v2: the side panel uses the same Google Sheet link + password as the in-page settings (first time only)
try {
  const pageSheet = JSON.parse(localStorage.getItem("shipcubeBot.sheet") || "{}");
  if (pageSheet && pageSheet.url) chrome.storage.local.get("cfg", (r) => {
    const c = (r && r.cfg) || {};
    if (!c.url) chrome.storage.local.set({ cfg: Object.assign({}, c, { url: pageSheet.url, token: pageSheet.token || "shipcube" }) });
  });
} catch (er) {}

// v2: buttons in the side panel for this ShipHero tab (Fill box now, Pick now, Settings…)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "pageCmd") return;
  window.postMessage({ __shipcube: "cmd", cmd: msg.cmd }, "*");
  sendResponse({ ok: true });
});
// v2: the Bulk Ship switches live in the side panel; they are copied into this page's settings
const PFLAGS = ["shipcubeBot.auto", "shipcubeBot.rows", "shipcubeBot.pickloc", "shipcubeBot.selall", "shipcubeBot.waitstatus",
  "shipcubeBot.autogen", "shipcubeBot.autoclose", "shipcubeBot.statusRounds", "shipcubeBot.autodl"];
function applyPflags(f) { if (!f) return; PFLAGS.forEach((k) => { if (f[k] != null) { try { localStorage.setItem(k, String(f[k])); } catch (er) {} } }); }
try {
  if (/(^|\.)shipping\.shiphero\.com$/.test(location.hostname)) {
    chrome.storage.local.get("pflags", (r) => {
      const f = (r && r.pflags) || {};
      const seed = {}; let need = false;
      PFLAGS.forEach((k) => { if (f[k] == null) { const v = localStorage.getItem(k); if (v != null) { seed[k] = v; need = true; } } });
      if (need) chrome.storage.local.set({ pflags: Object.assign({}, seed, f) });
      applyPflags(f);
    });
    chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.pflags) applyPflags(ch.pflags.newValue); });
  }
} catch (er) {}
