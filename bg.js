// ShipCube Bot v2 - background
//  * sends rows to the Google Sheet's Apps Script web app (only Apps Script /exec links allowed)
//  * closes the ShipHero tab when the bot asks (after a batch is saved)
//  * renames label / packing-slip PDFs downloaded from a ShipHero batch page to
//    <batch>-l.pdf / <batch>-p.pdf and saves them into the Label Merger Inbox
const ALLOWED = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(\?.*)?$/;
const SHIPHERO = /^https:\/\/([a-z0-9-]+\.)*shiphero\.com\//i;

// ---- download state (kept in session storage so it survives the worker sleeping) ----
const S = chrome.storage.session;
async function getState() { return (await S.get("dl")).dl || { armed: null, intents: [], log: [] }; }
async function setState(st) { st.log = (st.log || []).slice(-30); await S.set({ dl: st }); }
function cleanFolder(f) {
  return String(f == null ? "LabelMerger/Inbox" : f).replace(/\\/g, "/").split("/")
    .map((x) => x.trim().replace(/[<>:"|?*]/g, "")).filter((x) => x && x !== "." && x !== "..").join("/");
}
function kindFromName(name) {
  const n = String(name || "").toLowerCase();
  if (/(packing|slip|invoice|pick[_ -]?list)/.test(n)) return "p";
  if (/(label|shipping|postage)/.test(n)) return "l";
  return null;
}

async function slipJobs() {
  const jobs = (await S.get("slips")).slips || {};
  Object.keys(jobs).forEach((k) => { if (Date.now() - jobs[k].at > 30 * 60000) delete jobs[k]; });
  return jobs;
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  (async () => {
    const st = await getState();
    const now = Date.now();
    const a0 = st.armed && now <= st.armed.until ? st.armed : null;
    const fromShipHero = SHIPHERO.test(item.referrer || "") || SHIPHERO.test(item.url || "") || /^blob:https:\/\/([a-z0-9-]+\.)*shiphero\.com\//i.test(item.url || "") ||
      (a0 && a0.tabUrl && (item.referrer || "").startsWith(a0.tabUrl.split("?")[0]));
    const isPdf = /pdf/i.test(item.mime || "") || /\.pdf($|\?)/i.test(item.filename || "") || /\.pdf($|\?)/i.test(item.url || "");
    const i = st.intents.findIndex((x) => now - x.at < 90000);
    const intent = i >= 0 ? st.intents[i] : null;
    // the batch comes from the click (each batch tab says which batch it is), else from the open batch page
    const a = intent && intent.batch ? { batch: intent.batch, folder: intent.folder != null ? intent.folder : (a0 ? a0.folder : undefined) } : a0;
    if (!a || !isPdf || !(fromShipHero || intent)) { suggest(); return; }
    // which file is it? 1) the button that was clicked  2) the file name  3) unknown
    let kind = null, how = "";
    if (intent) { kind = intent.kind; how = "button"; st.intents.splice(i, 1); }
    if (!kind) { kind = kindFromName(item.filename) || kindFromName(item.url); how = kind ? "file name" : ""; }
    if (!kind) {   // can't tell - keep it apart so it is never merged wrongly
      const f = cleanFolder(a.folder);
      const name = `${f}${f ? "/" : ""}${a.batch}-unknown-${(item.filename || "file.pdf").replace(/[\\/]/g, "_")}`;
      suggest({ filename: name, conflictAction: "uniquify" });
      st.log.push({ at: now, batch: a.batch, kind: "?", file: name, id: item.id, state: "started" });
      await setState(st); return;
    }
    const name = `${cleanFolder(a.folder)}${cleanFolder(a.folder) ? "/" : ""}${a.batch}-${kind}.pdf`;
    suggest({ filename: name, conflictAction: "overwrite" });
    st.log.push({ at: now, batch: a.batch, kind, how, file: name, id: item.id, state: "started" });
    await setState(st);
  })();
  return true;   // we call suggest() asynchronously
});
chrome.downloads.onChanged.addListener(async (d) => {
  if (!d.state && !d.error) return;
  const st = await getState();
  const e = st.log.find((x) => x.id === d.id);
  if (!e) return;
  if (d.state) e.state = d.state.current;
  if (d.state && d.state.current === "complete") { try { const [it] = await chrome.downloads.search({ id: d.id }); if (it) e.mime = it.mime; } catch {} }
  if (d.error) e.error = d.error.current;
  await setState(st);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "closeTab") {   // only ever closes the ShipHero tab that asked
    if (sender && sender.tab && SHIPHERO.test(sender.tab.url || sender.url || "")) chrome.tabs.remove(sender.tab.id);
    return;
  }
  if (msg.type === "dl") {
    (async () => {
      const st = await getState();
      if (msg.op === "arm") {          // a batch page is open: rename its PDFs for the next 30 min
        st.armed = { batch: String(msg.batch).replace(/\D/g, ""), folder: msg.folder, until: Date.now() + 30 * 60000, tabUrl: sender.url || "" };
        st.intents = [];
      } else if (msg.op === "intent") { // a label / packing-slip button was just clicked
        if (st.armed) st.armed.lastIntentAt = Date.now();
        st.intents.push({ kind: msg.kind === "p" ? "p" : "l", at: Date.now(), batch: msg.batch ? String(msg.batch).replace(/\D/g, "") : null, folder: msg.folder });
      } else if (msg.op === "fetch") {  // a direct PDF link: download it ourselves with the right name
        const batch = msg.batch ? String(msg.batch).replace(/\D/g, "") : st.armed && st.armed.batch;
        const folder = msg.folder != null ? msg.folder : st.armed && st.armed.folder;
        if (!batch || !SHIPHERO.test(sender.url || "") || !/^(https:|blob:https:)/i.test(msg.url || "")) { sendResponse({ ok: false, error: "not allowed" }); return; }
        const name = `${cleanFolder(folder)}${cleanFolder(folder) ? "/" : ""}${batch}-${msg.kind === "p" ? "p" : "l"}.pdf`;
        st.intents.push({ kind: msg.kind === "p" ? "p" : "l", at: Date.now(), batch, folder });
        await setState(st);
        chrome.downloads.download({ url: msg.url, filename: name, conflictAction: "overwrite" }, (id) => sendResponse({ ok: !!id, id, error: chrome.runtime.lastError && chrome.runtime.lastError.message }));
        return;
      } else if (msg.op === "lock" || msg.op === "unlock") {   // one download click at a time, so each file is matched to the right batch
        const L = (await S.get("dllock")).dllock, me = sender.tab && sender.tab.id, now = Date.now();
        if (msg.op === "unlock") { if (L && L.tab === me) await S.remove("dllock"); sendResponse({ ok: true }); return; }
        if (!L || L.tab === me || now - L.at > 60000) { await S.set({ dllock: { tab: me, at: now } }); sendResponse({ ok: true, granted: true }); }
        else sendResponse({ ok: true, granted: false });
        return;
      } else if (msg.op === "slipset") { // batch page: the next dashboard tab it opens gives this batch's packing slip
        const jobs = await slipJobs(); const me = sender.tab && sender.tab.id;
        jobs[me] = { batch: String(msg.batch).replace(/\D/g, ""), folder: msg.folder, fromTab: me, tabId: null, at: Date.now() };
        await S.set({ slips: jobs });
      } else if (msg.op === "slipopen") { // open the dashboard link for the packing slip
        const jobs = await slipJobs(); const sj = jobs[sender.tab && sender.tab.id];
        if (!sj || !/^https:\/\/([a-z0-9-]+\.)*shiphero\.com\//i.test(msg.url || "")) { sendResponse({ ok: false, error: "not allowed" }); return; }
        const tab = await chrome.tabs.create({ url: msg.url, active: false, openerTabId: sender.tab && sender.tab.id });
        sj.tabId = tab.id; await S.set({ slips: jobs });
      } else if (msg.op === "slipget") {  // dashboard tab: was I opened by the bot for a packing slip?
        const jobs = await slipJobs(); const t = sender.tab || {};
        const sj = Object.values(jobs).find((j) => Date.now() - j.at < 20 * 60000 && (j.tabId === t.id || (j.fromTab != null && t.openerTabId === j.fromTab)));
        sendResponse({ ok: true, job: sj || null }); return;
      } else if (msg.op === "slipdone") {
        const jobs = await slipJobs(); const me = sender.tab && sender.tab.id;
        Object.keys(jobs).forEach((k) => { if (jobs[k].tabId === me) delete jobs[k]; });
        await S.set({ slips: jobs });
      }
      await setState(st);
      const want = msg.batch ? String(msg.batch).replace(/\D/g, "") : st.armed && st.armed.batch;
      sendResponse({ ok: true, log: st.log.filter((x) => want && x.batch === want) });
    })();
    return true;
  }
  if (msg.type !== "sheet") return;
  if (!ALLOWED.test(msg.url || "")) { sendResponse({ ok: false, error: "That isn't an Apps Script web app link (…/exec)" }); return; }
  fetch(msg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: msg.body, redirect: "follow" })
    .then((r) => r.text())
    .then((t) => { try { sendResponse(JSON.parse(t)); } catch { sendResponse({ ok: false, error: /<html/i.test(t) ? "Google returned a web page — check the web app is deployed with access: Anyone" : "Unexpected reply: " + t.slice(0, 150) }); } })
    .catch((e) => sendResponse({ ok: false, error: "Network error: " + e.message }));
  return true;
});


// =====================================================================================
//  v2: side panel, shared settings, bot window, parallel Bulk Ship queue, Single Orders
// =====================================================================================
const SHIP = "https://shipping.shiphero.com";
chrome.runtime.onInstalled.addListener(() => { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); planAlarm(); });
chrome.runtime.onStartup.addListener(() => { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); planAlarm(); });
function planAlarm() { chrome.alarms.create("wd", { periodInMinutes: 0.5 }); }
planAlarm();

// ---------------- settings (shared by the side panel and the background) ----------------
const DEFAULT_WEB_APP = "https://script.google.com/macros/s/AKfycbzSulUZhKJZeji__D5IK7coRMq8EhnZMODicmdGQeel53qWM33lLNlFJkT3wu-Kzxhw/exec";
const DEF_RULES = "3 = 6x6x6 Box\n10 = 10x9x4 Box\n19 = 12x9x4 Box\n* = 13x10x8_BOX";
const DEF_SO = { ss: "", tab: "", idCol: "", orderCol: "", statusCol: "", from: "", to: "", skipDone: true, dry: false, rules: DEF_RULES, value: "Completed", errValue: "Error", alreadyValue: "Already Fulfilled", url: "", token: "" };
async function getCfg() {
  const c = (await chrome.storage.local.get("cfg")).cfg || {};
  const out = Object.assign({ url: "", token: "shipcube", speed: 4, bulkSpeed: 2, ownWindow: true }, c, { so: Object.assign({}, DEF_SO, c.so || {}) });
  if (!out.url) out.url = DEFAULT_WEB_APP;          // the team's Apps Script web app (can be changed in ⚙ Settings)
  if (!Array.isArray(out.so.sheets)) out.so.sheets = out.so.ss ? [{ name: "My sheet", url: out.so.ss }] : [];
  if (!Array.isArray(out.so.clients) || !out.so.clients.length) out.so.clients = [{ name: "Kitsch", match: "kitsch", rules: out.so.rules || DEF_RULES }];
  if (!out.so.clients.some((x) => x.name === out.so.client)) out.so.client = out.so.clients[0].name;
  return out;
}
async function setCfg(c) { await chrome.storage.local.set({ cfg: c }); }

// ---------------- shared log (side panel shows it) ----------------
let LOG = null;
async function log(m, c) {
  if (!LOG) LOG = (await S.get("log")).log || [];
  LOG.push({ t: Date.now(), m: String(m), c: c || "" });
  if (LOG.length > 300) LOG = LOG.slice(-300);
  await S.set({ log: LOG });
}

// ---------------- Google Sheet ----------------
async function sheetPost(url, token, payload) {
  if (!ALLOWED.test(url || "")) return { ok: false, error: "Set the Apps Script web app link (…/exec) in ⚙ Settings" };
  try {
    const ctl = new AbortController(); const kill = setTimeout(() => ctl.abort(), 60000);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ token }, payload)), redirect: "follow", signal: ctl.signal }).finally(() => clearTimeout(kill));
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { ok: false, error: /<html/i.test(t) ? "Google returned a web page — deploy the web app with access: Anyone" : "Unexpected reply: " + t.slice(0, 150) }; }
  } catch (e) { return { ok: false, error: e.name === "AbortError" ? "the sheet didn't answer in 60 s" : "Network error: " + e.message }; }
}

// ---------------- the bot's own window (work in yours while it runs) ----------------
async function newTab(url, own) {
  let id = null;
  if (own !== false) {
    let w = (await S.get("win")).win || {};
    if (w.id) { try { await chrome.windows.get(w.id); } catch { w = {}; await S.remove("win"); } }
    if (!w.id) {   // the bot's own window: its first tab opens straight on the address (no blank tab)
      const nw = await chrome.windows.create({ url, focused: false, state: "normal", width: 1280, height: 900 });
      await S.set({ win: { id: nw.id } }); id = nw.tabs[0].id;
    } else id = (await chrome.tabs.create({ url, active: false, windowId: w.id })).id;
  } else id = (await chrome.tabs.create({ url, active: false })).id;
  chrome.tabs.update(id, { autoDiscardable: false }).catch(() => {});   // Chrome must not put the tab to sleep
  return id;
}
async function closeBotWindowIfEmpty() {
  const w = (await S.get("win")).win || {};
  if (!w.id) return;
  try {
    const tabs = await chrome.tabs.query({ windowId: w.id });
    if (tabs.every((t) => !t.url || /^(about:blank|chrome:\/\/newtab)/.test(t.url) || !/shiphero\.com/.test(t.url))) { await chrome.windows.remove(w.id); await S.remove("win"); }
  } catch { await S.remove("win"); }
}

// one change at a time (several tabs finish at the same moment)
let chain = Promise.resolve();
function locked(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }

// ---------------- Bulk Ship sheet queue: N tabs at once (statuses of one link stay in its own tab) ----------------
async function getQ() { return (await S.get("queue")).queue || { items: [], i: 0, active: {}, running: false }; }
async function setQ(q) { await S.set({ queue: q }); }
function qConc(q) { return Math.max(1, Math.min(10, q.conc || 1)); }
async function openNext() {
  return locked(async () => {
    const q = await getQ();
    if (!q.running) return;
    q.active = q.active || {};
    while (Object.keys(q.active).length < qConc(q) && q.i < q.items.length) {
      const it = q.items[q.i++];
      const id = await newTab(it.url, q.ownWindow);
      q.active[id] = Object.assign({}, it, { at: Date.now() });
      log(`Bulk ${q.mode === "dl" ? "download" : "generate"}: ${it.label || "row " + it.row} → tab ${Object.keys(q.active).length}`);
    }
    if (!Object.keys(q.active).length && q.i >= q.items.length) {
      q.running = false; q.finishedAt = Date.now();
      log(`Bulk ${q.mode === "dl" ? "download" : "generate"} finished ✓ (${q.items.length} link${q.items.length === 1 ? "" : "s"})`, "ok");
      setTimeout(closeBotWindowIfEmpty, 4000);
    }
    await setQ(q);
  });
}
async function startBulk(mode, items, conc, own) {
  mode = mode === "dl" ? "dl" : "gen";
  items = (items || []).filter((x) => x && SHIPHERO.test(x.url || "") && (mode === "dl" || /\/bulk-ship\//.test(x.url)));
  await setQ({ items, i: 0, active: {}, mode, conc: Math.max(1, Math.min(10, +conc || 2)), ownWindow: own !== false, running: items.length > 0, startedAt: Date.now() });
  if (items.length) { log(`Bulk ${mode === "dl" ? "download" : "generate"}: ${items.length} link(s), ${Math.max(1, Math.min(10, +conc || 2))} tabs at once`, "ok"); await openNext(); }
}
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const q = await getQ();
  if (q.running && q.active && q.active[tabId]) {
    await locked(async () => { const q2 = await getQ(); delete q2.active[tabId]; await setQ(q2); });
    setTimeout(openNext, 1000);
  }
  soTabGone(tabId);
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "queue") return;
  (async () => {
    const me = sender.tab && sender.tab.id;
    if (msg.op === "start") {
      const c = await getCfg();
      await startBulk(msg.mode, msg.items, msg.conc || (msg.mode === "dl" ? c.bulkSpeed : c.bulkSpeed), c.ownWindow);
    } else if (msg.op === "again") {          // same batch link again for the next order status -> SAME tab
      if (!SHIPHERO.test(msg.url || "") || !/\/bulk-ship\//.test(msg.url)) { sendResponse({ ok: false, error: "not a ShipHero bulk-ship link" }); return; }
      const q = await getQ();
      if (q.running && q.active && q.active[me]) {
        await locked(async () => { const q2 = await getQ(); if (q2.active[me]) { q2.active[me].at = Date.now(); q2.active[me].rounds = (q2.active[me].rounds || 0) + 1; } await setQ(q2); });
        await chrome.tabs.update(me, { url: msg.url });
        sendResponse({ ok: true, sameTab: true }); return;
      }
      await chrome.tabs.create({ url: msg.url, active: true });
    } else if (msg.op === "stop") {
      const q = await getQ(); q.running = false; await setQ(q); log("Bulk queue stopped — no more links will be opened.", "warn");
    } else if (msg.op === "done") {
      let freed = false;
      await locked(async () => {
        const q = await getQ();
        if (q.running && q.active && q.active[me]) {
          const cur = q.active[me]; delete q.active[me]; freed = true;
          if (msg.retry && !cur.tries) q.items.push(Object.assign({}, cur, { tries: 1 }));
          await setQ(q);
        }
      });
      if (freed) { setTimeout(() => chrome.tabs.remove(me).catch(() => {}), 2500); setTimeout(openNext, 1200); }
    }
    const q2 = await getQ();
    const mine = !!(me && q2.active && q2.active[me]);
    sendResponse({ ok: true, mode: q2.mode || "gen", running: q2.running, at: q2.i, total: q2.items.length, mine, current: mine ? q2.active[me] : null, active: Object.keys(q2.active || {}).length });
  })();
  return true;
});

// ---------------- bot clock: background tabs wait with this (Chrome slows timers in hidden tabs) ----------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "clock") return;
  setTimeout(() => sendResponse({ ok: true }), Math.max(0, Math.min(60000, +msg.ms || 0)));
  return true;
});

// =====================================================================================
//  SINGLE ORDERS: sheet rows -> open order -> pack items -> box by qty -> Complete order -> "Completed"
// =====================================================================================
async function getSO() { return (await S.get("so")).so || null; }
async function setSO(s) { await S.set({ so: s }); }
function soUrl(item, via) { return via === "direct" && item.id ? `${SHIP}/orders/ship/?orderId=${encodeURIComponent(item.id)}` : `${SHIP}/orders/`; }
function soLeft(s) { return (s.items.length - s.pos) + s.retry.length; }

// which sheet: the Google Sheet open in the browser (its tab from the link), else the one in Settings.
// Columns: found by their headings unless "use my column letters" is ticked in Settings.
function soClient(c) { return c.so.clients.find((x) => x.name === c.so.client) || c.so.clients[0]; }
function soTarget(c, openSheet) {
  const so = c.so;
  const list = Array.isArray(so.sheets) ? so.sheets : [];
  const sh = list[so.sheetIdx || 0] || list[0];
  // the panel sends the sheet it means (Auto = the open sheet, or a saved link); empty tab = the tab in that link
  const t = { ss: openSheet || (sh ? sh.url : so.ss), tab: so.pickTab || "" };
  if (so.manualCols && so.orderCol && so.statusCol) Object.assign(t, { orderCol: so.orderCol, statusCol: so.statusCol, idCol: so.idCol });
  return t;
}
async function soStart(fresh, openSheet, test, speed) {
  const c = await getCfg(); const so = c.so;
  if (speed) c.speed = +speed;                     // exactly the speed shown in the panel
  const url = so.url || c.url, token = so.token || c.token;
  let s = await getSO();
  if (!fresh && s && s.items && soLeft(s) > 0 && !s.running) {        // ▶ Continue
    s.running = true; s.paused = false; s.conc = Math.max(1, Math.min(10, +c.speed || 4));
    await setSO(s); log(`Single orders: continuing — ${soLeft(s)} order(s) left`, "ok");
    return soOpenWorkers();
  }
  const tgt = soTarget(c, openSheet);
  if (!tgt.ss) { log("Single orders: add your Google Sheet link first (Sheet › + Add).", "bad"); return; }
  log(`Single orders: reading rows ${so.from || "first"}–${so.to || "last"}…`);
  const r = await sheetPost(url, token, Object.assign({ action: "soRead", from: so.from, to: so.to }, tgt));
  if (!r.ok) {
    const old = /Unknown action|letters like/i.test(r.error || "");
    log(old ? "The Google Sheet's Apps Script is still the OLD version. Paste the new “ShipCube Sheet Script.gs.txt” (from the ShipCube Bot v2 folder), Save, then Deploy › Manage deployments › ✎ edit › Version: New version › Deploy."
            : `Couldn't read the sheet: ${r.error}`, "bad");
    return;
  }
  if (r.cols) { tgt.orderCol = r.cols.order; tgt.statusCol = r.cols.status; tgt.idCol = r.cols.id; tgt.tab = r.sheet; }
  log(`Client ${soClient(c).name}: ${String(soClient(c).rules || "").split(/\n/).filter(Boolean).join(" · ")}`, "muted");
  log(`Sheet “${r.file || ""}${r.file ? " › " : ""}${r.sheet}”: Order Id ${tgt.idCol || "—"} · Order Number ${tgt.orderCol} · Status ${tgt.statusCol}`, "muted");
  let items = r.items || [];
  const total = items.length;
  if (so.skipDone) items = items.filter((x) => !/^(completed?|already ful+fill?ed)$/i.test(String(x.status).trim()));
  const skipped = total - items.length;
  if (test) items = items.slice(0, 5);          // 🧪 Test run: the first 5 orders only
  const bad = items.filter((x) => x.sci && !x.id);
  items = items.filter((x) => !(x.sci && !x.id));
  if (bad.length) log(`Rows ${bad.map((x) => x.row).join(", ")}: the Order Number shows as 5.78E+17 (lost digits) and there's no Order Id — skipped. Format that column as Plain text.`, "warn");
  if (!items.length) { log(`Nothing to do on "${r.sheet}"${skipped ? ` — ${skipped} row(s) already Completed` : ""}.`, "warn"); return; }
  s = { running: true, paused: false, items, pos: 0, retry: [], active: {}, idle: [], ok: 0, fail: 0, dryOk: 0, failed: [], writes: [], written: 0,
        conc: Math.max(1, Math.min(10, +c.speed || 4)), dry: !!test, sheet: r.sheet, target: tgt, errValue: so.errValue || "Error", client: soClient(c), startedAt: Date.now(), finishedAt: null, skipped, durations: [] };
  await setSO(s);
  log(`Single orders: ${items.length} order(s) on "${r.sheet}"${skipped ? `, ${skipped} already Completed skipped` : ""} — ${s.conc} tab${s.conc > 1 ? "s" : ""} at once${s.dry ? " · 🧪 TEST RUN (Complete order is NOT clicked, nothing written)" : ""}`, "ok");
  return soOpenWorkers();
}
// ↻ Retry failed: a new run with only the orders that failed in the last run (same sheet, subsheet, client)
async function soRetryFailed() {
  const c = await getCfg(); const old = await getSO();
  if (!old || old.running) return;
  const seen = new Set();
  const items = (old.failed || []).map((f) => f.item).filter((x) => x && !seen.has(x.row) && seen.add(x.row));
  if (!items.length) { log("No failed orders to retry.", "warn"); return; }
  const s = { running: true, paused: false, items, pos: 0, retry: [], active: {}, idle: [], ok: 0, fail: 0, dryOk: 0, failed: [], writes: [], written: 0,
    conc: Math.max(1, Math.min(10, +c.speed || 4, items.length)), dry: false, sheet: old.sheet, target: old.target, errValue: old.errValue || "Error",
    client: old.client || soClient(c), startedAt: Date.now(), finishedAt: null, skipped: 0, durations: [], retryRun: true };
  await setSO(s);
  log(`↻ Retry failed: ${items.length} order(s) (rows ${items.map((x) => x.row).join(", ")}) — ${s.conc} tab${s.conc > 1 ? "s" : ""}`, "ok");
  return soOpenWorkers();
}
async function soOpenWorkers() {
  const c = await getCfg();
  const s = await getSO(); if (!s || !s.running) return;
  const want = Math.min(s.conc, soLeft(s)) - Object.keys(s.active).length - (s.idle || []).length;
  const idle = s.idle || []; s.idle = []; await setSO(s);
  for (const id of idle) await soAssign(id);
  for (let i = 0; i < want; i++) { await soAssign(null, c.ownWindow); await new Promise((r) => setTimeout(r, 400)); }
}
function soNextItem(s) {
  if (s.retry.length && s.retry[0].now) { const x = s.retry.shift(); delete x.now; return x; }
  if (s.pos < s.items.length) return s.items[s.pos++];
  if (s.retry.length) return s.retry.shift();
  return null;
}
// give this tab its next order (or close it when there's nothing left)
async function soAssign(tabId, own) {
  let nav = null, close = false, entry = null;
  await locked(async () => {
    const s = await getSO(); if (!s) return;
    if (tabId == null) {          // a new tab: pick its order first, then open the tab right on it
      if (!s.running || s.paused) return;
      const it = soNextItem(s); if (!it) return;
      const via = it.id && !it.searched ? "direct" : "search";
      entry = { item: it, via, at: Date.now(), beat: Date.now(), reloads: 0 };
      s.active["new"] = entry; nav = soUrl(it, via); await setSO(s); return;
    }
    delete s.active[tabId];
    if (!s.running) { await setSO(s); return; }
    if (s.paused) { if (!s.idle.includes(tabId)) s.idle.push(tabId); await setSO(s); return; }
    const it = soNextItem(s);
    if (!it) { close = true; await setSO(s); return; }
    const via = it.id && !it.searched ? "direct" : "search";
    s.active[tabId] = { item: it, via, at: Date.now(), beat: Date.now(), reloads: 0 };
    nav = soUrl(it, via);
    await setSO(s);
  });
  if (entry) {
    const id = await newTab(nav, own);
    await locked(async () => { const s = await getSO(); delete s.active["new"]; s.active[id] = entry; await setSO(s); });
    return;
  }
  if (nav) { try { await chrome.tabs.update(tabId, { url: nav }); } catch { soTabGone(tabId); } }
  if (close) { chrome.tabs.remove(tabId).catch(() => {}); soCheckFinish(); }
}
// "Error (reason)" for the Status cell - short, without the bot's extra words
function errText(word, msg) {
  const r = String(msg || "").replace(/\s*—\s*(left as is|please (check|do it by hand).*|check this order)$/i, "").replace(/[“”"]/g, "").replace(/'s box list/, " box list").trim().slice(0, 90);
  return r ? `${word} (${r})` : word;
}
async function soResult(tabId, res) {
  let wroteNow = false;
  await locked(async () => {
    const s = await getSO(); if (!s || !s.active[tabId]) return;
    const a = s.active[tabId], it = a.item;
    const tag = `Row ${it.row} ${it.order || it.id}`;
    s.durations = (s.durations || []).concat(Date.now() - a.at).slice(-40);
    if (res.ok && res.already) {
      s.ok++; s.already = (s.already || 0) + 1;
      const av = (await getCfg()).so.alreadyValue || "Already Fulfilled";
      if (!s.dry) s.writes.push({ row: it.row, order: it.order, value: av });
      log(`${tag}: already fulfilled in ShipHero (not in Single Orders) → “${av}”`, "ok");
    } else if (res.ok && res.dry) { s.dryOk++; log(`${tag}: 🧪 test ok — ${res.qty} unit(s) → ${res.box} (Complete not clicked)`, "ok"); }
    else if (res.ok) {
      s.ok++; s.writes.push({ row: it.row, order: it.order, value: (res.value || "Completed") });
      log(`${tag}: completed ✓ — ${res.qty} unit(s) → ${res.box}`, "ok"); wroteNow = s.writes.length >= 15;
    } else if (res.search && it.id && !it.searched) {         // the direct link didn't open it: search for it instead
      it.searched = true; it.now = true; s.retry.unshift(it); log(`${tag}: ${res.msg} — trying the Single Orders search`, "muted");
    } else if (res.retry && !it.tries) {
      it.tries = 1; s.retry.push(it); log(`${tag}: ${res.msg} — will try again at the end`, "warn");
    } else {
      s.fail++; s.failed.push({ row: it.row, order: it.order, msg: res.msg, item: Object.assign({}, it, { tries: 0, searched: false, now: false }) }); log(`${tag}: ✗ ${res.msg}${s.dry ? " (test run — nothing written)" : " — not completed in ShipHero, written in the sheet (red)"}`, "bad");
      if (!s.dry) s.writes.push(res.detail ? { row: it.row, order: it.order, value: String(res.detail).slice(0, 200), red: true }   // ShipHero's own details, e.g. "The order is on hold"
                                           : { row: it.row, order: it.order, value: errText(s.errValue || "Error", res.msg) });
    }
    await setSO(s);
  });
  if (wroteNow) soFlush(); else soFlushSoon();
  await soAssign(tabId);
}
let flushT = null;
function soFlushSoon() { clearTimeout(flushT); flushT = setTimeout(soFlush, 5000); }
let flushing = false;
async function soFlush() {
  if (flushing) return soFlushSoon();
  flushing = true;
  try {
    const s = await getSO(); if (!s || !s.writes.length) return;
    const c = await getCfg(); const so = c.so;
    const batch = s.writes.slice(0, 200);
    const t = s.target || soTarget(c);
    const r = await sheetPost(so.url || c.url, so.token || c.token, { action: "soWrite", ss: t.ss, tab: t.tab, orderCol: t.orderCol, statusCol: t.statusCol, writes: batch });
    await locked(async () => {
      const s2 = await getSO(); if (!s2) return;
      if (r.ok) {
        s2.writes = s2.writes.slice(batch.length); s2.written += r.written || 0;
        const nOk = batch.filter((w) => w.value === (so.value || "Completed")).length, nAl = batch.filter((w) => w.value === (so.alreadyValue || "Already Fulfilled")).length, nErr = batch.length - nOk - nAl;
        log(`Sheet ✓ ${r.written} row(s) written (${nOk} “${so.value || "Completed"}”${nAl ? `, ${nAl} “${so.alreadyValue || "Already Fulfilled"}”` : ""}${nErr ? `, ${nErr} error${nErr > 1 ? "s" : ""} (red)` : ""})${r.moved && r.moved.length ? ` (moved rows found: ${r.moved.join(", ")})` : ""}`, "ok");
        if (r.missing && r.missing.length) log(`Sheet: order(s) not found in the column any more: ${r.missing.join(", ")}`, "warn");
      } else log(`Sheet ✗ ${r.error} — will retry`, "bad");
      await setSO(s2);
    });
    if (!r.ok) setTimeout(soFlush, 15000);
  } finally { flushing = false; }
  const s = await getSO(); if (s && s.writes.length) soFlushSoon(); else soCheckFinish();
}
async function soCheckFinish() {
  const s = await getSO();
  if (!s || !s.running || soLeft(s) > 0 || Object.keys(s.active).length) return;
  if (s.writes.length) return soFlush();
  s.running = false; s.finishedAt = Date.now(); await setSO(s);
  const mins = ((s.finishedAt - s.startedAt) / 60000).toFixed(1);
  log(`Single orders finished ✓ ${s.ok} completed${s.already ? ` (${s.already} already fulfilled)` : ""}${s.dryOk ? `, ${s.dryOk} test ok` : ""}, ${s.fail} failed · ${mins} min`, s.fail ? "warn" : "ok");
  if (s.failed.length) log(`Failed rows: ${s.failed.map((f) => f.row).join(", ")}`, "bad");
  for (const id of s.idle || []) chrome.tabs.remove(id).catch(() => {});
  setTimeout(closeBotWindowIfEmpty, 3000);
}
async function soTabGone(tabId) {
  let had = false;
  await locked(async () => {
    const s = await getSO(); if (!s) return;
    if (s.active[tabId]) { had = true; const it = s.active[tabId].item; s.retry.unshift(it); delete s.active[tabId]; log(`A Single Orders tab was closed — row ${it.row} goes back in the queue.`, "warn"); }
    s.idle = (s.idle || []).filter((x) => x !== tabId);
    await setSO(s);
  });
  if (had) soCheckFinish();
}
// watchdog: a tab that went quiet (page didn't load / hung) is reloaded, then given up on
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "wd") return;
  const s = await getSO(); if (!s) return;
  if (s.writes && s.writes.length) soFlushSoon();          // results still waiting for the sheet - also after a run
  if (!s.running) return;
  const now = Date.now();
  for (const [id, x] of Object.entries(s.active)) {
    if (!/^\d+$/.test(id) || now - x.beat < 90000) continue;
    if (x.reloads < 2) {
      await locked(async () => { const s2 = await getSO(); if (s2.active[id]) { s2.active[id].reloads++; s2.active[id].beat = Date.now(); s2.active[id].via = x.via; } await setSO(s2); });
      log(`Row ${x.item.row}: page quiet for 90 s — reloading it`, "warn");
      chrome.tabs.update(+id, { url: soUrl(x.item, x.via) }).catch(() => soTabGone(+id));
    } else {
      soResult(+id, { ok: false, retry: true, msg: "page stuck (reloaded twice)" });
    }
  }
  if (s.writes.length) soFlushSoon();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "so") return;
  const me = sender.tab && sender.tab.id;
  (async () => {
    if (msg.op === "job") {
      const s = await getSO(); const c = await getCfg();
      const a = s && s.running && s.active[me];
      sendResponse({ ok: true, job: a ? { item: a.item, via: a.via, dry: s.dry, rules: (s.client || soClient(c)).rules || DEF_RULES, match: "" /* no client check: the sheet is already sorted by client */, client: (s.client || soClient(c)).name, value: c.so.value || "Completed", n: Object.keys(s.active).indexOf(String(me)) + 1, left: soLeft(s) } : null });
    } else if (msg.op === "beat") {
      await locked(async () => { const s = await getSO(); if (s && s.active[me]) { s.active[me].beat = Date.now(); if (msg.stage) s.active[me].stage = msg.stage; await setSO(s); } });
      sendResponse({ ok: true });
    } else if (msg.op === "via") {
      await locked(async () => { const s = await getSO(); if (s && s.active[me]) { s.active[me].via = msg.via; s.active[me].beat = Date.now(); await setSO(s); } });
      sendResponse({ ok: true });
    } else if (msg.op === "result") {
      sendResponse({ ok: true });
      soResult(me, msg.res || {});
    }
  })();
  return true;
});

// ---------------- side panel ----------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "panel") return;
  (async () => {
    const op = msg.op;
    if (op === "state") { sendResponse({ ok: true, cfg: await getCfg(), so: await getSO(), queue: await getQ(), log: (await S.get("log")).log || [] }); return; }
    if (op === "saveCfg") { await setCfg(msg.cfg); sendResponse({ ok: true }); return; }
    if (op === "clearLog") { LOG = []; await S.set({ log: [] }); sendResponse({ ok: true }); return; }
    if (op === "testSheet") {
      const c = await getCfg(); const so = c.so;
      const r = msg.which === "so"
        ? await sheetPost(so.url || c.url, so.token || c.token, Object.assign({ action: "soRead", from: so.from || 1, to: so.from ? (+so.from + 4) : 5 }, soTarget(c, msg.openSheet)))
        : msg.which === "bulkSheet" ? await sheetPost(c.bulkUrl, c.bulkToken || "shipcube", { action: "ping" })
        : await sheetPost(c.url, c.token, { action: "ping" });
      sendResponse(r); return;
    }
    if (op === "soTabs" || op === "soDetect") {
      const c = await getCfg(); const so = c.so; const t = soTarget(c, msg.openSheet);
      if (!t.ss) { sendResponse({ ok: false, error: "Add your Google Sheet link first (Sheet › + Add)" }); return; }
      const from = parseInt(so.from, 10) || 1, to = parseInt(so.to, 10) || from + 200;
      sendResponse(await sheetPost(so.url || c.url, so.token || c.token, op === "soTabs" ? { action: "soTabs", ss: t.ss }
        : Object.assign({ action: "soRead", from, to: Math.min(to, from + 200) }, t)));
      return;
    }
    if (op === "soRetry") { sendResponse({ ok: true }); soRetryFailed(); return; }
    if (op === "soStart") { sendResponse({ ok: true }); soStart(!!msg.fresh || !!msg.test, msg.openSheet || "", !!msg.test, msg.speed); return; }
    if (op === "soPause") { await locked(async () => { const s = await getSO(); if (s) { s.paused = true; await setSO(s); } }); log("⏸ Paused — tabs finish the order they're on, then wait.", "warn"); sendResponse({ ok: true }); return; }
    if (op === "soResume") { await locked(async () => { const s = await getSO(); if (s) { s.paused = false; await setSO(s); } }); log("▶ Resumed", "ok"); sendResponse({ ok: true }); soOpenWorkers(); return; }
    if (op === "soStop") {
      await locked(async () => {
        const s = await getSO(); if (!s) return;
        Object.values(s.active).forEach((x) => s.retry.unshift(x.item));
        s.active = {}; s.running = false; s.paused = false; await setSO(s);
      });
      log("■ Stopped. Orders not finished stay in the queue — ▶ Continue carries on.", "warn");
      soFlush(); sendResponse({ ok: true }); return;
    }
    if (op === "bulkStart") {
      const c = await getCfg();
      if (!c.bulkUrl) { log("Bulk Ship: set the Bulk Ship sheet's web app link first (⚙ Settings › Bulk Ship sheet).", "bad"); sendResponse({ ok: false }); return; }
      const r = await sheetPost(c.bulkUrl, c.bulkToken || "shipcube", { action: msg.mode === "dl" ? "queue2" : "queue" });
      if (!r.ok) { log(`Couldn't read the Bulk Ship sheet: ${r.error}`, "bad"); sendResponse(r); return; }
      if (!(r.items || []).length) { log(msg.mode === "dl" ? "Nothing to download — every batch already has a PDF link." : "No bulk-ship links to do in the sheet.", "warn"); sendResponse({ ok: true }); return; }
      await startBulk(msg.mode, r.items, c.bulkSpeed, c.ownWindow);
      sendResponse({ ok: true }); return;
    }
    if (op === "bulkStop") { const q = await getQ(); q.running = false; await setQ(q); log("Bulk queue stopped — open tabs finish their batch.", "warn"); sendResponse({ ok: true }); return; }
    if (op === "pageCmd" || op === "reloadNow" || op === "teamLoad" || op === "checkUpdate") return;          // answered by other listeners
    sendResponse({ ok: false, error: "unknown op" });
  })();
  return true;
});

// ---------------- v2: the ShipHero pages report to the side panel (the old in-page panel is hidden) ----------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !/^(plog|pstep|pdebug)$/.test(msg.type)) return;
  (async () => {
    const me = sender.tab && sender.tab.id;
    const q = await getQ();
    const n = q.running && q.active && q.active[me] ? Object.keys(q.active).indexOf(String(me)) + 1 : 0;
    if (msg.type === "plog") log((n ? `[tab ${n}] ` : "[ShipHero] ") + msg.m, msg.c);
    else if (msg.type === "pdebug") await S.set({ debug: { at: Date.now(), text: msg.text } });
    else if (msg.type === "pstep" && n) await locked(async () => { const q2 = await getQ(); if (q2.active[me]) { q2.active[me].step = `${msg.k}${msg.state === "bad" ? " ✗" : msg.state === "done" ? " ✓" : "…"}`; await setQ(q2); } });
    sendResponse({ ok: true });
  })();
  return true;
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "panel" || msg.op !== "pageCmd") return;
  (async () => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const t = tabs.find((x) => /^https:\/\/shipping\.shiphero\.com\//.test(x.url || ""));
    if (!t) { log("Open the ShipHero Bulk Ship page in this window first (it must be the tab you're looking at).", "warn"); sendResponse({ ok: false }); return; }
    chrome.tabs.sendMessage(t.id, { type: "pageCmd", cmd: msg.cmd }, () => { void chrome.runtime.lastError; sendResponse({ ok: true }); });
  })();
  return true;
});

// =====================================================================================
//  GIT UPDATES + TEAM CONFIG
//  * the team runs "git pull" (UPDATE.bat) -> new files on disk -> the bot sees a newer manifest version
//    and reloads itself as soon as nothing is running (no chrome://extensions needed)
//  * team-config.json in the repo = shared settings (web app link, sheets, clients, switches) for every PC
// =====================================================================================
async function checkDiskVersion() {
  try {
    const m = await (await fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), { cache: "no-store" })).json();
    const cur = chrome.runtime.getManifest().version;
    if (!m.version || m.version === cur) { await S.remove("update"); return; }
    const s = await getSO(), q = await getQ();
    const busy = !!((s && s.running) || (q && q.running));
    await S.set({ update: { version: m.version, from: cur, busy } });
    if (!busy) { await log(`Update v${m.version} found (you have v${cur}) — reloading the bot…`, "ok"); setTimeout(() => chrome.runtime.reload(), 1500); }
  } catch {}
}
const PC_ONLY = ["shipcubeBot.bulkOn", "shipcubeBot.autogen"];   // safety switches: never shared through team-config.json
// once (v2.3.0): Bulk Ship automation OFF and auto-generate OFF on every PC - the team turns Bulk Ship on themselves
async function safetyReset() {
  const l = await chrome.storage.local.get(["pflags", "safety230"]);
  if (l.safety230) return;
  const pf = l.pflags || {}; pf["shipcubeBot.bulkOn"] = "0"; pf["shipcubeBot.autogen"] = "0";
  await chrome.storage.local.set({ pflags: pf, safety230: 1 });
}
async function applyTeamConfig(force) {
  await safetyReset();
  try {
    const r = await fetch(chrome.runtime.getURL("team-config.json") + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return { ok: false, error: "no team-config.json in the bot folder" };
    const t = await r.json();
    const ver = String(t.configVersion || "");
    if (!ver) return { ok: false, error: "team-config.json has no configVersion" };
    const st = (await chrome.storage.local.get("teamVer")).teamVer;
    if (st === ver && !force) return { ok: true, same: true, version: ver };
    const c = (await chrome.storage.local.get("cfg")).cfg || {};
    const so = Object.assign({}, c.so || {});
    if (t.webAppUrl) c.url = t.webAppUrl;
    if (t.bulkWebAppUrl) { c.bulkUrl = t.bulkWebAppUrl; if (t.bulkPassword) c.bulkToken = t.bulkPassword; }
    if (t.password) c.token = t.password;
    if (t.speed) c.speed = +t.speed;
    if (t.bulkSpeed) c.bulkSpeed = +t.bulkSpeed;
    if (typeof t.ownWindow === "boolean") c.ownWindow = t.ownWindow;
    if (Array.isArray(t.sheets)) {                 // added to this PC's list (nothing removed)
      const have = Array.isArray(so.sheets) ? so.sheets : [];
      t.sheets.forEach((x) => { if (x && x.url && !have.some((h) => h.url === x.url)) have.push({ name: x.name || "Sheet", url: x.url }); });
      so.sheets = have;
    }
    if (Array.isArray(t.clients) && t.clients.length) so.clients = t.clients.map((x) => ({ name: x.name, match: x.match || "", rules: Array.isArray(x.rules) ? x.rules.join("\n") : String(x.rules || "") }));
    if (t.client) so.client = t.client;
    if (t.completedWord) so.value = t.completedWord;
    if (t.errorWord) so.errValue = t.errorWord;
    if (t.alreadyWord) so.alreadyValue = t.alreadyWord;
    if (typeof t.skipCompleted === "boolean") so.skipDone = t.skipCompleted;
    c.so = so;
    const sets = { cfg: c, teamVer: ver };
    if (t.bulkSwitches && typeof t.bulkSwitches === "object") {
      const pf = (await chrome.storage.local.get("pflags")).pflags || {};
      const shared = Object.assign({}, t.bulkSwitches); PC_ONLY.forEach((k) => delete shared[k]);
      sets.pflags = Object.assign(pf, shared);
    }
    await chrome.storage.local.set(sets);
    await log(`Team settings “${ver}” loaded from team-config.json ✓`, "ok");
    return { ok: true, version: ver };
  } catch (e) { return { ok: false, error: "team-config.json: " + e.message }; }
}
chrome.runtime.onInstalled.addListener(() => applyTeamConfig());
chrome.runtime.onStartup.addListener(() => applyTeamConfig());
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "wd") checkDiskVersion(); });
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "panel" || !/^(reloadNow|teamLoad|checkUpdate)$/.test(msg.op)) return;
  (async () => {
    if (msg.op === "reloadNow") { sendResponse({ ok: true }); setTimeout(() => chrome.runtime.reload(), 300); return; }
    if (msg.op === "teamLoad") { sendResponse(await applyTeamConfig(true)); return; }
    if (msg.op === "checkUpdate") { await checkDiskVersion(); sendResponse({ ok: true, update: (await S.get("update")).update || null }); return; }
  })();
  return true;
});
setTimeout(() => { applyTeamConfig(); checkDiskVersion(); }, 2000);
