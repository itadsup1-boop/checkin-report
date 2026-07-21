# ==============================================================
#  scripts\windows\update.ps1
#  Cap nhat code moi va restart He Thong KPI tren Windows
#
#  Cach dung:
#    .\scripts\windows\update.ps1              <- Cap nhat day du
#    .\scripts\windows\update.ps1 -NoPull      <- Bo qua git pull
#    .\scripts\windows\update.ps1 -NoBuild     <- Bo qua build web-admin
# ==============================================================

param(
    [switch]$NoPull,
    [switch]$NoBuild,
    [switch]$Help
)

function Write-Step { param($n,$msg) Write-Host "`n[STEP $n] $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "  [X]  $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "  [>]  $msg" -ForegroundColor Gray }

# ---- Lay thu muc goc du an ----
$SCRIPT_DIR   = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_ROOT = (Resolve-Path (Join-Path $SCRIPT_DIR '..\..')).Path
Set-Location $PROJECT_ROOT

if ($Help) {
    Write-Host 'Cach dung: .\scripts\windows\update.ps1 [options]'
    Write-Host '  (khong tham so)   Pull code + build web-admin + restart PM2'
    Write-Host '  -NoPull           Bo qua git pull (dung khi sua code truc tiep)'
    Write-Host '  -NoBuild          Bo qua build web-admin (nhanh hon, chi sua backend)'
    exit 0
}

# ---- Ghi lai thoi diem bat dau ----
$startTime = Get-Date

Write-Host ''
Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host '   CAP NHAT HE THONG KPI TELEGRAM REPORT - WINDOWS'       -ForegroundColor Cyan
Write-Host "   $(Get-Date -Format 'yyyy-MM-dd HH:mm')"                -ForegroundColor Gray
Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host ''

# ==============================================================
# STEP 1 - Git pull
# ==============================================================
Write-Step '1/4' 'Cap nhat code tu git...'

if ($NoPull) {
    Write-Info 'Bo qua git pull (-NoPull).'
} elseif (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Warn 'git chua duoc cai. Bo qua buoc pull.'
    Write-Info 'Cai git tai: https://git-scm.com/download/win'
} elseif (-not (Test-Path (Join-Path $PROJECT_ROOT '.git'))) {
    Write-Warn 'Thu muc khong phai git repo. Bo qua buoc pull.'
    Write-Info 'Khoi tao git: git init && git remote add origin <URL>'
} else {
    # Luu commit hien tai
    $beforeCommit = & git rev-parse --short HEAD 2>$null

    # Kiem tra co thay doi local chua commit khong
    $hasChanges = & git status --porcelain 2>$null
    if ($hasChanges) {
        Write-Warn 'Co thay doi local chua commit:'
        $hasChanges | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
        $ans = Read-Host "`n  Tiep tuc git pull (co the gay conflict)? (Y/N)"
        if ($ans -ne 'Y' -and $ans -ne 'y') {
            Write-Info 'Huy. Hay commit hoac stash truoc: git stash'
            exit 0
        }
    }

    $branch = & git branch --show-current 2>$null
    if (-not $branch) { $branch = 'main' }
    Write-Info "Dang pull tu origin/$branch..."

    $pullResult = & git pull origin $branch 2>&1
    if ($LASTEXITCODE -eq 0) {
        $afterCommit = & git rev-parse --short HEAD 2>$null
        if ($beforeCommit -eq $afterCommit) {
            Write-Ok "Code da la moi nhat ($afterCommit) - khong co thay doi."
        } else {
            Write-Ok "Da cap nhat: $beforeCommit -> $afterCommit"
            # Hien thi commit moi
            Write-Host "`n  Commits moi:" -ForegroundColor White
            & git log "$beforeCommit..HEAD" --oneline 2>$null |
                Select-Object -First 10 |
                ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
        }
    } else {
        Write-Err 'git pull that bai. Kiem tra ket noi hoac conflict.'
        $pullResult | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        exit 1
    }
}

# ==============================================================
# STEP 2 - Cai npm packages (root)
# ==============================================================
Write-Step '2/4' 'Kiem tra va cai root npm packages...'

$lockFile    = Join-Path $PROJECT_ROOT 'package-lock.json'
$nodeModules = Join-Path $PROJECT_ROOT 'node_modules\.package-lock.json'

if ((Test-Path $lockFile) -and (Test-Path $nodeModules)) {
    $lockNewer = (Get-Item $lockFile).LastWriteTime -gt (Get-Item $nodeModules).LastWriteTime
    if ($lockNewer) {
        Write-Info 'Phat hien package-lock.json thay doi. Dang cai packages...'
        & npm ci --silent 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { & npm install --silent 2>&1 | Out-Null }
        Write-Ok 'Root packages da duoc cap nhat.'
    } else {
        Write-Ok 'Root packages khong thay doi - bo qua.'
    }
} else {
    & npm install --silent 2>&1 | Out-Null
    Write-Ok 'Root packages OK.'
}

# ==============================================================
# STEP 3 - Build web-admin
# ==============================================================
Write-Step '3/4' 'Build web-admin (React -> production)...'

if ($NoBuild) {
    Write-Info 'Bo qua build web-admin (-NoBuild).'
} else {
    $webAdminDir = Join-Path $PROJECT_ROOT 'apps\web-admin'
    Push-Location $webAdminDir

    # Cai web-admin packages neu can
    $webLock    = Join-Path $webAdminDir 'package-lock.json'
    $webModules = Join-Path $webAdminDir 'node_modules\.package-lock.json'
    if ((Test-Path $webLock) -and (Test-Path $webModules)) {
        if ((Get-Item $webLock).LastWriteTime -gt (Get-Item $webModules).LastWriteTime) {
            Write-Info 'Dang cai web-admin packages...'
            & npm ci --silent 2>&1 | Out-Null
        }
    } elseif (-not (Test-Path $webModules)) {
        & npm install --silent 2>&1 | Out-Null
    }

    Write-Info 'Dang build...'
    $buildOutput = & node node_modules\vite\bin\vite.js build 2>&1
    if ($LASTEXITCODE -eq 0) {
        $distSize = if (Test-Path 'dist') {
            "{0:N0} KB" -f ((Get-ChildItem 'dist' -Recurse | Measure-Object -Property Length -Sum).Sum / 1KB)
        } else { '?' }
        Write-Ok "Build thanh cong - dist\ ($distSize)"
        $buildOutput | Select-String '✓|kB|gzip' | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    } else {
        Write-Err 'Build that bai! Chi tiet:'
        $buildOutput | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Pop-Location
        exit 1
    }
    Pop-Location
}

# ==============================================================
# STEP 4 - Restart PM2
# ==============================================================
Write-Step '4/4' 'Restart PM2 voi env moi...'

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Err 'PM2 chua duoc cai. Chay: scripts\windows\install.bat'
    exit 1
}

# Dem so tien trinh dang online
$pm2Json = & pm2 jlist 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
$runningCount = if ($pm2Json) {
    ($pm2Json | Where-Object { $_.pm2_env.status -eq 'online' }).Count
} else { 0 }

if ($runningCount -gt 0) {
    Write-Info "$runningCount tien trinh dang chay - dang restart..."
    $restartOut = & pm2 restart all --update-env 2>&1
    $restartOut | Select-String '✓|online|error' | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    Write-Ok 'PM2 da duoc restart.'
} else {
    Write-Warn 'Khong co tien trinh PM2 nao dang chay.'
    Write-Info 'Khoi dong he thong: .\scripts\windows\start.ps1'
}

$null = & pm2 save 2>&1

# ==============================================================
# HOAN THANH
# ==============================================================
$elapsed = [int]((Get-Date) - $startTime).TotalSeconds

Write-Host ''
Write-Host '==========================================================' -ForegroundColor Green
Write-Host "   CAP NHAT HOAN TAT! (${elapsed}s)"                      -ForegroundColor Green
Write-Host '==========================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Trang thai PM2 hien tai:' -ForegroundColor White
& pm2 list 2>&1 | Select-String 'name|kpi-api|timekeep-bot' | Select-Object -First 5 |
    ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host '  Lenh huu ich:' -ForegroundColor White
Write-Host '  - Xem log real-time: pm2 logs'
Write-Host '  - Monitor:           pm2 monit'
Write-Host ''
