@echo off
rem Publishes the version in version.json (with its CHANGELOG.md notes) to GitHub. See tools\release.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release.ps1"
pause
