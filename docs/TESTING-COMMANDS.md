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
| Facilities, health check, pipeline report | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Facilities data | Run migration `supabase/migrations/20250220000000_app_store_tables.sql` in Supabase SQL Editor, then `npm run seed:facilities` (needs `FACILITIES_JSON_PATH` or file in `data/`) |
| Barangay temperatures | **WEATHER_API_KEY** (per-barangay by lat,lon) |
| Barangay heat risk | **WEATHER_API_KEY** (same as above) |
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
# Server and database status (database = Supabase/Postgres; run app store migration first)
curl http://localhost:3000/health

# List of endpoints
curl http://localhost:3000/api
```

**Database in `/health`:** The response includes `database: "connected"` when Supabase is configured and the app store tables exist, `"not_configured"` (env missing), or `"error"` (e.g. wrong key or tables not created). Run `supabase/migrations/20250220000000_app_store_tables.sql` in the Supabase SQL Editor.

**If Supabase stays `not_configured`:** In your backend `.env` (in the project root, same folder as `package.json`) use **exactly** these names (no `VITE_` prefix for the key): `SUPABASE_URL=https://....supabase.co` and `SUPABASE_SERVICE_ROLE_KEY=your_secret_key`. Restart the server after changing `.env`. The backend can use `VITE_SUPABASE_URL` for the URL if `SUPABASE_URL` is missing, but the **service_role** key must be `SUPABASE_SERVICE_ROLE_KEY`.

---

## 3. Facilities API (Supabase + seeded data)

```bash
# Seed first (once): needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + migration run + FACILITIES_JSON_PATH (or file in data/)
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

## 4. Heat API – barangays (temp + risk + lat/lng + area)

```bash
# Needs WEATHER_API_KEY. Optional: ?limit=5.
curl http://localhost:3000/api/heat/davao/barangays
curl "http://localhost:3000/api/heat/davao/barangays?limit=5"
```

Expect: `barangays[]` with `barangay_id`, `temp_c`, `risk`, `lat`, `lng`, `area_km2`; `meta` (legend, basis).

---

## 5. Heat API – city current & forecast

**Current (temp, feels-like):**

```bash
curl http://localhost:3000/api/heat/davao/current
```

Expect: `temp_c`, `feelslike_c`, `difference_c`.

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
| Health (database) | `curl http://localhost:3000/health` | Supabase (env + app store migration) |
| Facilities list | `curl "http://localhost:3000/api/facilities?limit=2"` | Supabase + seed |
| One facility | `curl http://localhost:3000/api/facilities/1068744746` | Supabase + seed |
| By barangay | `curl http://localhost:3000/api/facilities/by-barangay/1130700001` | Supabase + seed |
| Types | `curl http://localhost:3000/api/types` | Supabase + seed |
| Barangays (temp + risk + geo) | `curl http://localhost:3000/api/heat/davao/barangays` | WEATHER_API_KEY |
| Temp vs feels-like | `curl http://localhost:3000/api/heat/davao/temp-vs-feelslike` | WEATHER_API_KEY |
| City current | `curl http://localhost:3000/api/heat/davao/current` | WEATHER_API_KEY |
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
