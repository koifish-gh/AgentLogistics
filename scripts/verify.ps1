$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
# Run dev.ps1 in a child PowerShell: its exit must not terminate this verifier.
$shellExecutable = (Get-Process -Id $PID).Path
& $shellExecutable -NoProfile -File (Join-Path $PSScriptRoot 'dev.ps1') test --offline
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $shellExecutable -NoProfile -File (Join-Path $PSScriptRoot 'dev.ps1') clippy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$pythonExecutable = Join-Path $runtimeRoot 'python\python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) { $pythonExecutable = (Get-Command python -ErrorAction Stop).Source }
$nodeExecutable = Join-Path $runtimeRoot 'node\bin\node.exe'
if (-not (Test-Path -LiteralPath $nodeExecutable)) { $nodeExecutable = (Get-Command node -ErrorAction Stop).Source }
& $pythonExecutable (Join-Path $projectRoot 'tests\cli_smoke.py')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExecutable (Join-Path $projectRoot 'tests\http_smoke.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'All Rust, CLI, and HTTP/SSE checks passed.'
