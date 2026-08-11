@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title WhereMusic

echo.
echo  ========================================
echo   WhereMusic - local run
echo  ========================================
echo.

call :RefreshNodePath

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install LTS from https://nodejs.org
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Reinstall Node.js.
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python not found. Install Python 3.11+ and check "Add to PATH".
  pause
  exit /b 1
)

echo Node.js:
node -v
echo Python:
python --version
echo.

if not exist "node_modules\" (
  echo [INSTALL] npm packages...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
  )
)

python -c "import rapidocr_onnxruntime,PIL,numpy,imageio_ffmpeg,scipy" >nul 2>&1
if errorlevel 1 (
  echo [INSTALL] Python analyze packages...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] pip install failed
    pause
    exit /b 1
  )
)

where yt-dlp >nul 2>&1
if errorlevel 1 (
  echo [WARN] yt-dlp not found. Trying pip install yt-dlp...
  python -m pip install yt-dlp
  where yt-dlp >nul 2>&1
  if errorlevel 1 (
    echo [WARN] yt-dlp still missing. YouTube download/analyze may fail.
    echo        Install: winget install yt-dlp  or  pip install yt-dlp
    echo.
  )
)

echo [1/2] Starting analyze API  -^> http://127.0.0.1:18790
start "WhereMusic-Analyze" cmd /k "cd /d "%~dp0" && set PYTHONIOENCODING=utf-8 && python scripts\analyze_server.py"

ping -n 3 127.0.0.1 >nul

echo [2/2] Starting Vite UI      -^> http://127.0.0.1:5190
start "WhereMusic-UI" cmd /k "cd /d "%~dp0" && npm.cmd run dev"

ping -n 6 127.0.0.1 >nul
start "" http://127.0.0.1:5190

echo.
echo Started:
echo   - WhereMusic-Analyze  (분석 서버 :18790)
echo   - WhereMusic-UI       (화면 :5190)
echo   - Browser: http://127.0.0.1:5190
echo.
echo 종료: 각 창에서 Ctrl+C 후 창 닫기
echo 이 창은 닫아도 됩니다.
echo.
pause
endlocal
exit /b 0

:RefreshNodePath
if exist "%ProgramFiles%\nodejs\" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LocalAppData%\Programs\nodejs\" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"
exit /b 0
