@echo off
rem Primini sync launcher for the office PC (scheduled task "PricePilot - Primini sync").
rem Reads DATABASE_URL from .env.supabase (never committed) and appends the output to a log file.
setlocal
cd /d "%~dp0.."
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env.supabase") do set "%%a=%%b"
set "LOGDIR=%LOCALAPPDATA%\PricePilot"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "BUN=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun-windows-x64\bun.exe"
echo ===== %DATE% %TIME% ===== >> "%LOGDIR%\primini-sync.log"
"%BUN%" scripts\primini-sync.ts >> "%LOGDIR%\primini-sync.log" 2>&1
echo exit code %ERRORLEVEL% >> "%LOGDIR%\primini-sync.log"
endlocal
