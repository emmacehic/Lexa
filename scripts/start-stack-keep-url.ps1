# Start Lexa without changing the public URL
#
# Quick Cloudflare tunnels (trycloudflare.com) get a NEW random URL every
# time cloudflared restarts. If you already sent people a link, run this
# script instead of restarting cloudflared: it only starts what is missing.
# The public link must match AUTH_URL in .env.local.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
Set-Location $Root

function Test-PortListening([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host "=== Lexa stack (preserving tunnel URL) ===" -ForegroundColor Cyan

# Docker (Postgres, Redis, Whisper)
if (-not (docker ps --filter "name=lexa-postgres" --format "{{.Names}}" 2>$null)) {
  Write-Host "Starting Docker containers..."
  docker start lexa-postgres lexa-redis lexa-whisper 2>$null
}

# App
if (-not (Test-PortListening $Port)) {
  Write-Host "Starting app on port $Port..."
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Root'; `$env:PORT=$Port; pnpm start"
  ) -WindowStyle Minimized
  Start-Sleep -Seconds 3
} else {
  Write-Host "App already listening on $Port."
}

# Worker — exactly one per machine
$rootPattern = [regex]::Escape($Root)
$worker = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "$rootPattern.*worker[/\\]index\.ts" }
if (-not $worker) {
  Write-Host "Starting transcription worker..."
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Root'; pnpm exec tsx --env-file=.env.local worker/index.ts"
  ) -WindowStyle Minimized
} else {
  Write-Host "Worker already running (PID $($worker[0].ProcessId))."
}

# Cloudflared — do NOT restart if already running (keeps the same public URL)
$tunnel = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($tunnel) {
  Write-Host "Cloudflare tunnel already running (PID $($tunnel[0].Id)) — URL unchanged." -ForegroundColor Green
} else {
  Write-Host "WARNING: cloudflared is not running. Starting it will assign a NEW URL." -ForegroundColor Yellow
  Write-Host "Copy the new URL into AUTH_URL in .env.local, then restart the app."
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  $cfPath = if ($cf) { $cf.Source } else { Join-Path $Root "tmp\cloudflared.exe" }
  if (-not (Test-Path $cfPath)) {
    Write-Host "Install cloudflared (winget install Cloudflare.cloudflared) or place it at tmp\cloudflared.exe."
    exit 1
  }
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "& '$cfPath' tunnel --url http://localhost:$Port"
  )
}

Write-Host ""
Write-Host "Done. Login: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from .env.local"
