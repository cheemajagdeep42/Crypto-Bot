param(
    [ValidateSet("sqlite", "json")]
    [string]$Store = "sqlite",
    [int]$Port = 3001
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bffPath = Join-Path $root "bff"

if (!(Test-Path $bffPath)) {
    Write-Error "Missing bff directory at $bffPath"
    exit 1
}

$env:BOT_STORE = $Store
$env:PORT = "$Port"

Write-Host "Starting BFF with BOT_STORE=$Store" -ForegroundColor Cyan
Write-Host "Using PORT=$Port" -ForegroundColor Cyan
Write-Host "SQLite mode auto-creates/migrates DB on startup." -ForegroundColor DarkGray

Push-Location $bffPath
try {
    npm run dev
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
