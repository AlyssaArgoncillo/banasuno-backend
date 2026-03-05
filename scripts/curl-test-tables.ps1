# Curl tests for historical_trends, city_temperatures (via heat/summary), and heat_risk_counts.
# Start the server first: npm start  or  node src/index.js
# Then run: .\scripts\curl-test-tables.ps1

$Base = if ($env:BASE_URL) { $env:BASE_URL } else { "http://localhost:3000" }

Write-Host "=== 1. historical_trends (GET /api/historical-trends) ===" -ForegroundColor Cyan
Invoke-RestMethod -Uri "$Base/api/historical-trends?city_id=davao&limit=5" -Method Get | ConvertTo-Json -Depth 5

Write-Host "`n=== 2. heat_risk_counts (GET /api/heat/counts) ===" -ForegroundColor Cyan
Invoke-RestMethod -Uri "$Base/api/heat/counts" -Method Get | ConvertTo-Json -Depth 5

Write-Host "`n=== 3. city_temperatures + heat_risk_counts (GET /api/heat/summary) ===" -ForegroundColor Cyan
Invoke-RestMethod -Uri "$Base/api/heat/summary" -Method Get | ConvertTo-Json -Depth 5

Write-Host "`n=== 4. historical_trends with sync (GET ...&sync=1) ===" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$Base/api/historical-trends?city_id=davao&limit=5&sync=1" -Method Get | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Response: $($_.Exception.Message)"
}

Write-Host "`n=== 5. POST /api/historical-trends/sync ===" -ForegroundColor Cyan
try {
    $body = @{ city_id = "davao"; days = 7 } | ConvertTo-Json
    Invoke-RestMethod -Uri "$Base/api/historical-trends/sync" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Response: $($_.Exception.Message)"
}

Write-Host "`nDone." -ForegroundColor Green
