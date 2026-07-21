@echo off
SET NODE_DIR=C:\nodejs\node-v22.16.0-win-x64
SET NPM_GLOBAL=%APPDATA%\npm
SET PATH=%NODE_DIR%;%NPM_GLOBAL%;%PATH%
SET NODE_OPTIONS=--dns-result-order=ipv4first
SET PROJECT=C:\Users\ADMIN\Downloads\telegramReport\telegramReport

cd /d %PROJECT%

echo === Tat cloudflared cu ===
taskkill /F /IM cloudflared.exe 2>nul

echo === Khoi dong API va Bot ===
call pm2 kill 2>nul
timeout /t 2 /nobreak >nul
call pm2 start ecosystem.config.cjs

echo === Doi 3 giay ===
timeout /t 3 /nobreak >nul

echo === Khoi dong Cloudflare Tunnel ===
if exist cf_err.log del cf_err.log
if exist cloudflare.log del cloudflare.log
type nul > cf_err.log
type nul > cloudflare.log
start /B cloudflared.exe tunnel --url http://localhost:3001 2>cf_err.log 1>cloudflare.log

echo === Doi tunnel (15 giay) ===
timeout /t 15 /nobreak >nul

node update_url.cjs
pm2 list
