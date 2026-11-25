const OLD_SCRIPT = 'Your Google <b>Apps Script is an old version</b> (needs v11). Open ⚙ Settings › Google Sheet › <b>How to update</b>.';
// ShipCube Bot v2 - side panel (controls; the background does the work)
const $ = (id) => document.getElementById(id);
const send = (op, extra) => new Promise((res) => chrome.runtime.sendMessage(Object.assign({ type: "panel", op }, extra || {}), (r) => { void chrome.runtime.lastError; res(r || {}); }));
let cfg = null, so = null, queue = null, logs = [];
let mode = "so";
try { mode = localStorage.getItem("scb.mode") || "so"; } catch {}
$("ver").innerHTML = "<b>v" + chrome.runtime.getManifest().version + "</b> · ShipHero → Google Sheet";

// ---------------- settings ----------------
async function saveCfg() { await send("saveCfg", { cfg }); }
let saveT = null;
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(saveCfg, 300); }
function fillMain() {
  $("speed").value = String(cfg.speed || 4);
  $("bulkSpeed").value = String(cfg.bulkSpeed || 2);
  $("from").value = cfg.so.from || ""; $("to").value = cfg.so.to || "";
  rangeHint(); cliMain();
  $("skipDone").checked = cfg.so.skipDone !== false;

  $("ownWin").checked = cfg.ownWindow !== false;
  showSheet();
}
// ---------------- which Google Sheet: "Auto" = the sheet open in the tab you're looking at (like the Tracking Bot),
// or one of your saved links. The Tab list then shows that spreadsheet's tabs.
let openSheet = "", openTitle = "";
const isAuto = () => cfg.so.sheetIdx === "page";
const sheetKey = (u) => ((u || "").match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || "";
const gidOf = (u) => ((u || "").match(/[#&?]gid=(\d+)/) || [])[1] || "";
async function findOpenSheet() {
  let url = "", title = "";
  try {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (t && /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(t.url || "")) { url = t.url; title = (t.title || "").replace(/\s*-\s*Google (Sheets|Spreadsheets)\s*$/i, ""); }
  } catch {}
  if (url === openSheet) { if (title && title !== openTitle && !/^docs\.google\.com/.test(title)) { openTitle = title; showSheet(); } return; }
  if (/^docs\.google\.com/.test(title)) title = "";
  const before = openSheet; openSheet = url; openTitle = title;
  if (url) { cfg.so.lastOpen = { name: title || "Google Sheet", url }; saveSoon(); }
  showSheet();
  if (isAuto()) {
    if (sheetKey(url) !== sheetKey(before)) loadTabs(true);          // another spreadsheet
    else if (url && gidOf(url) !== gidOf(before)) { if (!cfg.so.pickTab) { markOpenTab(); detect(); } }   // another tab of the same one
  }
}
function sheets() { if (!Array.isArray(cfg.so.sheets)) cfg.so.sheets = []; return cfg.so.sheets; }
function curSheet() {
  if (isAuto()) return openSheet ? { name: openTitle || "Google Sheet", url: openSheet, auto: true }
    : cfg.so.lastOpen ? Object.assign({ last: true }, cfg.so.lastOpen) : sheets()[0] ? Object.assign({ last: true }, sheets()[0]) : null;
  return sheets()[+cfg.so.sheetIdx || 0] || sheets()[0] || null;
}
function showSheet() {
  const s = cfg && cfg.so; if (!s) return;
  if (s.sheetIdx == null || (!s.autoV1 && !s.running)) { if (!s.autoV1) { s.sheetIdx = "page"; s.autoV1 = 1; saveSoon(); } }
  const sel = $("sheetSel"), list = sheets();
  sel.innerHTML = '<option value="page">Auto — the sheet you have open</option>' + list.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join("");
  sel.value = isAuto() ? "page" : String(Math.min(+s.sheetIdx || 0, Math.max(0, list.length - 1)));
  $("sheetDel").disabled = isAuto();
  const c = curSheet();
  $("soFile").innerHTML = isAuto()
    ? (openSheet ? `<span class="ok">✓</span> Detected <b>${esc(openTitle || "Google Sheet")}</b> — the sheet in the tab you're looking at`
      : c ? `No Google Sheet open in this window — using the last one: <b>${esc(c.name)}</b>` : '<span class="warn">Open your Google Sheet in this window (or + Add its link).</span>')
    : (c ? "" : '<span class="warn">Click <b>+ Add</b> and paste your Google Sheet link.</span>');
  $("tabSel").options[0] && ($("tabSel").options[0].textContent = isAuto() ? "The subsheet you have open" : "The subsheet in the link");
}
$("sheetSel").onchange = async () => { const v = $("sheetSel").value; cfg.so.sheetIdx = v === "page" ? "page" : +v || 0; cfg.so.pickTab = ""; await saveCfg(); showSheet(); loadTabs(true); };
$("sheetAdd").onclick = () => { $("sheetForm").classList.toggle("hide"); if (!$("newUrl").value && openSheet) { $("newUrl").value = openSheet; $("newName").value = openTitle; } $("newUrl").focus(); };
$("sheetCancel").onclick = () => $("sheetForm").classList.add("hide");
$("sheetDel").onclick = async () => {
  const b = $("sheetDel");
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Remove?"; setTimeout(() => { delete b.dataset.armed; b.textContent = "🗑"; }, 3000); return; }
  if (isAuto()) return;
  sheets().splice(+cfg.so.sheetIdx || 0, 1); cfg.so.sheetIdx = sheets().length ? 0 : "page"; cfg.so.pickTab = ""; await saveCfg(); showSheet(); loadTabs(true);
};
$("sheetSave").onclick = async () => {
  const url = $("newUrl").value.trim();
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{10,}/.test(url)) { $("sheetOut").innerHTML = '<span class="bad">That isn\'t a Google Sheet link</span>'; return; }
  sheets().push({ name: $("newName").value.trim() || "Sheet " + (sheets().length + 1), url });
  cfg.so.sheetIdx = sheets().length - 1; cfg.so.pickTab = ""; await saveCfg();
  $("sheetOut").textContent = "Checking…";
  const r = await send("soTabs", { openSheet: url });
  if (r.ok) {
    if (!$("newName").value.trim() && r.file) { sheets()[cfg.so.sheetIdx].name = r.file; await saveCfg(); }
    $("sheetOut").textContent = ""; $("newUrl").value = ""; $("newName").value = ""; $("sheetForm").classList.add("hide");
  } else if (/Unknown action/i.test(r.error || "")) {      // the sheet is saved; only the subsheet list needs the new script
    $("sheetOut").textContent = ""; $("newUrl").value = ""; $("newName").value = ""; $("sheetForm").classList.add("hide");
  } else $("sheetOut").innerHTML = `<span class="bad">${esc(r.error)}</span>`;
  showSheet(); loadTabs(true);
};
$("speed").onchange = () => { cfg.speed = +$("speed").value; saveSoon(); };
$("bulkSpeed").onchange = () => { cfg.bulkSpeed = +$("bulkSpeed").value; saveSoon(); };
function rangeHint() {
  const f = parseInt(cfg.so.from, 10), t = parseInt(cfg.so.to, 10);
  if (f && t && t >= f) { $("count").value = String(t - f + 1); $("rangeHint").textContent = `Rows ${f}–${t} = ${t - f + 1} row${t > f ? "s" : ""}`; }
  else { if (document.activeElement !== $("count")) $("count").value = ""; $("rangeHint").textContent = f ? `From row ${f} to the last order` : t ? `From the first row to row ${t}` : "Every row of the sheet"; }
  if (f && t && t < f) $("rangeHint").innerHTML = '<span class="bad">“to” is smaller than “from”</span>';
}
$("from").oninput = () => {
  cfg.so.from = $("from").value.replace(/\D/g, "");
  const n = parseInt($("count").value, 10), f = parseInt(cfg.so.from, 10);
  if (n && f && !cfg.so.to) { cfg.so.to = String(f + n - 1); $("to").value = cfg.so.to; }
  rangeHint(); saveSoon();
};
$("to").oninput = () => { cfg.so.to = $("to").value.replace(/\D/g, ""); rangeHint(); saveSoon(); if (typeof detect === "function") detect(); };
$("count").oninput = () => {
  const n = parseInt($("count").value.replace(/\D/g, ""), 10), f = parseInt(cfg.so.from, 10) || 1;
  if (!cfg.so.from && n) { cfg.so.from = "1"; $("from").value = "1"; }
  cfg.so.to = n ? String(f + n - 1) : ""; $("to").value = cfg.so.to; rangeHint(); saveSoon();
};
$("skipDone").onchange = () => { cfg.so.skipDone = $("skipDone").checked; saveSoon(); };
$("soRetry").onclick = async () => { if (so && so.running) return; syncMain(); await saveCfg(); send("soRetry"); };
$("soTest").onclick = async () => {        // test run: first 5 orders, no Complete order, nothing written
  if (so && so.running) return;
  await findOpenSheet();
  if (!curSheet()) { $("soFile").innerHTML = '<span class="bad">Open your Google Sheet in this window first (or + Add its link).</span>'; return; }
  syncMain(); await saveCfg(); send("soStart", { fresh: true, test: true, openSheet: curSheet().url, speed: cfg.speed });
};
$("ownWin").onchange = () => { cfg.ownWindow = $("ownWin").checked; saveSoon(); };

function openSettings() {
  $("main").classList.add("hide"); $("settings").classList.remove("hide"); showSteps(); window.scrollTo(0, 0);
  const s = cfg.so;
  $("cUrl").value = cfg.url || ""; $("cToken").value = cfg.token || "";
  $("bUrl").value = cfg.bulkUrl || ""; $("bToken").value = cfg.bulkToken || "";

  $("soManual").checked = !!s.manualCols; $("soId").value = s.idCol || ""; $("soOrd").value = s.orderCol || ""; $("soSt").value = s.statusCol || "";
  $("soVal").value = s.value || "Completed"; $("soErr").value = s.errValue || "Error"; $("soAl").value = s.alreadyValue || "Already Fulfilled";
  $("soUrl").value = s.url || ""; $("soToken").value = s.token || "";
  cliEdit = Math.max(0, clients().findIndex((c) => c.name === cfg.so.client)); cliShow();
  $("saveOut").textContent = ""; $("testSoOut").textContent = ""; $("testBulkOut").textContent = "";
}
function readSettings() {
  const L = (v) => String(v || "").toUpperCase().replace(/[^A-Z]/g, "");
  cfg.url = $("cUrl").value.trim(); cfg.token = $("cToken").value.trim() || "shipcube";
  cfg.bulkUrl = $("bUrl").value.trim(); cfg.bulkToken = $("bToken").value.trim() || "shipcube";
  Object.assign(cfg.so, {

    manualCols: $("soManual").checked, idCol: L($("soId").value), orderCol: L($("soOrd").value), statusCol: L($("soSt").value),
    value: $("soVal").value.trim() || "Completed", errValue: $("soErr").value.trim() || "Error", alreadyValue: $("soAl").value.trim() || "Already Fulfilled",
    url: $("soUrl").value.trim(), token: $("soToken").value.trim(),
  });
}
function showSteps() {
  const set = !$("settings").classList.contains("hide");
  $("steps").classList.toggle("hide", set || mode !== "so"); $("bsteps").classList.toggle("hide", set || mode !== "bulk");
  $("gear").textContent = set ? "← Back" : "⚙ Settings";
}
function closeSettings() { $("settings").classList.add("hide"); $("main").classList.remove("hide"); showSteps(); fillMain(); }

$("gear").onclick = () => ($("settings").classList.contains("hide") ? openSettings() : closeSettings());
$("closeSet").onclick = closeSettings;
// ---------------- clients (each with its own box rules) ----------------
let cliEdit = 0;
function clients() { if (!Array.isArray(cfg.so.clients) || !cfg.so.clients.length) cfg.so.clients = [{ name: "Kitsch", match: "kitsch", rules: "3 = 6x6x6 Box\n10 = 10x9x4 Box\n19 = 12x9x4 Box\n* = 13x10x8_BOX" }]; return cfg.so.clients; }
function cliStore() { const c = clients()[cliEdit]; if (!c) return; c.name = $("cliName").value.trim() || c.name || "Client"; c.rules = $("soRules").value.trim(); }
function cliShow() {
  const list = clients(); if (cliEdit >= list.length) cliEdit = 0;
  $("cliSel").innerHTML = list.map((c, i) => `<option value="${i}">${esc(c.name)}</option>`).join("");
  $("cliSel").value = String(cliEdit);
  const c = list[cliEdit]; $("cliName").value = c.name || ""; $("soRules").value = c.rules || "";
}
function cliMain() {
  const list = clients(); const sel = $("cliMain");
  sel.innerHTML = list.map((c) => `<option>${esc(c.name)}</option>`).join("");
  if (!list.some((c) => c.name === cfg.so.client)) cfg.so.client = list[0].name;
  sel.value = cfg.so.client;
  const c = list.find((x) => x.name === cfg.so.client);
  $("cliInfo").innerHTML = c ? `Boxes: ${esc((c.rules || "").split(/\n/).filter(Boolean).map((l) => l.replace(/\s*=\s*/, " → ").replace(/^\*/, "more")).join(" · "))}` : "";
}
$("cliMain").onchange = () => { cfg.so.client = $("cliMain").value; cliMain(); saveSoon(); };
$("cliSel").onchange = () => { cliStore(); cliEdit = +$("cliSel").value; cliShow(); };
$("cliAdd").onclick = () => { cliStore(); clients().push({ name: "New client", match: "", rules: "3 = 6x6x6 Box\n* = 12x9x4 Box" }); cliEdit = clients().length - 1; cliShow(); $("cliName").select(); };
$("cliDel").onclick = () => {
  if (clients().length < 2) { $("saveOut").innerHTML = '<span class="bad">Keep at least one client</span>'; return; }
  if (!$("cliDel").dataset.armed) { $("cliDel").dataset.armed = "1"; $("cliDel").textContent = "Delete?"; setTimeout(() => { delete $("cliDel").dataset.armed; $("cliDel").textContent = "🗑"; }, 3000); return; }
  clients().splice(cliEdit, 1); cliEdit = 0; cliShow();
};
$("saveSet").onclick = async () => {
  readSettings(); cliStore();
  for (const c of clients()) {
    const bad = (c.rules || "").split(/\n/).filter((l) => l.trim() && !/^\s*(\d+|\*)\s*=\s*\S/.test(l));
    if (bad.length) { $("saveOut").innerHTML = `<span class="bad">${esc(c.name)}: box rule not understood: “${esc(bad[0])}”</span>`; return; }
    if (!(c.rules || "").trim()) { $("saveOut").innerHTML = `<span class="bad">${esc(c.name)}: add at least one box rule</span>`; return; }
  }
  const names = clients().map((c) => c.name.toLowerCase());
  if (new Set(names).size !== names.length) { $("saveOut").innerHTML = '<span class="bad">Two clients have the same name</span>'; return; }
  await saveCfg(); cliShow(); $("saveOut").innerHTML = '<span class="ok">Saved ✓</span>';
};
$("testBulk").onclick = async () => { readSettings(); await saveCfg(); $("testBulkOut").textContent = "…"; const r = await send("testSheet", { which: "bulk" }); $("testBulkOut").innerHTML = !r.ok ? `<span class="bad">✗ ${esc(r.error)}</span>` : r.version >= 11 ? `<span class="ok">✓ Connected — script v${r.version} (up to date)</span>` : `<span class="bad">Connected, but the script is OLD (${r.version ? "v" + r.version : "before v11"}). Update it — steps below.</span>`; $("howTo").open = !(r.ok && r.version >= 11); };
$("testSo").onclick = async () => {
  readSettings(); await saveCfg(); $("testSoOut").textContent = "Reading…";
  const r = await send("testSheet", { which: "so", openSheet: (curSheet() || {}).url || "" });
  $("testSoOut").innerHTML = r.ok
    ? `<span class="ok">✓ ${esc(r.file || "")} › ${esc(r.sheet)} · Order Id ${r.cols ? r.cols.id || "—" : "?"} · Order Number ${r.cols ? r.cols.order : "?"} · Status ${r.cols ? r.cols.status : "?"} · last row ${r.last}</span>\n` + ((r.items || []).map((x) => `row ${x.row}: ${x.id ? x.id + " · " : ""}${x.order} · ${x.status || "(empty)"}${x.sci ? "  ⚠ number lost (E+)" : ""}`).join("\n") || "(no orders in those rows)")
    : `<span class="bad">✗ ${r.error}${/Unknown action/i.test(r.error || "") ? " — update the Apps Script to v6" : ""}</span>`;
};

function syncMain() {
  cfg.speed = +$("speed").value || 4; cfg.bulkSpeed = +$("bulkSpeed").value || 2;
  cfg.so.from = $("from").value.replace(/\D/g, ""); cfg.so.to = $("to").value.replace(/\D/g, "");
  cfg.so.skipDone = $("skipDone").checked; cfg.ownWindow = $("ownWin").checked;
  if ($("cliMain").value) cfg.so.client = $("cliMain").value;
}
// ---------------- mode ----------------
function setMode(m) {
  mode = m; try { localStorage.setItem("scb.mode", m); } catch {}
  document.querySelectorAll("#modeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("soView").classList.toggle("hide", m !== "so"); $("bulkView").classList.toggle("hide", m !== "bulk");
  showSteps();
}
document.querySelectorAll("#modeSeg button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

// ---------------- buttons ----------------
$("soStart").onclick = async () => {
  if (so && so.running && so.paused) return send("soResume");
  await findOpenSheet();
  if (!curSheet()) { $("soFile").innerHTML = '<span class="bad">Open your Google Sheet in this window first (or + Add its link).</span>'; return; }
  syncMain(); await saveCfg(); send("soStart", { fresh: false, openSheet: curSheet().url, speed: cfg.speed });
};
$("soFresh").onclick = async () => { if (so && so.running) return; await findOpenSheet(); syncMain(); await saveCfg(); send("soStart", { fresh: true, openSheet: (curSheet() || {}).url || "", speed: cfg.speed }); };
$("soPause").onclick = () => send(so && so.paused ? "soResume" : "soPause");
$("soStop").onclick = () => send("soStop");
$("bGen").onclick = async () => { syncMain(); await saveCfg(); send("bulkStart", { mode: "gen" }); };
$("bDl").onclick = async () => { syncMain(); await saveCfg(); send("bulkStart", { mode: "dl" }); };
$("bStop").onclick = () => send("bulkStop");
$("clearLog").onclick = () => send("clearLog");
$("copyLog").onclick = () => navigator.clipboard.writeText(logs.map((l) => `${new Date(l.t).toLocaleTimeString()}  ${l.m}`).join("\n"));

// ---------------- render ----------------
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function step(k, st) { const el = document.querySelector(`[data-step="${k}"]`); if (el) el.className = "st" + (st ? " " + st : ""); }
const STAGE = { load: "loading", search: "searching", open: "opening", pack: "packing items", box: "choosing box", complete: "completing" };
function renderSO() {
  const s = so;
  const left = s ? (s.items.length - s.pos) + (s.retry || []).length : 0;
  const active = s ? Object.entries(s.active || {}) : [];
  $("sOk").textContent = s ? s.ok + (s.dryOk ? ` +${s.dryOk}` : "") : 0;
  $("sFail").textContent = s ? s.fail : 0;
  $("sLeft").textContent = s ? left + active.length : 0;
  $("sWritten").textContent = s ? s.written : 0;
  const running = !!(s && s.running);
  $("soStart").textContent = running && s.paused ? "▶ Resume" : (!running && s && left > 0 ? "▶ Continue" : "▶ Start");
  $("soStart").disabled = running && !s.paused;
  $("soPause").disabled = !running; $("soPause").textContent = s && s.paused ? "▶ Resume" : "⏸ Pause";
  $("soStop").disabled = !running; $("soFresh").disabled = running; $("soTest").disabled = running;
  const nf = s && !running ? (s.failed || []).filter((f) => f.item).length : 0;          // ↻ Retry failed after a run
  $("soRetry").classList.toggle("hide", !nf); $("soRetry").textContent = `↻ Retry failed (${nf})`;
  // speed
  const d = s && s.durations && s.durations.length ? s.durations.reduce((a, b) => a + b, 0) / s.durations.length : 0;
  $("rate").textContent = running && d ? `≈ ${(60000 / d * Math.max(1, active.length)).toFixed(1)} orders/min` : "";
  // steps
  step("read", s ? "done" : ""); step("work", running ? (s.paused ? "wait" : "done") : s && s.finishedAt ? "done" : "");
  step("write", s && s.writes && s.writes.length ? "wait" : s && s.written ? "done" : ""); step("done", s && s.finishedAt && !running ? (s.fail ? "bad" : "done") : "");
  // tabs
  $("soTabs").innerHTML = active.map(([, a], i) => `<div><i>${i + 1}</i> row ${a.item.row} · <b>${esc(a.item.order || a.item.id)}</b> <span class="muted">${STAGE[a.stage] || (a.via === "search" ? "searching" : "opening")}</span></div>`).join("")
    + (s && s.paused ? `<div class="warn">Paused — ${(s.idle || []).length} tab(s) waiting</div>` : "")
    + (s && s.writes && s.writes.length ? `<div class="muted">⏳ ${s.writes.length} result(s) waiting to be written to the sheet…</div>` : "");
  // failed list
  const f = s && s.failed || [];
  $("soProbs").classList.toggle("hide", !f.length);
  if (f.length) {
    $("soProbs").innerHTML = `<b>${f.length} order(s) need a look</b> <button id="cpF">Copy list</button><div class="pl">${f.map((x) => esc(`row ${x.row}\t${x.order}\t${x.msg}`)).join("\n")}</div>`;
    $("cpF").onclick = () => navigator.clipboard.writeText("Row\tOrder\tProblem\n" + f.map((x) => `${x.row}\t${x.order}\t${x.msg}`).join("\n"));
  }
  $("soAlert").classList.toggle("hide", !(s && s.dry && running));
  $("soAlert").textContent = "🧪 TEST RUN — first 5 orders: Complete order is not clicked and nothing is written to the sheet.";
}
function bstep(k, st) { const el = document.querySelector(`[data-bstep="${k}"]`); if (el) el.className = "st" + (st ? " " + st : ""); }
function renderBulk() {
  const q = queue || {};
  const has = (q.items || []).length > 0;
  bstep("read", has ? "done" : "");
  bstep("gen", q.mode === "gen" ? (q.running ? "wait" : "done") : q.mode === "dl" ? "done" : "");
  bstep("dl", q.mode === "dl" ? (q.running ? "wait" : "done") : "");
  bstep("done", has && !q.running && q.mode === "dl" ? "done" : "");
  const act = Object.values(q.active || {});
  $("bAt").textContent = q.i || 0; $("bTotal").textContent = (q.items || []).length; $("bActive").textContent = q.running ? act.length : 0;
  $("bMode").textContent = q.mode ? (q.mode === "dl" ? "download" : "generate") + (q.running ? "" : " ✓") : "—";
  $("bGen").disabled = $("bDl").disabled = !!q.running; $("bStop").disabled = !q.running;
  $("bTabs").innerHTML = q.running ? act.map((a, i) => `<div><i>${i + 1}</i> ${esc(a.label || "row " + a.row)}${a.rounds ? ` <span class="muted">status #${a.rounds + 1}</span>` : ""}${a.step ? ` <span class="muted">· ${esc(a.step)}</span>` : ""}</div>`).join("") : "";
}
function renderLog() {
  const el = $("log"); const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  el.innerHTML = logs.slice(-250).map((l) => `<div class="${l.c}">${new Date(l.t).toLocaleTimeString()}  ${esc(l.m)}</div>`).join("");
  if (atEnd) el.scrollTop = el.scrollHeight;
}
async function load() {
  const r = await send("state");
  cfg = r.cfg; so = r.so; queue = r.queue; logs = r.log || [];
  fillMain(); renderSO(); renderBulk(); renderLog(); setMode(mode);
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "session") {
    if (ch.so) { so = ch.so.newValue; renderSO(); }
    if (ch.queue) { queue = ch.queue.newValue; renderBulk(); }
    if (ch.log) { logs = ch.log.newValue || []; renderLog(); }
  }
  if (area === "local" && ch.cfg && ch.cfg.newValue && $("settings").classList.contains("hide")) {
    const prevSo = (cfg && cfg.so) || {};
    cfg = Object.assign(cfg || {}, ch.cfg.newValue); cfg.so = Object.assign({}, prevSo, ch.cfg.newValue.so || {});
    if (!(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) fillMain();
  }
});
// ---------------- Bulk Ship switches (copied into every ShipHero page) ----------------
let pflags = {};
function bulkGate() {     // the page switches only matter while Bulk Ship automation is ON
  const on = pflags["shipcubeBot.bulkOn"] === "1";
  document.querySelectorAll("#bulkSw input, #bulkSw select").forEach((el) => (el.disabled = !on));
  $("bulkSw").style.opacity = on ? "1" : ".45";
  $("bulkOffNote").classList.toggle("hide", on);
}
function fillPflags() {
  document.querySelectorAll("[data-pf]").forEach((el) => {
    const v = pflags[el.dataset.pf] != null ? String(pflags[el.dataset.pf]) : el.dataset.def;
    if (el.type === "checkbox") el.checked = v === "1"; else el.value = v;
  });
  bulkGate();
}
document.querySelectorAll("[data-pf]").forEach((el) => (el.onchange = () => {
  pflags[el.dataset.pf] = el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value;
  chrome.storage.local.set({ pflags });
}));
document.querySelectorAll("[data-cmd]").forEach((b) => (b.onclick = () => send("pageCmd", { cmd: b.dataset.cmd })));
chrome.storage.local.get("pflags", (r) => { pflags = (r && r.pflags) || {}; fillPflags(); });
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.pflags) { pflags = ch.pflags.newValue || {}; fillPflags(); }
  if (area === "session" && ch.debug && ch.debug.newValue) navigator.clipboard.writeText(ch.debug.newValue.text).then(() => logs.push({ t: Date.now(), m: "Debug info copied — paste it to Claude.", c: "ok" }) && renderLog(), () => {});
});
// ---------------- Tab (sub-sheet) list + the columns found on it ----------------
let tabsFor = null, detT = null;
function markOpenTab() {        // in Auto: show which tab is open next to "The subsheet you have open"
  const g = gidOf(openSheet), sel = $("tabSel");
  [...sel.options].forEach((o) => { o.textContent = o.textContent.replace(/\s+\((open|in the link)\)$/, ""); if (o.dataset.gid && o.dataset.gid === (isAuto() ? g : o.dataset.link)) o.textContent += isAuto() ? "  (open)" : "  (in the link)"; });
}
async function loadTabs(force) {
  const sh = curSheet(); const key = sh ? sheetKey(sh.url) + (isAuto() ? "" : "|" + sh.url) : "";
  const sel = $("tabSel");
  if (!key) { sel.innerHTML = `<option value="">${isAuto() ? "The subsheet you have open" : "—"}</option>`; $("colInfo").textContent = ""; return; }
  if (!force && tabsFor === key) return;
  tabsFor = key;
  sel.innerHTML = '<option value="">Loading subsheets…</option>';
  const r = await send("soTabs", { openSheet: sh.url });
  const keep = cfg.so.pickTab || "";
  sel.innerHTML = `<option value="">${isAuto() ? "The subsheet you have open" : "The subsheet in the link"}</option>`;
  if (!r.ok) {
    $("colInfo").innerHTML = /Unknown action/i.test(r.error || "") ? `<span class="warn">${OLD_SCRIPT}</span>` : `<span class="bad">${esc(r.error)}</span>`;
    return;
  }
  (r.tabs || []).forEach((t) => { const o = document.createElement("option"); o.value = t.name; o.textContent = t.name; o.dataset.gid = t.gid; o.dataset.link = r.open || ""; sel.appendChild(o); });
  markOpenTab();
  const valid = (r.tabs || []).some((t) => t.name === keep);
  sel.value = valid ? keep : "";
  if (!valid && keep) { cfg.so.pickTab = ""; saveCfg(); }
  detect();
}
function detect() {
  clearTimeout(detT);
  detT = setTimeout(async () => {
    if (!curSheet()) return;
    if (cfg.so.manualCols && cfg.so.orderCol) { $("colInfo").innerHTML = `Columns from Settings: Order Id <b>${cfg.so.idCol || "—"}</b> · Order Number <b>${cfg.so.orderCol}</b> · Status <b>${cfg.so.statusCol}</b>`; return; }
    $("colInfo").textContent = "Finding the columns…";
    const r = await send("soDetect", { openSheet: (curSheet() || {}).url || "" });
    $("colInfo").innerHTML = r.ok && r.cols
      ? `<span class="ok">✓</span> subsheet <b>${esc(r.sheet)}</b>: Order Id <b>${r.cols.id || "—"}</b> · Order Number <b>${r.cols.order}</b> · Status <b>${r.cols.status}</b>`
      : `<span class="bad">${esc(r.error || "columns not found")}</span>`;
  }, 400);
}
$("tabSel").onchange = async () => { cfg.so.pickTab = $("tabSel").value; await saveCfg(); detect(); };
$("tabRef").onclick = () => loadTabs(true);
chrome.tabs.onActivated.addListener(() => findOpenSheet());
chrome.tabs.onUpdated.addListener((id, ch) => { if (ch.url || ch.title) findOpenSheet(); });
window.addEventListener("focus", () => findOpenSheet());
setInterval(() => { if (!document.hidden) findOpenSheet(); }, 2000);     // the #gid= changes when you click another sheet tab
// ---------------- updates (git pull) + team config ----------------
function showUpdate(u) {
  const bar = $("updBar");
  if (!u || !u.version) { bar.classList.add("hide"); return; }
  bar.classList.remove("hide");
  $("updTxt").innerHTML = u.busy ? `Update <b>v${esc(u.version)}</b> pulled — it installs when this run finishes.` : `Update <b>v${esc(u.version)}</b> pulled — reloading…`;
}
$("updBtn").onclick = () => send("reloadNow");
chrome.storage.session.get("update", (r) => showUpdate(r && r.update));
chrome.storage.onChanged.addListener((ch, area) => { if (area === "session" && ch.update) showUpdate(ch.update.newValue); });
async function teamInfo() {
  const v = (await chrome.storage.local.get("teamVer")).teamVer;
  $("teamInfo").innerHTML = `This PC: bot <b>v${chrome.runtime.getManifest().version}</b> · team settings <b>${v ? esc(v) : "not loaded"}</b>`;
}
$("testBulkSheet").onclick = async () => {
  readSettings(); await saveCfg(); $("testBulkSheetOut").textContent = "…";
  if (!cfg.bulkUrl) { $("testBulkSheetOut").innerHTML = '<span class="bad">Paste the Bulk Ship sheet\'s web app link</span>'; return; }
  const r = await send("testSheet", { which: "bulkSheet" });
  $("testBulkSheetOut").innerHTML = r.ok ? `<span class="ok">✓ ${esc(r.sheet)} — columns: ${esc((r.columns || []).join(", "))}${r.version ? ` · script v${r.version}` : ""}</span>` : `<span class="bad">✗ ${esc(r.error)}</span>`;
};
$("teamExport").onclick = async () => {
  readSettings(); cliStore(); await saveCfg();
  const pf = (await chrome.storage.local.get("pflags")).pflags || {};
  const now = new Date(), pad = (n) => String(n).padStart(2, "0");
  const t = {
    configVersion: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    webAppUrl: cfg.url || "", password: cfg.token || "",
    bulkWebAppUrl: cfg.bulkUrl || "", bulkPassword: cfg.bulkToken || "",
    speed: cfg.speed || 4, bulkSpeed: cfg.bulkSpeed || 2, ownWindow: cfg.ownWindow !== false,
    sheets: (cfg.so.sheets || []).map((x) => ({ name: x.name, url: x.url })),
    client: cfg.so.client || "",
    clients: clients().map((c) => ({ name: c.name, match: c.match || "", rules: String(c.rules || "").split(/\n/).filter(Boolean) })),
    completedWord: cfg.so.value || "Completed", errorWord: cfg.so.errValue || "Error", alreadyWord: cfg.so.alreadyValue || "Already Fulfilled", skipCompleted: cfg.so.skipDone !== false,
    bulkSwitches: Object.fromEntries(Object.entries(pf).filter(([k]) => !["shipcubeBot.bulkOn", "shipcubeBot.autogen"].includes(k))),
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(t, null, 2) + "\n"], { type: "application/json" }));
  a.download = "team-config.json"; a.click();
  $("teamOut").innerHTML = '<span class="ok">Downloaded ✓</span> Put it in the bot folder (replace the old one), then commit + push.';
};
$("teamLoad").onclick = async () => {
  const r = await send("teamLoad");
  $("teamOut").innerHTML = r.ok ? `<span class="ok">✓ Team settings “${esc(r.version)}” loaded</span>` : `<span class="bad">${esc(r.error)}</span>`;
  const st = await send("state"); cfg = st.cfg; fillMain(); openSettings(); teamInfo();
};
$("updCheck").onclick = async () => {
  const r = await send("checkUpdate");
  $("teamOut").innerHTML = r.update ? `Update v${esc(r.update.version)} found.` : `<span class="ok">Up to date (v${chrome.runtime.getManifest().version}).</span> Pulled already? Run UPDATE.bat first.`;
};
teamInfo();
load().then(async () => { showSheet(); await findOpenSheet(); loadTabs(true); });
