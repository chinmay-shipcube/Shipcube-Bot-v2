# ShipCube Bot (ShipHero)

Chrome extension (side panel) for ShipHero:

* **Single orders** — reads order numbers from a Google Sheet, opens each order in several ShipHero tabs at once,
  packs the items, picks the box from the client's rules, clicks **Complete order** and writes
  `Completed` / `Error (reason)` into the sheet.
* **Bulk ship** — Generate all / Download all from the sheet, several links at once.

---

## 1. First install (each PC, once)

1. Install **GitHub Desktop** (https://desktop.github.com) and sign in with the GitHub account that was invited to the repo.
   *(Or Git for Windows if you prefer the command line.)*
2. GitHub Desktop › **File › Clone repository** › choose `shipcube-shiphero-bot` › Local path e.g. `C:\ShipCube\shipcube-shiphero-bot` › **Clone**.
   *(Command line: `git clone https://github.com/<org>/shipcube-shiphero-bot.git C:\ShipCube\shipcube-shiphero-bot`)*
3. Chrome › `chrome://extensions` › turn on **Developer mode** › **Load unpacked** › choose that folder.
   Turn OFF any older "ShipCube Bot" in the list.
4. Pin the bot, click its icon → the side panel opens. Team settings (web app link, sheets, clients) load by themselves from `team-config.json`.

## 2. Updating (whenever Chinu says there's a new version)

* Double-click **`UPDATE.bat`** in the bot folder, **or** GitHub Desktop › **Fetch origin › Pull**, **or** `git pull`.
* That's it — within ~30 seconds the bot sees the new version and **reloads itself** (only when no run is going;
  during a run the panel says "Update pulled — installs when this run finishes", or click **Reload now**).
* Refresh open ShipHero tabs afterwards.
* Check the version under the bot's name in the side panel (e.g. `v2.2.0`).

Never edit the bot files on a team PC — `git pull` stops if files were changed locally
(fix: `git checkout -- .` in the folder, then pull again).

## 3. For the maintainer (Chinu)

**Release a new version**
1. Change the code, bump `"version"` in `manifest.json` (e.g. 2.2.0 → 2.2.1) and add a line to `CHANGELOG.md`.
2. GitHub Desktop: write a summary › **Commit to main** › **Push origin**.
3. Tell the team to run `UPDATE.bat`.

**Share settings with the whole team**
1. Set everything up on your PC (⚙ Settings: web app link, password, sheets, clients & box rules; Bulk ship switches).
2. ⚙ Settings › Team & updates › **⬇ Export team-config.json**.
3. Replace `team-config.json` in the repo with the downloaded file › commit › push.
4. Team PCs get it with their next `UPDATE.bat` (new `configVersion` = loaded once; sheets are *added* to each PC's list, clients & box rules are *replaced*).

**Keep the repo PRIVATE** — `team-config.json` holds the Apps Script web app link and password.

## 4. Google Sheet script

`ShipCube Sheet Script.gs.txt` is the Apps Script behind the web app link (current: **v12** — v11 still works; v12 colours only the Status cell red on an error and clears it when fixed).
When it changes: open the sheet that owns the web app › Extensions › Apps Script › replace everything with the file › Save ›
**Deploy › Manage deployments › ✎ › Version: New version › Deploy** (same link).
⚙ Settings › **Test connection** shows the script version.

## 5. Files

| File | What it is |
|---|---|
| `manifest.json` | extension manifest — **bump the version on every change** |
| `bg.js` | background: queues, tabs, Google Sheet calls, self-update, team config |
| `side.js`, `sidepanel.html` | the side panel |
| `content.js`, `bridge.js` | run inside ShipHero pages (Bulk Ship steps + Single-orders worker) |
| `team-config.json` | shared team settings |
| `ShipCube Sheet Script.gs.txt` | Google Apps Script for the sheet |
| `UPDATE.bat` | one-click `git pull` for the team |
| `HOW TO USE v2.txt` | how to use the panel |
