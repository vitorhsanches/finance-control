# FinaSync — Fix package-lock.json
# ────────────────────────────────────────────────────────────
# Run this ONCE directly on your Windows machine:
#   cd C:\Users\...\finasync
#   powershell -ExecutionPolicy Bypass -File .\fix-lockfile.ps1
#
# What this does:
#   Regenerates package-lock.json so that `npm ci` works on npm 11.
#   Root cause: lockfile is missing esbuild@0.28.x entries required by
#   vitest's nested vite@8.1.4 peer-dependency.
# ────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $dir

Write-Host ""
Write-Host "FinaSync lockfile fix" -ForegroundColor Cyan
Write-Host "  Dir  : $dir"
Write-Host "  Node : $(node --version)"
Write-Host "  npm  : $(npm --version)"
Write-Host ""

# Step 1 — Try the lightweight path: regenerate only the lockfile
Write-Host "[1/2] Regenerating package-lock.json (package-lock-only)..."
npm install --package-lock-only --no-audit --no-fund 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "      Done." -ForegroundColor Green
} else {
    Write-Host "      Standard attempt failed; retrying with --legacy-peer-deps ..."
    npm install --package-lock-only --no-audit --no-fund --legacy-peer-deps 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      package-lock-only both attempts failed. Falling back to full install ..."
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm install failed (exit $LASTEXITCODE). Aborting."
            exit 1
        }
    }
    Write-Host "      Done." -ForegroundColor Green
}

# Step 2 — Verify with a clean npm ci
Write-Host "[2/2] Verifying with npm ci..."
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm ci still fails (exit $LASTEXITCODE). Check output above."
    exit 1
}
Write-Host "      Passed." -ForegroundColor Green

# Cleanup diagnostic file
if (Test-Path "npm-ci-diagnostic.txt") {
    Remove-Item "npm-ci-diagnostic.txt"
    Write-Host "      Removed npm-ci-diagnostic.txt"
}

Write-Host ""
Write-Host "Done! package-lock.json is fixed. npm ci passes." -ForegroundColor Green
Write-Host "You can delete this script (fix-lockfile.ps1) when ready."
