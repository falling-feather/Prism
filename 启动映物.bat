@echo off
chcp 65001 >nul
cd /d "%~dp0app"
pwsh -NoProfile -File "%~dp0app\tools\launch.ps1"
if errorlevel 1 pause
