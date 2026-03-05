@echo off
REM Fetch-only tests for historical_trends, city_temperatures, heat_risk_counts.
REM Start server first: npm start
REM Run from repo root: scripts\curl-test-fetch.cmd

set BASE=http://localhost:3000
if defined BASE_URL set BASE=%BASE_URL%

echo === 1. GET historical_trends (by city_id, limit) ===
curl -s "%BASE%/api/historical-trends?city_id=davao&limit=5"
echo.

echo === 2. GET historical_trends (empty city_id - should still return default or empty) ===
curl -s "%BASE%/api/historical-trends?city_id=&limit=3"
echo.

echo === 3. GET city-temperatures (daily table) ===
curl -s "%BASE%/api/city-temperatures?city_id=davao&limit=5"
echo.

echo === 4. GET heat-risk-counts (daily table) ===
curl -s "%BASE%/api/heat-risk-counts?city_id=davao&limit=5"
echo.

echo === 5. GET historical/city-temperatures (historical_trends table) ===
curl -s "%BASE%/api/historical/city-temperatures?city_id=davao&limit=5&offset=0"
echo.

echo === 6. GET historical/heat-risk-counts (heat_risk_counts table) ===
curl -s "%BASE%/api/historical/heat-risk-counts?city_id=davao&limit=5&offset=0"
echo.

echo === 7. GET heat/counts (aggregated today) ===
curl -s "%BASE%/api/heat/counts"
echo.

echo === 8. GET heat/summary (counts + city temp) ===
curl -s "%BASE%/api/heat/summary"
echo.

echo Done.
