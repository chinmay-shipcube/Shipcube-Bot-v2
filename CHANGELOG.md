# ShipCube Bot (ShipHero) — changes

Every change bumps the version in `manifest.json`. The side panel shows the version under the bot's name.

| Version | What changed |
|---|---|
| 2.9.6 | Allocation errors: "We can't seem to allocate 505954" is now written in Status as just "error sku - 505954" (several SKUs joined with commas). New "Copy SKUs" button in the "need a look" list copies only the SKUs, one per line. |
| 2.9.5 | “The order is locked by another user”: the order is no longer marked as failed at once - it goes to the end of the queue and is tried again after 45 s, up to 3 times; only then it is written as an error.
| 2.9.4 | The “run finished” notification always shows (no option); ⚙ Settings › Sound only has the Play the sound tick, Test and Stop sound.
| 2.9.3 | ▶ Continue / Resume now also retry the waiting results at once, and a run that gave up writing retries every minute by itself (it no longer stays blocked until “Write now”).
| 2.9.2 | Sheet writes are much faster: sheet script v13 writes 66 rows with ~9 calls instead of ~270 (it was timing out at 60 s and piling up). A busy script answers “busy” instead of Google's error page; the bot sends smaller batches (60). Update the Apps Script (paste + New version).
| 2.9.1 | ⚙ Settings › Notification & sound: tick Show notification / Play the sound separately, 🔔 Test notification and ■ Stop sound buttons.
| 2.9.0 | Notification + sound (done.mp3) when a Single orders or Bulk Ship run finishes; tick box “🔔 Notification + sound when a run finishes” (on by default). Needs the new notifications + offscreen permissions.
| 2.8.4 | An unfinished run saved by an older version now offers ▶ Start (new run) instead of ▶ Continue, so it can no longer carry on with old columns.
| 2.8.3 | Changed rows / columns / sheet / subsheet / client / check while paused or stopped → the button says ▶ Start (a NEW run with the new settings; the old run ends and its results are written first) instead of Resume / Continue. Changing only the speed keeps Resume.
| 2.8.2 | Red banner “Error printing … [Details]”: the bot clicks Details, copies the “Error details” text (e.g. Variable $data … shipping_carrier), closes it and writes that text in Status (red).
| 2.8.1 | Kitsch product rules are built in (no tick box, not editable) and always apply to the Kitsch client.
| 2.8.0 | Kitsch product rules (tick “Apply product rules” under Client): shampoo / conditioner / brush → 1–3 units 12x6x4 Box, above 3 → 14x10x6 Box; SKU 504261 and “Glazey” → 14x10x6 Box always. Edit them in ⚙ Settings › Clients. The bigger box wins when several rules (or the quantity rule) apply.
| 2.7.6 | Only the Status cell turns red on an error (not the Order Number); the red is removed when the order is fixed. Sheet script v12 (paste + New version); old red Order Number cells get their neighbours' colour back when fixed.
| 2.7.5 | The run stops by itself when the rows are done (like the Tracking Bot): bot tabs and window close, a stale “opening” tab can no longer hold it open, and the watchdog finishes a run that has nothing left.
| 2.7.4 | Test run removed completely (button, first-5 mode and its banner). ▶ Start always really completes orders.
| 2.7.3 | Error run is now a tick box (like “Bot tabs in their own window”) and ▶ Start does the work. It now catches every error row - also the ones with ShipHero's own message (e.g. “We can't seem to allocate…”), not only “Error (…)”.
| 2.7.2 | Fixed the Chrome “inline script blocked” error in the side panel (dark-theme start-up code moved to theme.js).
| 2.7.1 | Sheet script v12. Needs the new sheet script v12 (paste + New version); v11 still works as before.
| 2.7.0 | ⚠ Error run replaces Test run: runs only the rows whose Status says Error (in the From / To range).
| 2.6.5 | When Google answers with a web page (busy / too many requests) the bot retries 3 more times (3 s, 8 s, 15 s) and the message now shows what the page says; sheet writes go out every ~4 s instead of 2.5 s (fewer calls).
| 2.6.4 | Rows already Completed / Already Fulfilled are always skipped (tick box removed; use Check › Only Error / Only blank to redo others). Clearer message when the Google link needs “Anyone” access.
| 2.6.3 | “Writing…” can no longer hang: the panel shows why a write failed, retries with smaller batches, and after 10 tries stops with “Write now” and “Copy results” buttons (the run still finishes).
| 2.6.2 | Results reach the sheet quickly: the write timer no longer restarts with every finished order (that kept postponing the write while tabs kept finishing); a write goes out every ~2.5 s, the rest right after.
| 2.6.1 | Click “row N” (in the tab list or the need-a-look list) → the sheet jumps to that row; click a tab entry → that ShipHero tab comes to the front. Greyed column boxes are darker; “Set them myself” moved to the left.
| 2.6.0 | One Resume button (Start hides while running). Change the speed any time: while paused then ▶ Resume opens that many tabs; while running more tabs open at once, fewer as tabs finish. ■ Stop closes the bot tabs and window. New: Check (All rows / Only blank / Only Error) and ⇅ Reverse, like the Tracking Bot.
| 2.5.2 | Dark theme: 🌙 / ☀️ button in the side panel header (remembered; first time follows your computer).
| 2.5.1 | Columns moved out of Settings onto the main view (above Sheet rows): found automatically, or tick “Set them myself”. |
| 2.5.0 | Completed orders always reach the sheet (no endless wait on Google, pending rows written even after a run). Box chosen patiently (no false “not in box list”, works in small/minimised windows). “##” order-number mismatch fixed; search uses one # (none for 577…). Already-shipped orders opened by Order Id → checked on Single Orders → Already Fulfilled. ↻ Retry failed button. Speed = exactly what the panel shows. No more “not a Kitsch order” check (sheets are already sorted by client). |
| 2.4.2 | Dry run tick box replaced by a 🧪 Test run button (first 5 orders, no Complete, nothing written). Duplicate Back button in Settings removed. |
| 2.4.1 | Bulk Ship has its own sheet link (⚙ Settings › Bulk Ship sheet), separate from Single orders; it is also given to the Bulk Ship pages, so new PCs need no in-page setup. |
| 2.4.0 | Already-fulfilled orders → “Already Fulfilled”. Kitsch: 11–19 → 12x9x4 Box, 20+ → 13x10x8_BOX. ShipHero pop-ups (order on hold, SKU error…) → bot clicks Show details, writes the details in Status (red), clicks Exit Order. Sheet script v11. |
| 2.3.0 | Bulk Ship kept separate: it only runs when **Bulk Ship automation** is ON on that PC (default OFF) or inside ▶ Generate all / ▶ Download all. Generate labels is clicked ONLY by ▶ 1. Generate all. Old auto-generate switch reset; never shared via team-config. |
| 2.2.0 | Git updates: the bot reloads itself after `git pull` (UPDATE.bat). Shared team settings in `team-config.json` (Settings › Team & updates › Export). |
| 2.1.4 | Bulk-ship orders → `Error (bulk ship)`. Error rows get a red Order Number + Status cell (sheet script v10). |
| 2.1.3 | "Tab" renamed **Subsheet**. Speed up to 10×. |
| 2.1.2 | New logo (ShipHero blue + "SHIPHERO BOT" tag). |
| 2.1.1 | Old Apps Script shows a clear message + update steps; "Sts" accepted as Status column (script v9). |
| 2.1.0 | ShipHero colour theme. |
| 2.0.x | Side panel, Single orders (multi-tab), clients & box rules, auto sheet/subsheet/column detection, already-fulfilled → Completed, `Error (reason)`, Bulk Ship queue in parallel tabs, old in-page panel removed. |
