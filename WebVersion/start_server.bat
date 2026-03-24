@echo off
setlocal EnableExtensions

cd /d "%~dp0"
if exist "Start.html" (
  start "" "Start.html"
  exit /b 0
)
if exist "index.html" (
  start "" "index.html"
  exit /b 0
)
echo [ERROR] Start.html or index.html not found.
pause
exit /b 1
