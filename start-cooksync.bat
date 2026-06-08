@echo off
title CookSync Server
cd /d "C:\Users\daito\projects\fridge-app"

rem 本番ビルドが無ければ作る（初回・コード更新後のみ時間がかかる）
if not exist ".next\BUILD_ID" (
  echo [CookSync] Building... (first time only, ~1 min)
  call npm run build
)

echo.
echo [CookSync] Starting server.
echo   PC   : http://localhost:3000
echo   Phone: https://node.tail41e069.ts.net   (Tailscale ON)
echo   Keep this window open while you use the app. Close it to stop.
echo.
call npm run start -- -H 0.0.0.0

echo.
echo [CookSync] Server stopped.
pause
