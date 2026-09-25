@echo off
chcp 65001 >nul
cd /d "%~dp0"
pwsh -NoProfile -File "%~dp0tools\launch.ps1"
if errorlevel 1 pause
