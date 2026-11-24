# ShipCube Bot (ShipHero) — changes

Every change bumps the version in `manifest.json`. The side panel shows the version under the bot's name.

| Version | What changed |
|---|---|
| 2.3.0 | Bulk Ship kept separate: it only runs when **Bulk Ship automation** is ON on that PC (default OFF) or inside ▶ Generate all / ▶ Download all. Generate labels is clicked ONLY by ▶ 1. Generate all. Old auto-generate switch reset; never shared via team-config. |
| 2.2.0 | Git updates: the bot reloads itself after `git pull` (UPDATE.bat). Shared team settings in `team-config.json` (Settings › Team & updates › Export). |
| 2.1.4 | Bulk-ship orders → `Error (bulk ship)`. Error rows get a red Order Number + Status cell (sheet script v10). |
| 2.1.3 | "Tab" renamed **Subsheet**. Speed up to 10×. |
| 2.1.2 | New logo (ShipHero blue + "SHIPHERO BOT" tag). |
| 2.1.1 | Old Apps Script shows a clear message + update steps; "Sts" accepted as Status column (script v9). |
| 2.1.0 | ShipHero colour theme. |
| 2.0.x | Side panel, Single orders (multi-tab), clients & box rules, auto sheet/subsheet/column detection, already-fulfilled → Completed, `Error (reason)`, Bulk Ship queue in parallel tabs, old in-page panel removed. |
