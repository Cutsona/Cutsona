@echo off
rem One-time setup: sign in to GitHub and upload Cutsona to the private repo Cutsona/Cutsona. See tools\setup-github.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-github.ps1"
pause
