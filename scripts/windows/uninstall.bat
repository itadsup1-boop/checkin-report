@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul 2>&1

:: ==============================================================
::  scripts\windows\uninstall.bat — Go cai dat He Thong KPI
::  Yeu cau: Quyen Administrator
:: ==============================================================

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\..\"
pushd "%PROJECT_ROOT%"
set "PROJECT_ROOT=%CD%"
popd

net session > nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b 0
)

echo.
echo ==========================================================
echo    GO CAI DAT HE THONG KPI TELEGRAM REPORT
echo    %DATE% %TIME:~0,5%
echo ==========================================================
echo.
echo  [CANH BAO] Hanh dong nay se:
echo    1. Dung va xoa PM2 processes (kpi-api, timekeep-bot)
echo    2. Xoa Task Scheduler "KPI-System-Autostart"
echo    3. Dong cloudflared tunnel
echo    4. Xoa Firewall rules port 3001 va 3002
echo    (Database PostgreSQL se KHONG bi xoa)
echo.
set /p "CONFIRM=  Xac nhan go cai dat (go "yes" de tiep tuc): "
if /i not "%CONFIRM%"=="yes" (
    echo  [INFO] Da huy.
    pause & exit /b 0
)
echo.

echo  [1/4] Dung PM2...
where pm2 > nul 2>&1 && (
    pm2 delete kpi-api 2>nul & pm2 delete timekeep-bot 2>nul
    pm2 save 2>nul & pm2 kill 2>nul
    echo  [OK] PM2 processes da bi xoa.
) || echo  [INFO] PM2 khong duoc cai - bo qua.

echo  [2/4] Dung cloudflared...
taskkill /F /IM cloudflared.exe 2>nul && echo  [OK] cloudflared da dung. || echo  [INFO] cloudflared khong chay.

echo  [3/4] Xoa Task Scheduler...
schtasks /Delete /TN "KPI-System-Autostart" /F > nul 2>&1
if %errorlevel% equ 0 (echo  [OK] Task da bi xoa.) else (echo  [INFO] Task khong ton tai.)

echo  [4/4] Xoa Firewall rules...
powershell -NoProfile -Command "Remove-NetFirewallRule -DisplayName 'KPI-API-3001' -ErrorAction SilentlyContinue"
powershell -NoProfile -Command "Remove-NetFirewallRule -DisplayName 'KPI-Bot-3002' -ErrorAction SilentlyContinue"
echo  [OK] Firewall rules da bi xoa.

echo.
set /p "DEL_LOGS=  Xoa log files? (Y/N): "
if /i "%DEL_LOGS%"=="Y" (
    del "%PROJECT_ROOT%\cloudflare.log" "%PROJECT_ROOT%\cf_err.log" "%PROJECT_ROOT%\startup.log" 2>nul
    echo  [OK] Log files da xoa.
)

if exist "%SCRIPT_DIR%cloudflared.exe" (
    set /p "DEL_CF=  Xoa cloudflared.exe? (Y/N): "
    if /i "!DEL_CF!"=="Y" (
        del "%SCRIPT_DIR%cloudflared.exe" 2>nul
        echo  [OK] cloudflared.exe da xoa.
    )
)

echo.
echo ==========================================================
echo    GO CAI DAT HOAN TAT!
echo ==========================================================
echo  Source code, .env, database PostgreSQL KHONG bi xoa.
echo  De cai lai: scripts\windows\install.bat
echo.
pause
endlocal
