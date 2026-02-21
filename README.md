# banasuno-backend

Backend services for BanasUno, including REST API endpoints and Davao City health facilities API. **Storage is Postgres via Supabase**.

## Backend setup necessities

Before or during setup, ensure you have:

| Requirement | Details |
|-------------|---------|
| **Node.js** | v18+ (ES modules). Check with `node -v`. |
| **npm** | Comes with Node. Check with `npm -v`. |
| **Supabase** | A Supabase project. The app uses Postgres for facilities and pipeline report. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. |
| **Env file** | Copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and optionally `FACILITIES_JSON_PATH`, `PORT`). |
| **Facilities data** | The file `davao-health-facilities.json` for seeding. Either place it at `data/davao-health-facilities.json` or set `FACILITIES_JSON_PATH` to its path. |

**Quick checklist:** Node installed → Supabase project + `.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` → run migration (see below) → `npm install` → seed once (`npm run seed:facilities`) → `npm start`.

## Stack

- **Node.js** (ES modules)
- **Express** – HTTP API
- **Supabase** (Postgres) – health facilities, pipeline report

## Setup

1. Create a [Supabase](https://supabase.com) project. In **Project Settings → API** copy the **Project URL** and **service_role** key.

2. Copy `.env.example` to `.env` and set:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your service_role key (do not commit)

3. Create the app tables in Supabase: run the SQL in **`supabase/migrations/20250220000000_app_store_tables.sql`** in the Supabase **SQL Editor** (or use `supabase db push` if you use the CLI).

4. Install dependencies:
   ```bash
   npm install
   ```

5. Seed Davao health facilities into Postgres (required before facilities endpoints work):

   **Option A:** Point to your Philippines extract repo (use your actual path).

   Linux/macOS (bash):
   ```bash
   export FACILITIES_JSON_PATH=/path/to/davao-health-facilities.json
   npm run seed:facilities
   ```

   Windows (cmd):
   ```cmd
   set FACILITIES_JSON_PATH=C:\path\to\davao-health-facilities.json
   npm run seed:facilities
   ```

   **Option B:** Copy `davao-health-facilities.json` into this repo at `data/davao-health-facilities.json`, then:
   ```bash
   npm run seed:facilities
   ```

4. Start the server:
   ```bash
   npm start
   ```
   API: http://localhost:3000

## Linking the Philippines data repo

The health facilities data comes from the [Philippines](https://github.com/...) extract (Healthsites.io/OSM). To use it with this backend:

- **Recommended:** Set `FACILITIES_JSON_PATH` to the full path of `davao-health-facilities.json` in that repo (see `.env.example`), then run `npm run seed:facilities` whenever you refresh the data (e.g. after re-running the extract script in the Philippines repo).
- **Alternative:** Copy `davao-health-facilities.json` into `data/davao-health-facilities.json` in this repo so the seed script finds it without env.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api` | API index (list of endpoints) |
| GET | `/api/facilities` | List facilities (query: `type`, `source`, `ownership`, `name`, `limit`, `offset`) |
| GET | `/api/facilities/:id` | One facility by id |
| GET | `/api/types` | Facility type summary |
| GET | `/api/heat/:cityId/barangays` | Per-barangay temp + risk + lat/lng + area. Optional `?limit=N`. Source: [WeatherAPI](https://www.weatherapi.com/). |
| GET | `/api/heat/:cityId/current` | City center current weather (temp, feels-like). WeatherAPI. |
| GET | `/api/heat/:cityId/forecast` | 7- or 14-day forecast (`?days=7` \| `14`). WeatherAPI. |
| GET | `/health` | Health check (database status) |

## Deployment

This backend is a **separate app** from the BanasUno frontend. Deploying the frontend to Vercel does not deploy or run this backend. To get live API data in production, deploy this backend (e.g. Railway, Render, Fly.io, or a second Vercel project) and set **`VITE_API_URL`** in the frontend’s Vercel env to your backend URL. See **`docs/DEPLOYMENT.md`**.

## Env vars

See `.env.example`. **Required:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. For heat/forecast: `WEATHER_API_KEY` (per-barangay temps by lat,lon). Optional: `FACILITIES_JSON_PATH`, `PORT`; **heat options** `HEAT_PER_BARANGAY=1` (one request per barangay), `HEAT_UHI_MAX` (urban heat island °C); **Edge Function** (`HEAT_WRITER_KEY` + `HEAT_SNAPSHOT_WRITER_URL` or `SUPABASE_PROJECT_REF`). **Production:** set `CORS_ORIGIN` to your frontend origin; unset = `*`.

## Sources & disclaimers (transparency)

Data used by the heat and forecast APIs comes from third-party providers and is **for planning and awareness only** — not official PAGASA or NWS observations.

| Data | Source | Use / limitation |
|------|--------|-------------------|
| **Barangay heat (barangays)** | [WeatherAPI](https://www.weatherapi.com/) (per-barangay by lat,lon) | Model/API output; not a substitute for official heat advisories or local stations. |
| **City current** | WeatherAPI (Davao center) | Same as above. |
| **7/14-day forecast** | [WeatherAPI](https://www.weatherapi.com/) | Third-party; for general planning only; not from PAGASA/NWS. |
| **Heat risk levels (1–5)** | PAGASA heat index bands + NOAA Rothfusz (when humidity available) | Validated methods; for awareness only; not official PAGASA advisories. |
| **Pipeline report** | Temp + facilities (Postgres); K-Means, EWA (1/2 each) | For prioritization only; not an official health or hazard report. |

- **Full disclaimers (what each process does, validity):** **`docs/DISCLAIMERS.md`**
- **Cited sources (NOAA, PAGASA, DOIs):** **`docs/CITED-SOURCES.md`**
- **Logic flows (backend + pipeline, step-by-step):** **`docs/LOGIC-FLOWS.md`**
- **Validity and verification (cross-check vs primary sources):** **`docs/VALIDITY.md`**

  **Canonical sources:** Flow tables live in **LOGIC-FLOWS.md**; verification/validity tables in **VALIDITY.md**; bibliography in **CITED-SOURCES.md**. Other docs point to these to avoid duplication.

---

## Heat API and heuristic model

Barangay temperature/heat API and logic live in this repo. See **`docs/HEAT-API.md`** for the API contract, backend responsibilities, and the target heuristic AI model.

## Data export and Supabase

CSV export format and Supabase schema (heat snapshots, snapshot-by-barangay) are defined in **`docs/DATA_EXPORT.md`**. The backend is the place to implement writing snapshots to Supabase and serving CSV (or snapshot) export endpoints.

## Testing APIs with real data

**`docs/TESTING-COMMANDS.md`** – curl commands and scripts to verify each API and model (facilities, heat, forecast, health) with real data. Includes required env and a quick checklist.

**`docs/API-SAMPLES.md`** – Sample JSON request/response bodies for all backend endpoints (health, facilities, heat, pipeline report).
