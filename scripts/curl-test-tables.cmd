@echo off
REM Curl tests for historical_trends, city_temperatures, heat_risk_counts.
REM Start server first: npm start
REM Run from repo root: scripts\curl-test-tables.cmd

set BASE=http://localhost:3000
if defined BASE_URL set BASE=%BASE_URL%

echo === 1. historical_trends [GET /api/historical-trends] ===
curl -s "%BASE%/api/historical-trends?city_id=davao&limit=5"
echo.

echo === 2. heat_risk_counts [GET /api/heat/counts] ===
curl -s "%BASE%/api/heat/counts"
echo.

echo === 3. city_temperatures + heat_risk_counts [GET /api/heat/summary] ===
curl -s "%BASE%/api/heat/summary"
echo.

echo === 4. GET historical/city-temperatures (historical_trends) ===
curl -s "%BASE%/api/historical/city-temperatures?city_id=davao&limit=5"
echo.

echo === 5. POST historical/city-temperatures (upsert into historical_trends) ===
curl -s -X POST "%BASE%/api/historical/city-temperatures" -H "Content-Type: application/json" -d "{\"city_id\":\"davao\",\"avg_temp_c\":28.2,\"recorded_at\":\"2026-02-27\"}"
echo.

echo === 6. POST historical-trends/sync ===
curl -s -X POST "%BASE%/api/historical-trends/sync" -H "Content-Type: application/json" -d "{\"city_id\":\"davao\",\"days\":7}"
echo.

echo === 7. GET city-temperatures ===
curl -s "%BASE%/api/city-temperatures?city_id=davao&limit=5"
echo.

echo === 8. POST city-temperatures (insert) ===
curl -s -X POST "%BASE%/api/city-temperatures" -H "Content-Type: application/json" -d "{\"city_id\":\"davao\",\"avg_temp_c\":28.5,\"source\":\"weatherapi\"}"
echo.

echo === 9. GET heat-risk-counts ===
curl -s "%BASE%/api/heat-risk-counts?city_id=davao&limit=5"
echo.

echo === 10. POST heat-risk-counts/cleanup ===
curl -s -X POST "%BASE%/api/heat-risk-counts/cleanup"
echo.

echo === 11. POST city-temperatures/cleanup ===
curl -s -X POST "%BASE%/api/city-temperatures/cleanup"
echo.

echo Done.
