# Scheduled jobs – automatic fresh data in Supabase

To keep **city_temperatures**, **heat_risk_counts**, and **historical_trends** in Supabase filled with fresh data without manual runs, use the built-in scheduler.

## One process: hourly heat risk + historical after midnight

Run the heat risk job in **scheduled mode**:

```bash
npm run heat-risk-job:schedule
```

Or:

```bash
node src/jobs/heatRiskJob.js --schedule
```

**Behavior (automatic):**

| What | When |
|------|------|
| **Heat risk + city temperatures** | Every **hour** (barangay temps, heat_risk_counts, city_temperatures, 7-day cleanup). |
| **Historical trends** | Once per day **after midnight** (UTC hour 0 by default). Fetches last 14 days from WeatherAPI, upserts into `historical_trends`, runs 30-day cleanup. |

- The process runs indefinitely: it executes once on start, then every 60 minutes.
- Keep this process running (e.g. on a server, PM2, or a long-running Node process). When it stops, no new data is written until you run it again (or use system cron instead).

## Optional: historical trends hour (UTC)

By default, historical trends run when UTC hour is **0** (midnight UTC). To use a different hour (e.g. 1:00 UTC):

In `.env`:

```env
HEAT_HISTORICAL_UTC_HOUR=1
```

Values 0–23. Only the **hour** is used (e.g. `1` = once per day at 01:00 UTC).

## Manual runs (no schedule)

- **One-off full run** (heat risk + city temps + historical + cleanups):
  ```bash
  npm run heat-risk-job
  ```
- **Historical trends only** (e.g. after adding WEATHER_API_KEY): call the API:
  ```bash
  curl -X POST http://localhost:3000/api/historical-trends/sync
  ```

## Retention

- **city_temperatures** and **heat_risk_counts**: 7-day retention; cleanup runs after each job run.
- **historical_trends**: 30-day retention; cleanup runs when historical trends are run (midnight hour in scheduled mode, or on manual full run / sync).

## Requirements

- **.env**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. For city temp and historical trends: `WEATHER_API_KEY`. Open-Meteo is used for barangay temps (no key required).
- Keep the scheduled process running (e.g. on your deployment host) so that hourly and midnight runs happen automatically.
