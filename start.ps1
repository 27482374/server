$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 18+ is required." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..." -ForegroundColor Cyan
  npm install
}

if (-not $env:ADMIN_TOKEN) {
  $env:ADMIN_TOKEN = "demo-local-only"
}

Write-Host ""
Write-Host "Server Center" -ForegroundColor White
Write-Host "Open http://127.0.0.1:3000" -ForegroundColor Green
Write-Host "Admin token: $env:ADMIN_TOKEN" -ForegroundColor Yellow
Write-Host ""

npm start
