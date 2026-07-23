# ==============================================================
# [DEPRECATED] khoi_dong_he_thong_kpi.ps1 - KHONG SU DUNG FILE NAY NUA
# Da duoc thay the boi: scripts\windows\start.ps1
#
# Cac loi da biet:
#   BUG 1: Hardcode Node path "C:\nodejs\node-v22.16.0-win-x64"
#   BUG 2: Khoi dong "apps/bot/index.js" - sai file (phai la timekeep_bot.js)
#   BUG 3: Cloudflared tro vao port 3001 (API) - phai la 3002 (Bot)
#
# Giu lai chi de tham khao lich su.
# ==============================================================
Write-Host ""
Write-Host "[DEPRECATED] File nay da loi thoi. Hay su dung:" -ForegroundColor Yellow
Write-Host "  .\scripts\windows\start.ps1" -ForegroundColor Cyan
Write-Host ""
Read-Host "An Enter de thoat"
exit 1

# ---- NOI DUNG CU (giu lai de tham khao) ----
$ErrorActionPreference = "SilentlyContinue"

# Them Node.js portable vao PATH
$NODE_DIR = "C:\nodejs\node-v22.16.0-win-x64"
$NPM_GLOBAL = "$env:APPDATA\npm"
$env:PATH = "$NODE_DIR;$NPM_GLOBAL;$env:PATH"

# Sua loi IPv6 cua Telegram
$env:NODE_OPTIONS = "--dns-result-order=ipv4first"

Write-Host "=========================================================="
Write-Host "  KHOI DONG HE THONG KPI TELEGRAM REPORT TREN WINDOWS"
Write-Host "=========================================================="

Write-Host "[1/4] Don dep cac tien trinh cu..."
pm2 delete kpi-api 2>$null
pm2 delete timekeep-bot 2>$null
pm2 delete kpi-bot 2>$null
Stop-Process -Name "cloudflared" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "[2/4] Khoi dong API Server va Telegram Bot..."
pm2 start apps/api/index.js --name "kpi-api"
pm2 start apps/bot/timekeep_bot.js --name "timekeep-bot"

Write-Host "[3/4] Khoi dong duong ham Cloudflare..."
# Xoa log cu, tao lai file moi
Remove-Item "cloudflare.log" -Force -ErrorAction SilentlyContinue
Remove-Item "cf_err.log" -Force -ErrorAction SilentlyContinue
New-Item "cloudflare.log" -ItemType File -Force | Out-Null
New-Item "cf_err.log" -ItemType File -Force | Out-Null

# Chay cloudflared - stdout va stderr PHAI khac nhau
Start-Process -FilePath ".\cloudflared.exe" `
    -ArgumentList "tunnel --url http://localhost:3001" `
    -RedirectStandardOutput "cloudflare.log" `
    -RedirectStandardError "cf_err.log" `
    -WindowStyle Hidden

Write-Host "[4/4] Doi tunnel khoi dong (12 giay)..."
Start-Sleep -Seconds 12

# Doc link tu file cf_err.log (cloudflared ghi thong bao vao stderr)
$logContent = (Get-Content "cf_err.log" -Raw -ErrorAction SilentlyContinue) + `
              (Get-Content "cloudflare.log" -Raw -ErrorAction SilentlyContinue)

if ($logContent -match "(https://[a-z0-9\-]+\.trycloudflare\.com)") {
    $cloudflareUrl = $matches[1]

    # Cap nhat file .env
    $envPath = ".env"
    $envContent = Get-Content $envPath -Raw
    $envContent = $envContent -replace "MINI_APP_URL=.*", "MINI_APP_URL=$cloudflareUrl"
    Set-Content -Path $envPath -Value $envContent -NoNewline

    # Restart PM2 voi env moi
    pm2 restart all --update-env

    Write-Host ""
    Write-Host "=========================================================="
    Write-Host "  HE THONG KPI DA HOAT DONG THANH CONG!"
    Write-Host "=========================================================="
    Write-Host "  LINK CLOUDFLARE MOI - DAN VAO BOTFATHER (/editapp):"
    Write-Host ""
    Write-Host "  $cloudflareUrl/mini-app/form.html"
    Write-Host ""
    Write-Host "  Ghi chu:"
    Write-Host "  - Xem logs : pm2 logs"
    Write-Host "  - Monitor  : pm2 monit"
    Write-Host "  - Tat het  : pm2 stop all"
    Write-Host "=========================================================="
} else {
    Write-Host ""
    Write-Host "[LOI] Khong the lay duoc link Cloudflare!"
    Write-Host "Noi dung cf_err.log:"
    Get-Content "cf_err.log" -ErrorAction SilentlyContinue | Select-Object -Last 20
}

Write-Host ""
Write-Host "An phim bat ky de thoat..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
