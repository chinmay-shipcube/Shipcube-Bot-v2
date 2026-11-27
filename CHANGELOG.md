# ShipCube Bot (ShipHero) — changes

Every change bumps the version in `manifest.json`. The side panel shows the version under the bot's name.

| Version | What changed |
|---|---|
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
