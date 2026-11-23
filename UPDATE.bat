@echo off
title ShipCube Bot - update
cd /d "%~dp0"
echo Updating ShipCube Bot...
echo.
git pull --ff-only
if errorlevel 1 (
  echo.
  echo Update FAILED. If it says "local changes", run:  git checkout -- .   then try again.
  echo Or ask Chinu.
  pause
  exit /b 1
)
echo.
echo Done. Chrome reloads the bot by itself within 30 seconds (when it is not running).
echo Then refresh any open ShipHero tabs.
timeout /t 8
