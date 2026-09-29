$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$exe = Join-Path $projectRoot 'target\debug\logistics.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    Write-Host 'Building Rust simulation core...'
    & (Join-Path $PSScriptRoot 'dev.ps1') build --offline
}
Write-Host 'Open http://127.0.0.1:8787/ after the server starts.'
node (Join-Path $PSScriptRoot 'server.mjs')
