@echo off
rem Installs Cutsona from this folder: the tools it needs, speech tools, and Desktop / Start menu shortcuts. See install.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 ( pause ) else ( timeout /t 5 >nul )
