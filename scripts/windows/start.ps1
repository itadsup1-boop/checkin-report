# ==============================================================
#  scripts\windows\start.ps1
#  Khoi dong He Thong KPI Telegram Report tren Windows 10/11
#  Thay the: khoi_dong_he_thong_kpi.ps1 va start.bat
#
#  Cach dung:
#    .\scripts\windows\start.ps1             <- Khoi dong day du
#    .\scripts\windows\start.ps1 -Restart    <- Chi restart PM2
#    .\scripts\windows\start.ps1 -Stop       <- Dung toan bo
#    .\scripts\windows\start.ps1 -Help       <- Hien tro giup
# ==============================================================

param(
    [switch]$Restart,
    [switch]$Stop,
    [switch]$Help
)

# ---- Mau sac terminal (Windows Terminal / PowerShell 5+) ----
function Write-Step  { param($n,$msg) Write-Host "`n[STEP $n] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "  [OK] $msg"    -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  [!]  $msg"    -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "  [X]  $msg"    -ForegroundColor Red }
function Write-Info  { param($msg) Write-Host "  [>]  $msg"    -ForegroundColor Gray }

# ---- Lay thu muc goc du an (2 cap tren scripts\windows\) ----
$SCRIPT_DIR   = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_ROOT = (Resolve-Path (Join-Path $SCRIPT_DIR '..\..')).Path
Set-Location $PROJECT_ROOT

# ---- Duong dan cac cong cu ----
$CF_EXE         = Join-Path $SCRIPT_DIR 'cloudflared.exe'
$ECOSYSTEM_FILE = Join-Path $PROJECT_ROOT 'ecosystem.config.cjs'
$ENV_FILE       = Join-Path $PROJECT_ROOT '.env'
$CF_LOG         = Join-Path $PROJECT_ROOT 'cloudflare.log'
$CF_ERR_LOG     = Join-Path $PROJECT_ROOT 'cf_err.log'
$WEB_DIST       = Join-Path $PROJECT_ROOT 'apps\web-admin\dist\index.html'

# ---- Dam bao Node.js trong PATH ----
$nodeLocations = @(
    "$env:ProgramFiles\nodejs",
    "$env:ProgramFiles (x86)\nodejs",
    "$env:APPDATA\nvm\current",
    "C:\nodejs\node-v22.16.0-win-x64"
)
foreach ($loc in $nodeLocations) {
    if ((Test-Path "$loc\node.exe") -and ($env:PATH -notlike "*$loc*")) {
        $env:PATH = "$loc;$env:APPDATA\npm;$env:PATH"
        break
    }
}

# ---- Fix loi IPv6 Telegram ----
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection'

# ==============================================================
Write-Host ''
Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host '   KHOI DONG HE THONG KPI TELEGRAM REPORT - WINDOWS' -ForegroundColor Cyan
switch ($true) {
    $Help    { Write-Host "   Che do: Help" -ForegroundColor Gray }
    $Stop    { Write-Host "   Che do: Dung he thong  -  $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Gray }
    $Restart { Write-Host "   Che do: Restart         -  $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Gray }
    default  { Write-Host "   Che do: Khoi dong moi   -  $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Gray }
}
Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host ''

# ==============================================================
# HELP
# ==============================================================
if ($Help) {
    Write-Host 'Cach dung:'
    Write-Host '  .\scripts\windows\start.ps1             Khoi dong toan bo he thong'
    Write-Host '  .\scripts\windows\start.ps1 -Restart    Chi restart PM2 (giu tunnel cu)'
    Write-Host '  .\scripts\windows\start.ps1 -Stop       Dung PM2 + cloudflared'
    Write-Host ''
    exit 0
}

# ==============================================================
# MODE: STOP
# ==============================================================
if ($Stop) {
    Write-Step '1/2' 'Dung PM2...'
    try {
        $null = & pm2 stop all 2>&1
        Write-Ok 'Tat ca tien trinh PM2 da dung.'
    } catch {
        Write-Warn 'PM2 khong co tien trinh nao dang chay.'
    }

    Write-Step '2/2' 'Dung cloudflared...'
    $cf = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue
    if ($cf) {
        Stop-Process -Name 'cloudflared' -Force
        Write-Ok 'cloudflared da dung.'
    } else {
        Write-Warn 'cloudflared khong dang chay.'
    }

    Write-Host ''
    Write-Ok 'He thong da dung.'
    Write-Host '  De khoi dong lai: .\scripts\windows\start.ps1' -ForegroundColor Cyan
    Write-Host ''
    exit 0
}

# ==============================================================
# MODE: RESTART
# ==============================================================
if ($Restart) {
    Write-Step '1/1' 'Restart PM2 voi env moi tu .env...'

    if (-not (Test-Path $ENV_FILE)) {
        Write-Err 'Khong tim thay file .env. Hay chay install.bat truoc.'
        exit 1
    }

    try {
        $output = & pm2 restart all --update-env 2>&1
        $output | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
        Write-Ok 'Tat ca tien trinh PM2 da duoc restart.'
    } catch {
        Write-Warn "PM2 restart co loi: $($_.Exception.Message)"
    }

    Write-Host ''
    Write-Ok 'Restart hoan tat.'
    Write-Host '  Xem trang thai: pm2 status' -ForegroundColor Cyan
    Write-Host ''
    exit 0
}

# ==============================================================
# MODE: START (mac dinh)
# ==============================================================

# ---- STEP 1: Kiem tra tien quyet ----
Write-Step '1/6' 'Kiem tra tien quyet...'

$prereqOk = $true

# Kiem tra .env
if (-not (Test-Path $ENV_FILE)) {
    Write-Err 'Khong tim thay file .env!'
    Write-Host '  Tao file .env tu mau:  copy .env.example .env' -ForegroundColor Yellow
    Write-Host '  Sau do dien thong tin:  notepad .env' -ForegroundColor Yellow
    exit 1
}

# Ham kiem tra bien env
function Get-EnvVar($name) {
    $line = Get-Content $ENV_FILE | Where-Object { $_ -match "^$name=(.+)" } | Select-Object -First 1
    if ($line) { return ($line -split '=', 2)[1].Trim('"') } else { return '' }
}

# Kiem tra bien bat buoc
foreach ($varName in @('DATABASE_URL', 'TELEGRAM_BOT_TOKEN')) {
    $val = Get-EnvVar $varName
    if (-not $val -or $val -match 'YOUR_') {
        Write-Err "Bien $varName chua duoc dat trong .env"
        $prereqOk = $false
    }
}

if (-not $prereqOk) {
    Write-Host "`n  Hay dien day du .env roi chay lai.`n" -ForegroundColor Yellow
    exit 1
}

# Kiem tra PM2
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Err 'PM2 chua duoc cai. Hay chay: scripts\windows\install.bat'
    exit 1
}

# Kiem tra cloudflared.exe
if (-not (Test-Path $CF_EXE)) {
    # Fallback: cloudflared.exe o thu muc goc (cu)
    $CF_EXE_ROOT = Join-Path $PROJECT_ROOT 'cloudflared.exe'
    if (Test-Path $CF_EXE_ROOT) {
        $CF_EXE = $CF_EXE_ROOT
        Write-Info "Su dung cloudflared.exe tu thu muc goc."
    } else {
        Write-Err "Khong tim thay cloudflared.exe!"
        Write-Host "  Chay install.bat de download, hoac dat file vao: scripts\windows\" -ForegroundColor Yellow
        exit 1
    }
}

# Kiem tra web-admin da build chua
if (-not (Test-Path $WEB_DIST)) {
    Write-Warn 'Web-admin chua duoc build. Dang build...'
    Push-Location (Join-Path $PROJECT_ROOT 'apps\web-admin')
    & npm install --silent 2>&1 | Out-Null
    & node node_modules\vite\bin\vite.js build 2>&1 | Out-Null
    Pop-Location
    if (Test-Path $WEB_DIST) {
        Write-Ok 'Web-admin da duoc build.'
    } else {
        Write-Warn 'Build web-admin co loi - kiem tra apps\web-admin\'
    }
} else {
    Write-Ok 'Web-admin OK (dist\ da co).'
}

Write-Ok 'Tat ca kiem tra tien quyet da pass.'

# ---- STEP 2: Don dep tien trinh cu ----
Write-Step '2/6' 'Don dep tien trinh cu...'

# Xoa PM2 processes cu
foreach ($name in @('kpi-api', 'kpi-bot', 'timekeep-bot')) {
    $null = & pm2 delete $name 2>&1
}

# Kill cloudflared neu dang chay
$cf = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($cf) {
    Stop-Process -Name 'cloudflared' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

# Xoa log cu de doc URL moi chinh xac
Remove-Item $CF_LOG     -Force -ErrorAction SilentlyContinue
Remove-Item $CF_ERR_LOG -Force -ErrorAction SilentlyContinue
New-Item $CF_LOG     -ItemType File -Force | Out-Null
New-Item $CF_ERR_LOG -ItemType File -Force | Out-Null

Write-Ok 'Don dep hoan tat.'

# ---- STEP 3: Khoi dong PM2 via ecosystem.config.cjs ----
Write-Step '3/6' 'Khoi dong API va Bot qua PM2...'

if (-not (Test-Path $ECOSYSTEM_FILE)) {
    Write-Err "Khong tim thay ecosystem.config.cjs tai: $ECOSYSTEM_FILE"
    exit 1
}

$pm2Output = & pm2 start $ECOSYSTEM_FILE 2>&1
$pm2Output | ForEach-Object {
    if ($_ -match 'online|error|✓') { Write-Host "    $_" -ForegroundColor Gray }
}

Start-Sleep -Seconds 3

# Kiem tra trang thai PM2
$pm2Status = & pm2 jlist 2>&1 | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($pm2Status) {
    foreach ($proc in $pm2Status) {
        $name   = $proc.name
        $status = $proc.pm2_env.status
        $port   = if ($name -eq 'kpi-api') { '3001' } else { '3002' }
        if ($status -eq 'online') {
            Write-Ok "$name dang chay (port $port)."
        } else {
            Write-Warn "$name trang thai: $status - kiem tra: pm2 logs $name"
        }
    }
} else {
    Write-Info 'Khong doc duoc PM2 status JSON - kiem tra: pm2 list'
}

# ---- STEP 4: Khoi dong Cloudflare Tunnel ----
Write-Step '4/6' 'Khoi dong Cloudflare Tunnel (tro vao port 3002)...'

$cfArgs = @('tunnel', '--url', 'http://localhost:3002')
$cfProc = Start-Process `
    -FilePath $CF_EXE `
    -ArgumentList $cfArgs `
    -RedirectStandardOutput $CF_LOG `
    -RedirectStandardError  $CF_ERR_LOG `
    -WindowStyle Hidden `
    -PassThru

Write-Info "cloudflared dang khoi dong (PID: $($cfProc.Id))..."
Write-Host '  Dang cho duong ham ket noi (toi da 20 giay)...' -ForegroundColor Gray

# ---- STEP 5: Doc URL Cloudflare va cap nhat .env ----
Write-Step '5/6' 'Lay Cloudflare URL va cap nhat .env...'

$cloudflareUrl = ''
$maxWait = 20
$waited  = 0

while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 1
    $waited++

    # Doc ca 2 file log (cloudflared ghi vao stderr)
    $logContent  = (Get-Content $CF_ERR_LOG -Raw -ErrorAction SilentlyContinue) + `
                   (Get-Content $CF_LOG     -Raw -ErrorAction SilentlyContinue)

    if ($logContent -match '(https://[a-z0-9\-]+\.trycloudflare\.com)') {
        $cloudflareUrl = $Matches[1]
        break
    }

    if ($waited % 5 -eq 0) {
        Write-Info "Dang cho... ($waited/$maxWait giay)"
    }
}

if ($cloudflareUrl) {
    Write-Ok "Cloudflare URL: $cloudflareUrl"

    # Cap nhat MINI_APP_URL trong .env
    $envContent = Get-Content $ENV_FILE -Raw
    if ($envContent -match 'MINI_APP_URL=') {
        $envContent = $envContent -replace 'MINI_APP_URL=.*', "MINI_APP_URL=$cloudflareUrl"
    } else {
        $envContent = $envContent.TrimEnd() + "`nMINI_APP_URL=$cloudflareUrl`n"
    }
    # Ghi lai file (khong them BOM, giu line ending goc)
    [System.IO.File]::WriteAllText($ENV_FILE, $envContent, [System.Text.UTF8Encoding]::new($false))
    Write-Ok 'MINI_APP_URL da duoc cap nhat trong .env.'

    # Restart PM2 de bot nhan URL moi
    $null = & pm2 restart all --update-env 2>&1
    Write-Ok 'PM2 da duoc restart voi env moi.'
} else {
    Write-Warn "Khong lay duoc Cloudflare URL sau $maxWait giay."
    Write-Info "Kiem tra log: Get-Content cf_err.log -Tail 20"
    Write-Info "Neu tunnel hoat dong sau, chay: .\scripts\windows\start.ps1 -Restart"
    $cloudflareUrl = '(chua lay duoc - xem cf_err.log)'
}

# ---- STEP 6: Luu trang thai PM2 ----
Write-Step '6/6' 'Luu trang thai PM2...'

$null = & pm2 save 2>&1
Write-Ok 'Trang thai PM2 da duoc luu.'

# ==============================================================
# KET QUA CUOI
# ==============================================================
$apiPort = Get-EnvVar 'API_PORT'
if (-not $apiPort) { $apiPort = '3001' }

Write-Host ''
Write-Host '==========================================================' -ForegroundColor Green
Write-Host '   HE THONG KPI DA KHOI CHAY THANH CONG!'               -ForegroundColor Green
Write-Host '==========================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  TELEGRAM MINI APP URL (dan vao BotFather -> /editapp):' -ForegroundColor White
Write-Host "  $cloudflareUrl" -ForegroundColor Cyan
Write-Host ''
Write-Host '  WEB ADMIN:' -ForegroundColor White
Write-Host "  http://localhost:$apiPort" -ForegroundColor Cyan
Write-Host ''
Write-Host '  PM2 Process List:' -ForegroundColor White
& pm2 list 2>&1 | Select-String 'name|kpi-api|timekeep-bot' | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host '  Lenh huu ich:' -ForegroundColor White
Write-Host '  - Xem tien trinh :  pm2 monit'
Write-Host '  - Xem log API    :  pm2 logs kpi-api'
Write-Host '  - Xem log Bot    :  pm2 logs timekeep-bot'
Write-Host "  - Dung he thong  :  .\scripts\windows\start.ps1 -Stop"
Write-Host "  - Chi restart    :  .\scripts\windows\start.ps1 -Restart"
Write-Host "  - Cap nhat code  :  .\scripts\windows\update.ps1"
Write-Host ''
