@echo off
title CookSync Server
cd /d "C:\Users\daito\projects\fridge-app" || exit /b 1

rem Skip if already running (avoid EADDRINUSE double-start)
netstat -an | findstr "LISTENING" | findstr ":3000 " >nul
if not errorlevel 1 (
  echo [CookSync] Already running on port 3000. Nothing to do.
  timeout /t 5 >nul
  exit /b 0
)

rem Build once if missing (first run or after deleting .next)
if not exist ".next\BUILD_ID" (
  echo [CookSync] Building... about 1 min
  call npm run build
)

echo [CookSync] Starting server on port 3000.
echo   PC   : http://localhost:3000
echo   Phone: https://node.tail41e069.ts.net   (Tailscale ON)
echo   Keep this window open. Output goes to server.log
set PORT=3000
call npm run start -- -H 0.0.0.0 -p 3000 >> "%~dp0server.log" 2>&1

echo [CookSync] Server stopped. Check server.log for the reason.
pause
