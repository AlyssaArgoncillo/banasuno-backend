# Run AI pipeline: fetch from backend, then weighted heat risk.
# Uses py (Python launcher) so it works when "python" is not on PATH.
# Run from repo root: .\ai\run_pipeline.ps1
# Or from ai folder: .\run_pipeline.ps1

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not $env:BACKEND_URL) { $env:BACKEND_URL = "http://localhost:3000" }

Write-Host "Fetching data from $env:BACKEND_URL ..."
py -m pip install -q -r requirements.txt 2>$null
py fetch_pipeline_data.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running weighted heat risk pipeline ..."
py weighted_heat_risk_pipeline.py --input barangay_data_today.csv --no-rolling --output barangay_heat_risk_today.csv
exit $LASTEXITCODE
