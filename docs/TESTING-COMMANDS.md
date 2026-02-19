# Commands to test APIs and models with real data

Use these with the server running (`npm start`) unless noted. Base URL: `http://localhost:3000` (or set `PORT` in `.env`).

**Windows PowerShell:** In PowerShell, `curl` is an alias for `Invoke-WebRequest`. To avoid the "script code in the web page might be run" warning, use **`-UseBasicParsing`**:
```powershell
Invoke-WebRequest -Uri http://localhost:3000/health -UseBasicParsing
```
Or use the real curl if installed: `curl.exe http://localhost:3000/health`.

---

## 1. Prerequisites (env)

| What you're testing | Required env |
|---------------------|--------------|
| Facilities, health check | `REDIS_URL` |
| Facilities data | Redis + run `npm run seed:facilities` (needs `FACILITIES_JSON_PATH`) |
| **Supabase (Postgres)** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (create tables from `docs/DATA_EXPORT.md` §3 for health to show connected) |
| Barangay temperatures | **METEOSOURCE_API_KEY** for different temp per barangay; or **WEATHER_API_KEY** for one city average for all |
| Barangay heat risk | **METEOSOURCE_API_KEY** for different heat per barangay; or **WEATHER_API_KEY** for city average for all |
| Forecast (7/14 day) | `WEATHER_API_KEY` |

---

## 2. Health and API info

**PowerShell (Windows):** If `curl http://localhost:3000/health` fails with "Operation cancelled due to security concerns" or "Use -UseBasicParsing", run:
```powershell
Invoke-WebRequest -Uri http://localhost:3000/health -UseBasicParsing | Select-Object -ExpandProperty Content
Invoke-WebRequest -Uri http://localhost:3000/api -UseBasicParsing | Select-Object -ExpandProperty Content
```

**Bash / curl:**
```bash
# Server, Redis, and Supabase status (Supabase shows connected only if env set and heat_snapshots exists)
curl http://localhost:3000/health

# List of endpoints
curl http://localhost:3000/api
```

**Supabase in `/health`:** If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, the response includes `supabase: "connected"` (after a quick query to `heat_snapshots`), `"not_configured"` (env missing), or `"error"` (e.g. wrong key or table not created yet). Create the schema in `docs/DATA_EXPORT.md` §3 in the Supabase SQL editor so the health check can succeed.

**If Supabase stays `not_configured`:** In your backend `.env` (in the project root, same folder as `package.json`) use **exactly** these names (no `VITE_` prefix for the key): `SUPABASE_URL=https://....supabase.co` and `SUPABASE_SERVICE_ROLE_KEY=your_secret_key`. Restart the server after changing `.env`. The backend can use `VITE_SUPABASE_URL` for the URL if `SUPABASE_URL` is missing, but the **service_role** key must be `SUPABASE_SERVICE_ROLE_KEY`.

---

## 3. Facilities API (Redis + seeded data)

```bash
# Seed first (once): needs REDIS_URL + FACILITIES_JSON_PATH
npm run seed:facilities

# List facilities (optional: ?type=hospital&limit=5)
curl "http://localhost:3000/api/facilities?limit=3"

# One facility by id (use an id from the list)
curl http://localhost:3000/api/facilities/1068744746

# Facility types summary
curl http://localhost:3000/api/types

# Facilities in a barangay (use a Davao PSGC e.g. from heat GeoJSON)
curl http://localhost:3000/api/facilities/by-barangay/1130700001
```

---

## 4. Heat API – barangay temperatures

```bash
# Needs WEATHER_API_KEY or METEOSOURCE_API_KEY
curl http://localhost:3000/api/heat/davao/barangay-temperatures
```

Expect: `temperatures`, `min`, `max`, and optionally `averageTemp`.

---

## 5. Heat API – barangay heat risk (PAGASA model)

```bash
# With METEOSOURCE_API_KEY: per-barangay temps, risk varies. With WEATHER_API_KEY only: city average for all, uniform risk.
curl http://localhost:3000/api/heat/davao/barangay-heat-risk

# Fewer barangays (faster; Meteosource only; limit ignored when using WeatherAPI-only)
curl "http://localhost:3000/api/heat/davao/barangay-heat-risk?limit=5"
```

Requires at least one of: `METEOSOURCE_API_KEY` or `WEATHER_API_KEY`. Expect: `temperatures`, `averageTemp`, `risks`, `counts`, `legend`, `basis`, `meta`.

---

## 6. Heat API – 7/14 day forecast

```bash
# Needs WEATHER_API_KEY
curl http://localhost:3000/api/heat/davao/forecast
curl "http://localhost:3000/api/heat/davao/forecast?days=14"
```

Expect: `days`, `forecastDayCount`, `forecastDay[]`, `location`, `updatedAt`.

---

## 7. Standalone scripts (no server)

```bash
# Verify 7- and 14-day forecast return correct day count (WEATHER_API_KEY)
node scripts/check-forecast-days.js

# Compare WeatherAPI response at several barangay points (WEATHER_API_KEY)
node scripts/check-weatherapi-per-barangay.js
```

---

## 8. Database connection (Supabase)

```bash
# 1. Set in .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from Supabase dashboard → Project Settings → API)
# 2. Create tables: run the SQL from docs/DATA_EXPORT.md §3 in Supabase SQL editor
# 3. Start server and check health (supabase should be "connected")
curl http://localhost:3000/health
```

Use the backend client in code: `import { supabase, isSupabaseConfigured, pingSupabase } from "./lib/supabase.js"`. Only use the service role key on the server; never expose it to the frontend.

---

## 9. Quick checklist

| Test | Command | Requires |
|------|---------|----------|
| Health (Redis + Supabase) | `curl http://localhost:3000/health` | Redis; Supabase optional (env + schema) |
| Facilities list | `curl "http://localhost:3000/api/facilities?limit=2"` | Redis + seed |
| One facility | `curl http://localhost:3000/api/facilities/1068744746` | Redis + seed |
| By barangay | `curl http://localhost:3000/api/facilities/by-barangay/1130700001` | Redis + seed |
| Types | `curl http://localhost:3000/api/types` | Redis + seed |
| Barangay temps | `curl http://localhost:3000/api/heat/davao/barangay-temperatures` | WEATHER_API_KEY or METEOSOURCE_API_KEY |
| Heat risk | `curl "http://localhost:3000/api/heat/davao/barangay-heat-risk?limit=3"` | METEOSOURCE_API_KEY or WEATHER_API_KEY |
| Forecast 7d | `curl http://localhost:3000/api/heat/davao/forecast` | WEATHER_API_KEY |
| Forecast 14d | `curl "http://localhost:3000/api/heat/davao/forecast?days=14"` | WEATHER_API_KEY |
| Forecast script | `node scripts/check-forecast-days.js` | WEATHER_API_KEY |
| WeatherAPI per point | `node scripts/check-weatherapi-per-barangay.js` | WEATHER_API_KEY |
| Push test data to Supabase | `npm run test:supabase-push` | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY + tables (§3) |

---

## 10. Supabase CLI (link, migrations, etc.)

The `supabase` command is not installed globally by default. Use it via **npx** (after `npm install` in this repo).

**Log in first** (required for `link`, `db push`, etc.):

```powershell
npx supabase login
```

This opens a browser to get an access token and saves it locally. Alternatively set `SUPABASE_ACCESS_TOKEN` to a **personal access token** from [Supabase Dashboard → Account → Access Tokens](https://supabase.com/dashboard/account/tokens). The token must start with **`sbp_`** (e.g. `sbp_0102...1920`). Do not use the project’s `service_role` key from Project Settings → API—that is for the backend only.

Then link your project:

```powershell
npx supabase link --project-ref pagpohmpymbivwiwcnqn
```

Or install the CLI globally (optional):

- **Windows (Scoop):** `scoop install supabase` (install Scoop first: [scoop.sh](https://scoop.sh))
- **npm global:** `npm install -g supabase` (Node 20+; on Windows you may need to fix PATH)
- **Chocolatey:** `choco install supabase`

Then you can run `supabase link`, `supabase db push`, etc. from the project root.
