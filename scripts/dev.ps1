param(
    [ValidateSet('test', 'build', 'run', 'fmt', 'clippy')]
    [string]$Action = 'test',
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:CARGO_HOME = Join-Path $projectRoot '.tools\cargo'
$env:RUSTUP_HOME = Join-Path $projectRoot '.tools\rustup'
$env:TEMP = Join-Path $projectRoot '.tools\tmp'
$env:TMP = $env:TEMP
$env:CARGO_TARGET_DIR = Join-Path $projectRoot 'target'
New-Item -ItemType Directory -Force -Path $env:TEMP, $env:CARGO_HOME, $env:CARGO_TARGET_DIR | Out-Null
$localRust = Join-Path $projectRoot '.tools\rust\bin'
if (Test-Path -LiteralPath (Join-Path $localRust 'cargo.exe')) {
    $env:PATH = $localRust + ';' + $env:PATH
    $env:RUSTC = Join-Path $localRust 'rustc.exe'
    $env:RUSTDOC = Join-Path $localRust 'rustdoc.exe'
    $cargo = Join-Path $localRust 'cargo.exe'
} elseif (Get-Command cargo -ErrorAction SilentlyContinue) {
    $cargo = (Get-Command cargo).Source
} else {
    throw 'Rust toolchain not found. Install Rust or use the project-local .tools/rust toolchain.'
}
if ($Action -in @('run', 'fmt', 'clippy')) {
    # PowerShell consumes the standalone -- when calling a .ps1 script.
    # These convenience actions forward all remaining args to the program/tool.
    if ($Action -eq 'clippy') {
        & $cargo clippy --offline --all-targets -- -D warnings @ExtraArgs
    } else {
        & $cargo $Action -- @ExtraArgs
    }
} else {
    & $cargo $Action @ExtraArgs
}
exit $LASTEXITCODE
