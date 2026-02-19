# banasuno-backend

Backend services for BanasUno, including REST API endpoints, Redis, and Davao City health facilities API.

## Backend setup necessities

Before or during setup, ensure you have:

| Requirement | Details |
|-------------|---------|
| **Node.js** | v18+ (ES modules). Check with `node -v`. |
| **npm** | Comes with Node. Check with `npm -v`. |
| **Redis** | A running Redis server (local or remote). The app and seed script connect via `REDIS_URL`. Default: `redis://localhost:6379`. |
| **Env file** | Copy `.env.example` to `.env` and set `REDIS_URL` (and optionally `FACILITIES_JSON_PATH`, `PORT`) as needed. |
| **Facilities data** | The file `davao-health-facilities.json` for seeding. Either place it at `data/davao-health-facilities.json` or set `FACILITIES_JSON_PATH` to its path. |

**Quick checklist:** Node installed → Redis running → `.env` with `REDIS_URL` → `npm install` → seed once (`npm run seed:facilities`) → `npm start`.

## Stack

- **Node.js** (ES modules)
- **Express** – HTTP API
- **Redis** (ioredis) – cache / data store for health facilities

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run Redis locally (e.g. Docker: `docker run -d -p 6379:6379 redis`) or set `REDIS_URL` to your Redis instance.

3. Seed Davao health facilities into Redis (required before facilities endpoints work):

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
| GET | `/api` | API info |
| GET | `/api/facilities` | List facilities (query: `type`, `source`, `ownership`, `name`, `limit`, `offset`) |
| GET | `/api/facilities/:id` | One facility by id |
| GET | `/api/types` | Facility type summary |
| GET | `/api/heat/:cityId/barangay-temperatures` | Barangay temperatures. Different temp per barangay: [Meteosource](https://www.meteosource.com/). Fallback: [WeatherAPI](https://www.weatherapi.com/) city average for all. |
| GET | `/api/heat/:cityId/barangay-heat-risk` | Barangay temps + PAGASA heat-risk. Per-barangay different heat: Meteosource; optional `?limit=`. |
| GET | `/api/heat/:cityId/forecast` | 7- or 14-day forecast from WeatherAPI (`?days=7` or `?days=14`) |
| GET | `/health` | Health check (includes Redis status) |

## Env vars

See `.env.example`. Main ones: `REDIS_URL`, `FACILITIES_JSON_PATH`, `PORT`. For **different heat temps per barangay** use `METEOSOURCE_API_KEY`; `WEATHER_API_KEY` alone gives one city average for all. Optional: **Supabase** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) for Postgres/heat snapshots; **Edge Function** (`HEAT_WRITER_KEY` + `HEAT_SNAPSHOT_WRITER_URL` or `SUPABASE_PROJECT_REF`) to write snapshots—keep keys server-side only. **Production:** set `CORS_ORIGIN` to your frontend origin (e.g. `https://your-app.vercel.app`) to restrict CORS; unset = `*`.

## Heat API and heuristic model

Barangay temperature/heat API and logic live in this repo. See **`docs/HEAT-API.md`** for the API contract, backend responsibilities, and the target heuristic AI model.

## Data export and Supabase

CSV export format and Supabase schema (heat snapshots, snapshot-by-barangay) are defined in **`docs/DATA_EXPORT.md`**. The backend is the place to implement writing snapshots to Supabase and serving CSV (or snapshot) export endpoints.

## Testing APIs with real data

**`docs/TESTING-COMMANDS.md`** – curl commands and scripts to verify each API and model (facilities, heat, forecast, health) with real data. Includes required env and a quick checklist.
