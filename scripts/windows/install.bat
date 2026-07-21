@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul 2>&1

:: ==============================================================
::  scripts\windows\install.bat
::  Cai dat He Thong KPI Telegram Report tren Windows 10/11
::
::  Cach dung:
::    Double-click file nay hoac chay tu PowerShell:
::    > .\scripts\windows\install.bat
::
::  Yeu cau: Windows 10 v1903+ / Windows 11, quyen Admin
:: ==============================================================

:: Lay duong dan goc du an (2 cap tren scripts\windows\)
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\..\"
pushd "%PROJECT_ROOT%"
set "PROJECT_ROOT=%CD%"
popd

:: Kich hoat mau ANSI (Windows 10+)
powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $null=[System.Console]::Out" > nul 2>&1

:: Header
echo.
echo ==========================================================
echo    CAI DAT HE THONG KPI TELEGRAM REPORT - WINDOWS
echo    %DATE% %TIME:~0,5%
echo ==========================================================
echo.

:: Yeu cau quyen Admin de cai phan mem he thong
net session > nul 2>&1
if %errorlevel% neq 0 (
    echo  [CANH BAO] Script nay can quyen Administrator.
    echo  Dang khoi dong lai voi quyen cao hon...
    echo.
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b 0
)

echo  [INFO] Dang chay voi quyen Administrator. OK
echo.

:: ---- Thiet lap ExecutionPolicy cho PowerShell ----
echo  [STEP 0/9] Cau hinh PowerShell ExecutionPolicy...
powershell -NoProfile -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force" > nul 2>&1
echo  [OK] ExecutionPolicy = RemoteSigned
echo.

:: ==============================================================
:: STEP 1 - Kiem tra Node.js v22+
:: ==============================================================
echo  [STEP 1/9] Kiem tra Node.js...
echo  ----------------------------------------

where node > nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=1" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
    :: Lay major version (loai bo chu v)
    for /f "tokens=1 delims=." %%m in ("!NODE_VER:v=!") do set "NODE_MAJOR=%%m"
    if !NODE_MAJOR! geq 22 (
        echo  [OK] Node.js !NODE_VER! da duoc cai - bo qua.
    ) else (
        echo  [CANH BAO] Node.js !NODE_VER! qua cu. Can v22+. Dang nang cap...
        goto :install_node
    )
) else (
    echo  [INFO] Node.js chua duoc cai. Dang cai...
    goto :install_node
)
goto :node_done

:install_node
:: Thu winget truoc
winget --version > nul 2>&1
if %errorlevel% equ 0 (
    echo  [INFO] Dang cai Node.js v22 LTS qua winget...
    winget install --id OpenJS.NodeJS.LTS --version 22 --accept-package-agreements --accept-source-agreements --silent
    if !errorlevel! equ 0 (
        echo  [OK] Node.js da duoc cai qua winget.
        :: Refresh PATH
        for /f "skip=2 tokens=3*" %%a in ('reg query HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment /v Path 2^>nul') do set "SYS_PATH=%%a %%b"
        set "PATH=!SYS_PATH!;%PATH%"
        goto :node_done
    )
)

:: Fallback: Download MSI tu nodejs.org
echo  [INFO] winget khong kha dung. Dang download Node.js MSI...
set "NODE_MSI=%TEMP%\node-v22-x64.msi"
powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri 'https://nodejs.org/dist/latest-v22.x/node-v22.16.0-x64.msi' -OutFile '%NODE_MSI%' -UseBasicParsing"
if exist "%NODE_MSI%" (
    echo  [INFO] Dang cai Node.js tu MSI (co the mat vai phut)...
    msiexec /i "%NODE_MSI%" /quiet /norestart ADDLOCAL=ALL
    del "%NODE_MSI%" > nul 2>&1
    echo  [OK] Node.js da duoc cai tu MSI.
    echo  [INFO] Vui long mo lai cua so Command Prompt/PowerShell moi de refresh PATH.
) else (
    echo  [LOI] Khong the download Node.js. Kiem tra ket noi mang.
    echo.
    echo  Cai thu cong tai: https://nodejs.org/en/download
    echo  Chon: Windows Installer (.msi) - 64-bit - v22 LTS
    pause
    exit /b 1
)

:node_done
echo.

:: ==============================================================
:: STEP 2 - Cai PM2
:: ==============================================================
echo  [STEP 2/9] Kiem tra PM2...
echo  ----------------------------------------

where pm2 > nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=1" %%v in ('pm2 --version 2^>nul') do set "PM2_VER=%%v"
    echo  [OK] PM2 !PM2_VER! da duoc cai - bo qua.
) else (
    echo  [INFO] Dang cai PM2...
    call npm install -g pm2 --silent
    if !errorlevel! equ 0 (
        echo  [OK] PM2 da duoc cai.
    ) else (
        echo  [LOI] Cai PM2 that bai. Kiem tra lai Node.js.
        pause & exit /b 1
    )
)
echo.

:: ==============================================================
:: STEP 3 - Download cloudflared.exe
:: ==============================================================
echo  [STEP 3/9] Kiem tra cloudflared.exe...
echo  ----------------------------------------

set "CF_EXE=%PROJECT_ROOT%\scripts\windows\cloudflared.exe"

if exist "%CF_EXE%" (
    for /f "tokens=3" %%v in ('"%CF_EXE%" --version 2^>nul') do set "CF_VER=%%v"
    echo  [OK] cloudflared !CF_VER! da co - bo qua.
) else (
    echo  [INFO] Dang download cloudflared.exe tu Cloudflare...
    set "CF_URL=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    powershell -NoProfile -Command ^
        "try { Invoke-WebRequest -Uri '!CF_URL!' -OutFile '!CF_EXE!' -UseBasicParsing; Write-Host '  [OK] Download thanh cong.' } catch { Write-Host ('  [LOI] ' + $_.Exception.Message); exit 1 }"
    if !errorlevel! neq 0 (
        echo  [LOI] Khong the download cloudflared.exe.
        echo  Download thu cong tai: https://developers.cloudflare.com/cloudflared/install-and-setup/installation/
        echo  Dat file vao: scripts\windows\cloudflared.exe
        pause & exit /b 1
    )
)
echo.

:: ==============================================================
:: STEP 4 - Mo Firewall cho port 3001 va 3002
:: ==============================================================
echo  [STEP 4/9] Cau hinh Windows Firewall...
echo  ----------------------------------------

powershell -NoProfile -Command ^
    "if (-not (Get-NetFirewallRule -DisplayName 'KPI-API-3001' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'KPI-API-3001' -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow | Out-Null; Write-Host '  [OK] Mo Firewall port 3001 (API).' } else { Write-Host '  [OK] Firewall port 3001 da mo.' }" 2>nul
powershell -NoProfile -Command ^
    "if (-not (Get-NetFirewallRule -DisplayName 'KPI-Bot-3002' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'KPI-Bot-3002' -Direction Inbound -LocalPort 3002 -Protocol TCP -Action Allow | Out-Null; Write-Host '  [OK] Mo Firewall port 3002 (Bot).' } else { Write-Host '  [OK] Firewall port 3002 da mo.' }" 2>nul
echo.

:: ==============================================================
:: STEP 5 - Kiem tra PostgreSQL
:: ==============================================================
echo  [STEP 5/9] Kiem tra PostgreSQL...
echo  ----------------------------------------

where psql > nul 2>&1
if %errorlevel% neq 0 (
    :: Thu tim psql trong cac thu muc pho bien
    set "PG_PATHS=C:\Program Files\PostgreSQL\16\bin;C:\Program Files\PostgreSQL\15\bin;C:\Program Files\PostgreSQL\14\bin"
    for %%p in (!PG_PATHS!) do (
        if exist "%%p\psql.exe" (
            set "PATH=%%p;!PATH!"
            echo  [OK] Tim thay PostgreSQL tai: %%p
            goto :pg_found
        )
    )
    echo  [LOI] PostgreSQL chua duoc cai hoac khong co trong PATH!
    echo.
    echo  Cai PostgreSQL cho Windows tai:
    echo  https://www.postgresql.org/download/windows/
    echo.
    echo  Sau khi cai xong, chay lai file nay.
    pause & exit /b 1
    :pg_found
) else (
    for /f "tokens=3" %%v in ('psql --version 2^>nul') do set "PG_VER=%%v"
    echo  [OK] PostgreSQL !PG_VER! da duoc cai.
)

:: Kiem tra PostgreSQL service dang chay
powershell -NoProfile -Command ^
    "$svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($svc -and $svc.Status -ne 'Running') { Start-Service $svc.Name; Write-Host '  [OK] Da khoi dong PostgreSQL service.' } elseif ($svc) { Write-Host '  [OK] PostgreSQL service dang chay.' } else { Write-Host '  [CANH BAO] Khong tim thay PostgreSQL service - kiem tra thu cong.' }" 2>nul
echo.

:: ==============================================================
:: STEP 6 - Khoi tao Database telegram_kpi
:: ==============================================================
echo  [STEP 6/9] Khoi tao database telegram_kpi...
echo  ----------------------------------------

:: Doc thong tin DATABASE_URL tu .env
set "DB_USER=postgres"
set "DB_PASS="
set "DB_HOST=localhost"
set "DB_PORT=5432"
set "DB_NAME=telegram_kpi"

if exist "%PROJECT_ROOT%\.env" (
    for /f "tokens=1,* delims==" %%a in ('type "%PROJECT_ROOT%\.env" ^| findstr /i "DATABASE_URL"') do (
        set "DB_URL=%%b"
    )
    :: Parse URL: postgresql://USER:PASS@HOST:PORT/DBNAME
    powershell -NoProfile -Command ^
        "$url = $env:DB_URL_RAW; if ($url -match 'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)') { [System.Environment]::SetEnvironmentVariable('DB_USER_P', $Matches[1], 'Process'); [System.Environment]::SetEnvironmentVariable('DB_PASS_P', $Matches[2], 'Process'); [System.Environment]::SetEnvironmentVariable('DB_NAME_P', $Matches[5], 'Process') }" > nul 2>&1
)

:: Kiem tra DB ton tai chua (thu nhieu phuong thuc auth)
set "DB_EXISTS=0"

:: Phuong thuc 1: psql -U postgres (neu co trust auth hoac .pgpass)
powershell -NoProfile -Command ^
    "$env:PGPASSWORD='%DB_PASS%'; $result = & psql -U %DB_USER% -h %DB_HOST% -p %DB_PORT% -tAc 'SELECT 1 FROM pg_database WHERE datname=''telegram_kpi'';' 2>$null; if ($result -eq '1') { exit 0 } else { exit 1 }" > nul 2>&1
if %errorlevel% equ 0 set "DB_EXISTS=1"

if "!DB_EXISTS!"=="1" (
    echo  [OK] Database 'telegram_kpi' da ton tai - bo qua tao moi.
    echo  [INFO] De chay lai migration: psql -U postgres -d telegram_kpi -f scripts\db_init.sql
) else (
    echo  [INFO] Dang tao database 'telegram_kpi'...
    powershell -NoProfile -Command ^
        "$env:PGPASSWORD='%DB_PASS%'; & createdb -U %DB_USER% -h %DB_HOST% -p %DB_PORT% telegram_kpi 2>&1" > nul 2>&1
    if !errorlevel! equ 0 (
        echo  [OK] Database 'telegram_kpi' da duoc tao.
        echo  [INFO] Dang import schema tu scripts\db_init.sql...
        powershell -NoProfile -Command ^
            "$env:PGPASSWORD='%DB_PASS%'; & psql -U %DB_USER% -h %DB_HOST% -p %DB_PORT% -d telegram_kpi -f '%PROJECT_ROOT%\scripts\db_init.sql' -q 2>&1 | Out-Null; Write-Host '  [OK] Schema da duoc import.'"
    ) else (
        echo  [CANH BAO] Khong the tu dong tao database.
        echo  Chay thu cong:
        echo    psql -U postgres -c "CREATE DATABASE telegram_kpi;"
        echo    psql -U postgres -d telegram_kpi -f scripts\db_init.sql
    )
)
echo.

:: ==============================================================
:: STEP 7 - Cai npm packages (root)
:: ==============================================================
echo  [STEP 7/9] Cai root npm packages...
echo  ----------------------------------------
cd /d "%PROJECT_ROOT%"

call npm install --silent
if !errorlevel! equ 0 (
    echo  [OK] Root packages da duoc cai.
) else (
    echo  [LOI] npm install that bai.
    pause & exit /b 1
)
echo.

:: ==============================================================
:: STEP 8 - Build web-admin
:: ==============================================================
echo  [STEP 8/9] Build web-admin (React -> production)...
echo  ----------------------------------------

cd /d "%PROJECT_ROOT%\apps\web-admin"
call npm install --silent
echo  [INFO] Dang build...
call node node_modules\vite\bin\vite.js build
if !errorlevel! equ 0 (
    echo  [OK] Web-admin da duoc build vao apps\web-admin\dist\
) else (
    echo  [LOI] Build web-admin that bai. Kiem tra: apps\web-admin\
    pause & exit /b 1
)
cd /d "%PROJECT_ROOT%"
echo.

:: ==============================================================
:: STEP 9 - Cau hinh file .env
:: ==============================================================
echo  [STEP 9/9] Cau hinh file .env...
echo  ----------------------------------------

if exist "%PROJECT_ROOT%\.env" (
    echo  [OK] File .env da ton tai.
    :: Kiem tra bien bat buoc
    set "MISSING="
    powershell -NoProfile -Command ^
        "$env_content = Get-Content '%PROJECT_ROOT%\.env' -Raw; $vars = @('DATABASE_URL','TELEGRAM_BOT_TOKEN','GOOGLE_SPREADSHEET_ID'); foreach ($v in $vars) { $val = ($env_content | Select-String ('^' + $v + '=(.+)') | ForEach-Object { $_.Matches[0].Groups[1].Value }); if (-not $val -or $val -match 'YOUR_') { Write-Host ('    -> ' + $v + ' chua duoc dat!') } }" 2>nul
) else (
    echo  [CANH BAO] Chua co file .env. Dang tao tu .env.example...
    copy "%PROJECT_ROOT%\.env.example" "%PROJECT_ROOT%\.env" > nul
    echo.
    echo  *** QUAN TRONG: Mo file .env va dien thong tin thuc te ***
    echo  Vi tri: %PROJECT_ROOT%\.env
    echo.
    echo  Cac bien bat buoc phai dien:
    echo    DATABASE_URL      (thong tin PostgreSQL)
    echo    TELEGRAM_BOT_TOKEN (lay tu @BotFather)
    echo    GOOGLE_SPREADSHEET_ID
)
echo.

:: ==============================================================
:: HOAN THANH
:: ==============================================================
echo ==========================================================
echo    CAI DAT HOAN TAT!
echo ==========================================================
echo.
echo  Buoc tiep theo:
echo.

if not exist "%PROJECT_ROOT%\.env" (
    echo  1. Dien thong tin vao .env:
    echo     notepad %PROJECT_ROOT%\.env
    echo.
)

echo  2. Khoi dong he thong:
echo     PowerShell -ExecutionPolicy Bypass -File scripts\windows\start.ps1
echo.
echo  Lenh huu ich:
echo    - Xem tien trinh : pm2 monit
echo    - Xem log        : pm2 logs
echo    - Dung he thong  : pm2 stop all
echo.

:: Hoi co muon mo .env de dien thong tin khong
if exist "%PROJECT_ROOT%\.env" (
    powershell -NoProfile -Command ^
        "$content = Get-Content '%PROJECT_ROOT%\.env' -Raw; if ($content -match 'YOUR_') { $ans = Read-Host '  Mo file .env de dien thong tin ngay bay gio? (Y/N)'; if ($ans -eq 'Y' -or $ans -eq 'y') { notepad '%PROJECT_ROOT%\.env' } }"
)

:: ==============================================================
:: AUTO-START: Dang ky Task Scheduler khoi dong cung Windows
:: ==============================================================
echo  [STEP CUOI] Cau hinh tu dong khoi dong khi dang nhap Windows...
echo  ----------------------------------------

set "TASK_NAME=KPI-System-Autostart"
set "TASK_CMD=PowerShell -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%PROJECT_ROOT%\scripts\windows\start.ps1\""

:: Xoa task cu neu co
schtasks /Delete /TN "%TASK_NAME%" /F > nul 2>&1

:: Tao task moi (ON LOGON, chay ngam)
schtasks /Create ^
    /TN "%TASK_NAME%" ^
    /TR "%TASK_CMD%" ^
    /SC ONLOGON ^
    /RU "%USERNAME%" ^
    /RL HIGHEST ^
    /F > nul 2>&1

if %errorlevel% equ 0 (
    echo  [OK] Task Scheduler da duoc dang ky.
    echo  [OK] He thong se tu dong khoi dong khi ban dang nhap Windows.
    echo  [INFO] Ten task: %TASK_NAME%
    echo  [INFO] Quan ly tai: Task Scheduler ^> Task Scheduler Library
) else (
    echo  [CANH BAO] Khong the dang ky Task Scheduler.
    echo  [INFO] De tu dong khoi dong, chay thu cong:
    echo    schtasks /Create /TN "KPI-System-Autostart" /TR "%TASK_CMD%" /SC ONLOGON /RU %USERNAME% /RL HIGHEST /F
)
echo.

:: Hoi co muon khoi dong ngay bay gio khong
echo  ========================================================
set /p "START_NOW=  Khoi dong he thong ngay bay gio? (Y/N): "
if /i "%START_NOW%"=="Y" (
    echo.
    echo  [INFO] Dang khoi dong...
    PowerShell -ExecutionPolicy Bypass -File "%PROJECT_ROOT%\scripts\windows\start.ps1"
) else (
    echo.
    echo  De khoi dong sau, chay:
    echo    .\scripts\windows\start.ps1
)

echo.
echo  An phim bat ky de dong cua so...
pause > nul
endlocal
