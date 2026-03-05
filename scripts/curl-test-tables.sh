#!/usr/bin/env bash
# Curl tests for historical_trends, city_temperatures (via heat/summary), and heat_risk_counts.
# Start the server first: npm start  or  node src/index.js
# Then run: bash scripts/curl-test-tables.sh   (or from repo root: ./scripts/curl-test-tables.sh)

BASE="${BASE_URL:-http://localhost:3000}"

echo "=== 1. historical_trends (GET /api/historical-trends) ==="
curl -s "${BASE}/api/historical-trends?city_id=davao&limit=5" | head -c 800
echo -e "\n"

echo "=== 2. historical_trends with sync (GET ...&sync=1, needs WEATHER_API_KEY) ==="
curl -s "${BASE}/api/historical-trends?city_id=davao&limit=5&sync=1" | head -c 800
echo -e "\n"

echo "=== 3. heat_risk_counts (GET /api/heat/counts) ==="
curl -s "${BASE}/api/heat/counts"
echo -e "\n"

echo "=== 4. city_temperatures + heat_risk_counts (GET /api/heat/summary) ==="
curl -s "${BASE}/api/heat/summary"
echo -e "\n"

echo "=== 5. POST /api/historical-trends/sync (needs WEATHER_API_KEY) ==="
curl -s -X POST "${BASE}/api/historical-trends/sync" -H "Content-Type: application/json" -d "{\"city_id\":\"davao\",\"days\":7}"
echo -e "\n"

echo "Done."
