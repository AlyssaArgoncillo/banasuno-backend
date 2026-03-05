# Frontend & Backend Integration – Complete Reference (single doc)

**This document is self-contained.** The frontend does not need access to the backend repo. All contract details, backend implementation notes, and troubleshooting that were in separate backend docs are included below.

- **Backend base URL:** Use your actual backend (e.g. `http://localhost:3000` in dev, or your deployed URL). All paths are relative to that base.
- **Alignment:** Use the sections **"Dashboard & heat map – backend implementation details"** and **"Backend implementation details (for alignment)"** for exact request/response/error shapes so the frontend matches the backend.

---

## All implemented changes (every successful change)

This list is the full set of what was implemented. When we say “all that is implemented,” we mean exactly these:

1. **Heat (Risk) Advisory AI** – Backend: `POST/GET /api/heat-advisory` (Gemini or fallback). Returns `tagline` + `advices` (title/body). Frontend: wire Heat Advisory page (UrgencyTicker / Safety Recommendations) to this API; replace static copy. Full contract: **Heat Advisory AI – full contract** below.
2. **Export CSV – KPI strip** – Backend: `GET /api/heat/export/city`. Frontend: call with date, trigger download. Full contract: **Export CSV – full contract** below.
3. **Export CSV – Historical Trends** – Backend: `GET /api/historical-trends/export`. Frontend: call with city_id, days, date; trigger download. Full contract: **Export CSV – full contract** below.
4. **Route visualization (Show Route)** – Backend: `POST /api/ors/directions` (proxies OpenRouteService). Frontend: “Show Route” on facility card, profile dropdown, polyline #FF9559, markers, distance/time, fit bounds, card highlight, clear previous route. Full contract: **Show Route (ORS Directions) – full contract** below.
5. **Dashboard overview / API mapping** – Which API powers which dashboard section (KPI strip, facility directory, historical trends, All Barangays, heat map, Heat Advisory page, Export CSV, Show Route). See dashboard table and **Dashboard API contract – full** below.
6. **Data sync clarification** – When Supabase is updated: historical trends via API sync; heat risk counts & city temps via job. No new endpoints. See **Data sync** section below.
7. **Barangay geo resilience** – Backend only: timeout + retries for barangay GeoJSON fetch on flaky networks. No frontend change. See **Barangay geo** section below.

---

## Dashboard overview – which API powers which section

The dashboard is built from several sections. Each section has a designated backend API. Use the right one; do not substitute (e.g. do not use forecast for historical trends, or full facilities list for the chosen-place directory).

### Dashboard UI layout (top-to-bottom order)

For frontend layout alignment, the dashboard flows in this order (top → bottom):

1. **KPI strip** – Heat risk zone counts (Not Hazardous, Caution, …) and optional city average temp. **Export CSV** here uses a **date selector**: the backend has 7-day retention for heat risk/city temp data, so the user picks which day (within the last 7 days) to export → `GET /api/heat/export/city?date=YYYY-MM-DD`.
2. **Heat map** – Barangay zones with temps/risk; click zone → ZoneInfoCard with facilities and “Show Route”. Data: `GET /api/heat/davao/barangays` + GeoJSON; facilities: `GET /api/facilities/by-barangay/:id`; route: `POST /api/ors/directions`.
3. **Health facility directory (chosen place)** – “Nearby Health Facilities” / facility list for the selected zone; use `total_label` for “(N facilities)”. API: `GET /api/facilities/by-barangay/:barangayId`.
4. **All Barangays table** – “ALL BARANGAYS — HEAT RISK OVERVIEW”: Barangay, Temperature, Risk Level, Nearby Facilities (count), View. Data: `GET /api/heat/davao/barangays` + `POST /api/facilities/counts-by-barangays`; View: `GET /api/facilities/by-barangay/:id`.
5. **Historical trends** – Past temperature chart (7d / 14d). **Export CSV** button here → `GET /api/historical-trends/export`. API: `GET /api/historical-trends?city_id=davao&days=7|14`.

So: **KPI (with Export) → Heat map → Facility directory → All Barangays table → Historical trends (with Export)**. Adjust only the dashboard (e.g. wiring, labels, order) as needed; backend contracts are fixed.

---

| Dashboard section | API to use | Do not use |
|-------------------|------------|------------|
| **KPI strip** (heat risk zone counts) | `GET /api/heat/counts` or `GET /api/heat/summary?city_id=davao` | Counts from `/api/heat/davao/barangays` |
| **KPI strip – Export CSV** | `GET /api/heat/export/city?date=...&city_id=davao` | — (see §2 below) |
| **Health facility directory** (chosen place only) | `GET /api/facilities/by-barangay/:barangayId` | `GET /api/facilities` (all facilities) |
| **Facility card – Show Route** | `POST /api/ors/directions` (start = barangay center, end = facility) | Calling OpenRouteService directly (see §4 below) |
| **Historical trends** (past data) | `GET /api/historical-trends?city_id=davao&days=7` or `&days=14` | `GET /api/heat/davao/forecast` (forecast = future) |
| **Historical trends – Export CSV** | `GET /api/historical-trends/export?city_id=...&days=...&date=...` | — (see §3 below) |
| **All Barangays table** (heat risk overview) | Barangay list + temps/risk: `GET /api/heat/davao/barangays`; counts: `POST /api/facilities/counts-by-barangays`; View: `GET /api/facilities/by-barangay/:barangayId` | — |
| **Heat map** (barangay zones, temps, risk) | `GET /api/heat/davao/barangays` (and GeoJSON for boundaries) | — |
| **Heat Advisory page** (UrgencyTicker / Safety Recommendations) | `POST /api/heat-advisory` or `GET /api/heat-advisory` | — |

Full dashboard contract, Export CSV, Heat Advisory, Show Route, and troubleshooting are all in this document below.

---

## Dashboard & heat map – backend implementation details (for alignment)

Fully detailed request/response/error shapes for every dashboard and heat-map endpoint so the frontend can align exactly. Use the same field names and types; handle the error shapes below.

### KPI strip – heat risk counts

**GET /api/heat/counts**

- **Request:** GET only. No required query params. Optional: `city_id` (backend may use for future scoping; currently counts are for today’s data).
- **Response (200):** JSON array of objects. Each: `{ "risk_level": number (1–5), "risk_label": string, "total": number }`. Sorted by `risk_level`. Example: `[{ "risk_level": 1, "risk_label": "Not Hazardous", "total": 85 }, { "risk_level": 2, "risk_label": "Caution", "total": 42 }, ...]`.
- **Error (500):** JSON `{ "error": "Failed to load heat risk counts" }`.

**GET /api/heat/summary**

- **Request:** GET only. Query: `city_id` (optional; default `"davao"`), `format` (optional; `"rows"` returns a unified array for CSV-style use).
- **Response (200):**  
  - Default: `{ "city_id": string, "city_avg_temp_c": number | null, "recorded_at": string | null, "risk_counts": Array<{ risk_level, risk_label, total }>, "city_avg_temp": object | null }`.  
  - If `format=rows`: same shape as CSV rows – array of `{ city_id, recorded_at, risk_level, risk_label, total, avg_temp_c }`.
- **Error (500):** JSON `{ "error": "Failed to load heat summary" }`.

### Heat map & All Barangays table – barangay list with temps and risk

**GET /api/heat/:cityId/barangays**

- **Path:** `:cityId` must be `davao` (only supported city). Use path `GET /api/heat/davao/barangays`.
- **Request:** GET only. Query: `limit` (optional; number, cap barangays returned; null = all).
- **Response (200):** JSON:
  - `barangays`: array of `{ barangay_id: string, temp_c: number | null, temperature_c: number | null, risk_level: number (1–5), risk_label: string, risk: { score: number, level: number, label: string, heat_index_c?: number }, lat: number, lng: number, area_km2?: number }`. Use `barangay_id` to join with GeoJSON (e.g. `adm4_psgc`) and for facility counts/View.
  - `updatedAt`: string (ISO 8601).
  - `meta`: object with `cityId`, `count`, `dataSource` ("supabase" | "live"), `temperaturesSource`, `legend` (PAGASA levels), `temperature_min_c`, `temperature_max_c` (for legend).
  - `min`, `max`: same as `meta.temperature_min_c`, `meta.temperature_max_c`.
- **Error (404):** JSON `{ "error": "City not supported", "cityId": string }` if `cityId !== "davao"`.
- **Error (503):** JSON if WeatherAPI required but not configured (when using live provider).
- **Error (500):** JSON `{ "error": "Failed to fetch barangay heat data", "details": string, "stack"?: string }`.
- **Note:** Heat map draws zones from GeoJSON (frontend); backend provides per-barangay `lat`, `lng`, `temperature_c`, `risk_level`, `risk_label` so the map can color zones and show tooltips. All Barangays table uses the same `barangays` array for rows (Barangay, Temperature, Risk Level); then facility count comes from `POST /api/facilities/counts-by-barangays`, and View uses `GET /api/facilities/by-barangay/:barangayId`.

### Health facility directory (chosen place) & facility list for View

**GET /api/facilities/by-barangay/:barangayId**

- **Path:** `:barangayId` = PSGC code (e.g. `1130700001`), same as `barangay_id` from heat barangays / GeoJSON.
- **Request:** GET only. No body.
- **Response (200):** JSON:
  - `barangayId`: string.
  - `total`: number.
  - `total_label`: string (e.g. `"5 facilities"`).
  - `facilities`: array of facility objects. Each has at least: `id`, `name`, `latitude`, `longitude` (from DB). Each facility also has `distance_meters` (number) — **straight-line distance** from barangay center, for use as fallback when the routing API fails. When `fallback_nearest: true`, facilities are nearest to barangay (not necessarily inside it); `travel_time_seconds` may be null.
  - `fallback_nearest`: boolean (optional). Present and true when no facilities in barangay; list is then nearest facilities.
  - `message`: string (optional). Present when `fallback_nearest` is true (e.g. "No facilities in this barangay; showing nearest with distance_meters.").
- **ZoneInfoPanel distance display:** Prefer **route distance and time** from `POST /api/ors/directions` (using selected profile: driving / walking / cycling). If the directions request fails (network, 502, 503), show **straight-line distance** from the facility list: use `facility.distance_meters` from `GET /api/facilities/by-barangay/:id` (e.g. display as "~3.1 km" or "3.1 km (straight line)"). Do not show both; show route when available, otherwise straight-line.
- **Error (400):** JSON `{ "error": "barangayId required" }`.
- **Error (404):** JSON `{ "error": "Barangay not found", "barangayId": string, "hint": "Use a Davao barangay id (e.g. PSGC adm4_psgc from the heat map GeoJSON)" }`.
- **Error (500):** JSON `{ "error": "Failed to assess facilities in barangay" }`.

### All Barangays table – batch facility counts

**POST /api/facilities/counts-by-barangays**

- **Request:** POST. `Content-Type: application/json`. Body: `{ "barangayIds": string[] }` (array of PSGC codes; same IDs as in `GET /api/heat/davao/barangays`). Required and must be non-empty.
- **Response (200):** JSON `{ "counts": { [barangayId: string]: number } }`. Key = barangay ID, value = number of facilities (straight-line / backend rules). Use to fill “Nearby Facilities” column.
- **Error (400):** JSON `{ "error": "barangayIds array required and non-empty" }`.
- **Error (500):** JSON `{ "error": "Failed to fetch facility counts" }`.

### Historical trends (past data only)

**GET /api/historical-trends**

- **Request:** GET only. Query: `city_id` (optional; default `"davao"`), `days` (optional; `7` or `14` – overrides `limit`), `limit` (optional; default 30, max 90), `sync` (optional; `"1"` or `"true"` to trigger WeatherAPI sync before returning).
- **Response (200):** JSON:
  - `city_id`: string.
  - `rows`: array of `{ recorded_at: string (YYYY-MM-DD), city_avg_temp_c: number, city_max_temp_c?: number, city_min_temp_c?: number, rolling_7d_avg_c?: number, rolling_14d_avg_c?: number }` (most recent first).
  - `trend_7d_avg_c`, `trend_14d_avg_c`: number | null.
  - `summary`: `{ avg_c, max_c, min_c, rolling_7d_avg_c, rolling_14d_avg_c }`.
- **Error (503):** JSON if `sync=1` and `WEATHER_API_KEY` missing, or if Supabase/historical_trends fails (e.g. `{ "error": "WEATHER_API_KEY required for sync", "hint": "..." }` or `{ "error": "Failed to load historical trends", "hint": "..." }`).
- **Error (500):** JSON `{ "error": "Internal server error" }`.
- **Do not use:** `GET /api/heat/davao/forecast` for this section (that is future forecast). Use this endpoint only for the historical trends row.

### Heat map – GeoJSON boundaries

- Barangay boundaries (polygons) for drawing the heat map zones are **not** returned by the backend. The frontend loads GeoJSON from the same source the backend uses (e.g. `https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/...` for Davao barangays) or from its own static asset. Backend provides **only** the list from `GET /api/heat/davao/barangays` (barangay_id, lat, lng, temperature_c, risk_level, risk_label). Frontend joins GeoJSON features by `barangay_id` (e.g. `adm4_psgc`) and uses `temperature_c` / `risk_level` for coloring and tooltips.

---

## Heat Advisory AI – full contract

- **Endpoints:** POST `/api/heat-advisory` (preferred, JSON body) or GET `/api/heat-advisory` (query params). All fields optional; backend defaults risk to level 2 / "Caution"; normalizes `risk_level` ↔ `risk_label`.
- **Request body (POST):** `barangay_id`, `barangay_name`, `risk_level` (1–5), `risk_label`, `temperature_c`. Same as query params for GET.
- **Response (200):** `{ "tagline": string, "advices": [ { "title": string, "body": string }, ... ] (≥3), "risk_level"?, "barangay_name"?, "generated_at"? (ISO 8601) }`.
- **Error (4xx/5xx):** `{ "error": string, "details"?: string }`. Frontend: show fallback (e.g. static advisories by risk level) or error.
- **PAGASA levels:** 1 = Not Hazardous, 2 = Caution, 3 = Extreme Caution, 4 = Danger, 5 = Extreme Danger.
- **Caching:** Backend caches per `(barangay_id or "default", risk_level)` for 5 minutes.

---

## Export CSV – full contract

**KPI strip:** GET `/api/heat/export/city?date=YYYY-MM-DD&city_id=davao`. Query: `date` (optional, default today UTC), `city_id` (optional, default `davao`). The KPI export has a **date selector** in the UI because the backend keeps only **7 days** of heat risk/city temperature data (7-day retention); the user selects which day within that window to export. Response: CSV, `Content-Disposition: attachment; filename="heat_risk_city_avg_YYYY-MM-DD.csv"`. Columns: `city_id`, `recorded_at`, `risk_level`, `risk_label`, `total`, `avg_temp_c`. On error: JSON `{ "error", "details" }`.

**Historical Trends:** GET `/api/historical-trends/export?city_id=davao&days=7|14&date=YYYY-MM-DD`. Query: `city_id`, `days` (7 or 14), `limit` (1–90), `date` (filename only). Response: CSV, `filename="historical_trends_YYYY-MM-DD.csv"`. Columns: `recorded_at`, `city_id`, `city_avg_temp_c`, `city_max_temp_c`, `city_min_temp_c`, `rolling_7d_avg_c`, `rolling_14d_avg_c`. On error: JSON. Frontend: trigger download (e.g. open URL or fetch + blob); on 4xx/5xx show error.

---

## Show Route (ORS Directions) – full contract

- **Endpoint:** POST `<backend>/api/ors/directions`. Do not call OpenRouteService from the client.
- **Request:** Body `{ "start": [lng, lat] or { lng, lat }, "end": [lng, lat] or { lng, lat }, "profile"?: "driving-car" | "foot-walking" | "cycling-regular" }`. Default profile `driving-car`.
- **Response (200):** ORS GeoJSON: `type: "FeatureCollection"`, `features[0].geometry.coordinates` (LineString), `features[0].properties.summary`: `{ distance` (metres), `duration` (seconds) `}`. Draw polyline #FF9559, 4px; start/end markers; fit bounds; show distance (km) and time (min) in card; left-border highlight when route active; clear on new route or selection change.
- **Errors:** 400 (invalid/missing start/end), 502 (ORS/backend error), 503 (OPEN_ROUTE_API_KEY not set). All JSON `{ "error", "details"?: ... }`.

---

## Dashboard API contract – full

- **KPI strip:** Use `GET /api/heat/counts` (array of `{ risk_level, risk_label, total }`) or `GET /api/heat/summary?city_id=davao` (adds `city_avg_temp_c`, `recorded_at`, `risk_counts`). Do not derive counts from `GET /api/heat/davao/barangays`.
- **Health facility directory (chosen place):** `GET /api/facilities/by-barangay/:barangayId`. Response: `{ barangayId, total, total_label, facilities[], fallback_nearest?, message? }`. Do not use `GET /api/facilities` (all facilities).
- **Historical trends:** `GET /api/historical-trends?city_id=davao&days=7` or `&days=14`. Do not use `GET /api/heat/davao/forecast` (future forecast).
- **All Barangays table:** Barangay list + temps/risk from `GET /api/heat/davao/barangays` (`barangays[]`: `barangay_id`, `temperature_c`, `risk_level`, `risk_label`); counts from `POST /api/facilities/counts-by-barangays` (body `{ "barangayIds": ["..."] }`, response `{ "counts": { "id": n } }`); View from `GET /api/facilities/by-barangay/:barangayId`. IDs must match GeoJSON (e.g. `adm4_psgc`).
- **Base URL:** Local `http://localhost:3000`; production = your backend URL.

---

## All Barangays table – backend contract

Table columns: Barangay, Temperature, Risk Level, Nearby Facilities (count), View. Data: GeoJSON for names (IDs match backend); `GET /api/heat/davao/barangays` for `barangays[]`; `POST /api/facilities/counts-by-barangays` for counts; `GET /api/facilities/by-barangay/:barangayId` for View. Both count and View use same backend logic (`skipOrs: true`); backend returns `total_label` (e.g. "1 facility", "3 facilities").

---

## Troubleshooting – dashboard and frontend

- **OpenRoute 429:** Batch counts use straight-line only (`skipOrs: true`); no ORS for "Nearby Facilities" column. Single-barangay View cached 5 min. If ORS fails, backend falls back to straight-line. If 429 still appears, it’s from many single-barangay requests; rely on cache or reduce calls.
- **“backend provided min/max: no”:** Backend sends top-level `min` and `max` on `GET /api/heat/davao/barangays` (same as `meta.temperature_min_c`/`temperature_max_c`). Frontend should use `response.min` and `response.max` for legend.
- **React duplicate key (e.g. "26"):** Use a unique key per list item (e.g. `${barangay_id}` or `${risk_level}-${risk_label}-${index}`), not only `risk_level`.
- **Count vs View mismatch:** Backend fixed: both `POST /api/facilities/counts-by-barangays` and `GET /api/facilities/by-barangay/:id` use `skipOrs: true`; count = length of list. Prefer `response.total_label` for "1 facility" / "N facilities".

---

## 1. Heat Advisory AI (Gemini)

**Backend:** Implemented.  
**Frontend:** Wire Heat Advisory page (UrgencyTicker / Safety Recommendations) to the API; replace static copy with API response.

### Endpoints

| Method | Path | Use |
|--------|------|-----|
| POST | `/api/heat-advisory` | Preferred: JSON body. |
| GET | `/api/heat-advisory` | Same via query params. |

### Request (all optional)

- `barangay_id` (string), `barangay_name` (string), `risk_level` (number 1–5), `risk_label` (string), `temperature_c` (number).

Example POST body:

```json
{
  "barangay_id": "1130700001",
  "barangay_name": "Calinan",
  "risk_level": 2,
  "risk_label": "Caution",
  "temperature_c": 28.5
}
```

### Response (200)

- **Required for UI:** `tagline` (string), `advices` (array of `{ title, body }`).
- Optional: `risk_level`, `barangay_name`, `generated_at`.

### Backend implementation details (for alignment)

- **Request:** POST: `Content-Type: application/json`, body may omit any field. GET: same fields as query params (`barangay_id`, `barangay_name`, `risk_level`, `risk_label`, `temperature_c`). All optional; backend defaults missing risk to level 2 / "Caution". Backend normalizes: if only `risk_level` sent, derives `risk_label`; if only `risk_label` sent, derives `risk_level` (PAGASA 1–5).
- **Response (200):** JSON. Always includes `tagline` (string) and `advices` (array of `{ title: string, body: string }`, at least 3 items). May include `risk_level`, `barangay_name`, `generated_at` (ISO 8601).
- **Error (4xx/5xx):** JSON body `{ "error": string, "details"?: string }`. Frontend should not rely on any other shape.
- **Caching:** Backend caches by `(barangay_id || "default", risk_level)` for 5 minutes. Same request within TTL returns same payload; no cache headers in response.

### Frontend checklist

- [ ] Call `POST /api/heat-advisory` (or GET with query) with selected zone / risk from map or risk selector.
- [ ] Render `response.tagline` as the main tagline and `response.advices` (title + body) in UrgencyTicker.
- [ ] On 4xx/5xx: show fallback (e.g. static advisories by risk level) or error message.
- [ ] Backend caches per (barangay_id, risk_level) for 5 minutes; no special frontend handling.

**Full contract:** See **Heat Advisory AI – full contract** in this document above.

---

## 2. Export CSV – KPI strip

**Backend:** Implemented.  
**Frontend:** Replace loading/simulated download with real API call and file download.

### Endpoint

- **GET** `/api/heat/export/city?date=YYYY-MM-DD&city_id=davao`
- Query: `date` (optional, default today UTC), `city_id` (optional, default `davao`).

### Response

- CSV file; `Content-Disposition: attachment; filename="heat_risk_city_avg_YYYY-MM-DD.csv"`.
- Columns: `city_id`, `recorded_at`, `risk_level`, `risk_label`, `total`, `avg_temp_c`.

### Frontend checklist

- [ ] On “Download CSV” in KPI strip: build URL with user-selected date (and `city_id` if needed).
- [ ] Trigger download (e.g. `window.location` to URL, or `fetch` + blob + temporary `<a download>`).
- [ ] On 4xx/5xx: show error or fallback message.

**Full contract:** See **Export CSV – full contract** in this document above.

---

## 3. Export CSV – Historical Trends

**Backend:** Implemented.  
**Frontend:** Replace loading/simulated download with real API call and file download.

### Endpoint

- **GET** `/api/historical-trends/export?city_id=davao&days=7|14&date=YYYY-MM-DD`
- Query: `city_id`, `days` (7 or 14), `date` (optional, for filename only).

### Response

- CSV file; `Content-Disposition: attachment; filename="historical_trends_YYYY-MM-DD.csv"`.
- Columns: `recorded_at`, `city_id`, `city_avg_temp_c`, `city_max_temp_c`, `city_min_temp_c`, `rolling_7d_avg_c`, `rolling_14d_avg_c`.

### Frontend checklist

- [ ] On “Download CSV” in Historical Trends: build URL with same `city_id`, `days` (and optional `date`) as current view.
- [ ] Trigger download (same pattern as KPI Export CSV).
- [ ] On 4xx/5xx: show error or fallback.

**Full contract:** See **Export CSV – full contract** in this document above.

---

## 4. Route visualization (Show Route – OpenRouteService)

**Backend:** Implemented. Backend proxies OpenRouteService Directions API; frontend must call the backend, not ORS directly.

### Endpoint

- **POST** `/api/ors/directions`
- Body: `{ start: [lng, lat] | { lng, lat }, end: [lng, lat] | { lng, lat }, profile?: "driving-car" | "foot-walking" | "cycling-regular" }`.
- Default `profile`: `driving-car`.

### Response (200)

- ORS Directions GeoJSON: `type: "FeatureCollection"`, `features[0].geometry.coordinates` (LineString for polyline), `features[0].properties.summary` with `distance` (metres) and `duration` (seconds).

### Frontend checklist

- [ ] “Show Route” on facility card: call `POST /api/ors/directions` with barangay center as `start`, facility coords as `end`, and selected `profile`.
- [ ] **ZoneInfoPanel distance:** Prefer route distance and time from the directions response. If the directions call fails, show straight-line only using `facility.distance_meters` from the facility list (e.g. "~X.X km"); do not show both distances at once.
- [ ] Profile dropdown: `foot-walking`, `driving-car`, `cycling-regular`.
- [ ] Draw route: Leaflet polyline from `features[0].geometry.coordinates`, color **#FF9559**, **4px** thickness.
- [ ] Add start marker (e.g. 📍) and end marker (e.g. 🏥).
- [ ] In facility card: show distance (km) and travel time (min) from `summary` (convert from m/s).
- [ ] Fit map bounds to show full route (and markers).
- [ ] When route is active for a facility: highlight that card (e.g. left border).
- [ ] Clear previous route and highlight when user clicks “Show Route” on another facility or when selection (e.g. barangay) changes.
- [ ] On 400/502/503: show error message.

**Full contract:** See **Show Route (ORS Directions) – full contract** in this document above.

---

## 5. Data sync (when Supabase tables get updated)

**Backend:** No new endpoints. Clarification only.

- **Historical trends:** Supabase `historical_trends` is updated when the **API** is called: `POST /api/historical-trends/sync` or `GET /api/historical-trends?sync=1`. Frontend can trigger sync via these if needed.
- **Heat risk counts & city temperatures:** Supabase `heat_risk_counts` and `city_temperatures` are updated by the **heat risk job** (`npm run heat-risk-job` or scheduler), not by the dashboard simply loading data. Normal GETs for heat/summary may return live-computed data or cached DB data; the DB is only written by the job or explicit POST endpoints.

So: sync is implemented but has different trigger methods (API for historical trends, job for heat/city temps).

---

## Supabase (for frontend)

**The frontend does not connect to Supabase.** All data goes through the backend API. The backend uses Supabase (Postgres) as its database. You do not need Supabase URL or keys on the frontend.

**What the backend stores in Supabase (and what you see via API):**

| Backend uses | Table (concept) | When it’s written | What the frontend sees |
|--------------|------------------|-------------------|--------------------------|
| KPI strip, heat map, Export CSV (city) | `heat_risk_counts` (per-barangay risk for a date), `city_temperatures` (city avg temp per date) | **Heat risk job** (`npm run heat-risk-job` or scheduler). Not written when the dashboard just loads. | `GET /api/heat/counts`, `GET /api/heat/summary`, `GET /api/heat/davao/barangays` may read from these tables when data exists for today; otherwise backend may return live-computed data. Export CSV for a date uses only DB: if the job never ran for that date, CSV can be empty or sparse. |
| Historical trends, Export CSV (trends) | `historical_trends` (city temp per day, 7d/14d rolling) | **Sync API:** `POST /api/historical-trends/sync` or `GET /api/historical-trends?sync=1`. Frontend or a cron can call this. | `GET /api/historical-trends` and `GET /api/historical-trends/export` read from this table. If sync never ran, rows can be empty; frontend can call sync (e.g. button or on first load) if you want. |
| Facility directory, All Barangays counts/View | Health facilities table (e.g. `health_facilities_davao`) | **Seeded** (e.g. `npm run seed:facilities`) or admin. Not written by the dashboard. | `GET /api/facilities/by-barangay/:id`, `POST /api/facilities/counts-by-barangays` read from here. |

**Implications for the frontend:**

- **KPI / heat map / barangays:** If the heat risk job has not run today, the backend may still return data by computing it live (weather API + risk model). So the UI can work even with no rows in `heat_risk_counts` for today. If you want “stored” data only, that depends on the job running (backend/scheduler).
- **Export CSV (KPI strip):** Reads only from DB for the requested date. If the job did not run for that date, the CSV may have no rows or only partial data. Frontend can show a message like “No data for this date” when the response is empty or when the backend returns a JSON error.
- **Historical trends:** Data appears after sync. Frontend can trigger sync via `POST /api/historical-trends/sync` or `GET /api/historical-trends?sync=1` (e.g. “Refresh” button). If sync is not called, `GET /api/historical-trends` may return empty rows or 503 until data exists.
- **Facilities:** Read-only from the frontend’s perspective; no “sync” from the app. List and counts come from whatever is seeded in Supabase.

**Summary:** No Supabase config or direct access is required on the frontend. Use the backend APIs as described in this doc; the backend handles Supabase. Be aware that some endpoints (KPI export, historical trends) depend on data being written by the job or by the historical-trends sync.

---

## 6. Barangay geo / network resilience (backend only)

**Backend:** Implemented. No frontend change.

- `getDavaoBarangayGeo()` now uses a 30s timeout and up to 3 retries (2s delay) on connection errors (e.g. ECONNRESET, “terminated”, “fetch failed”). Helps on slow or unstable networks. Frontend does not need to do anything.

---

## Backend implementation details (for alignment)

Use these so the frontend matches backend behavior exactly (request/response shapes, errors, defaults).

**1. Heat Advisory (`POST/GET /api/heat-advisory`)**  
- Request: POST body or GET query; all fields optional. Backend defaults missing risk to level 2 / "Caution". Normalizes: only `risk_level` → derives `risk_label`; only `risk_label` → derives `risk_level` (PAGASA 1–5).  
- Response (200): JSON with `tagline` (string), `advices` (array of `{ title, body }`, ≥3 items). May include `risk_level`, `barangay_name`, `generated_at` (ISO 8601).  
- Error (4xx/5xx): JSON `{ "error": string, "details"?: string }`.  
- Caching: Backend caches by `(barangay_id || "default", risk_level)` for 5 minutes.

**2. Export CSV – KPI strip (`GET /api/heat/export/city`)**  
- Request: GET only. Query `date` (YYYY-MM-DD, optional; default today UTC), `city_id` (optional; default `"davao"`).  
- Response (200): `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="heat_risk_city_avg_YYYY-MM-DD.csv"`. First line = header; then one row per risk level.  
- Error (4xx/5xx): JSON `{ "error": string, "details"?: string }` (not CSV).

**3. Export CSV – Historical Trends (`GET /api/historical-trends/export`)**  
- Request: GET only. Query `city_id` (optional; default `"davao"`), `days` (7 or 14, optional; else backend uses `limit` default 14), `limit` (1–90, optional), `date` (YYYY-MM-DD, optional; filename only; default today).  
- Response (200): `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="historical_trends_YYYY-MM-DD.csv"`. First line = header; rows = one per day (most recent first).  
- Error (4xx/5xx): JSON `{ "error": string, "details"?: string }` (not CSV).

**4. Directions / Show Route (`POST /api/ors/directions`)**  
- Request: POST only. Body: `start`, `end` required (each `[lng, lat]` or `{ lng, lat }` or `{ lon, lat }`); `profile` optional (`"driving-car"` | `"foot-walking"` | `"cycling-regular"`, default `"driving-car"`). Backend validates lat −90..90, lng −180..180.  
- Response (200): JSON = ORS GeoJSON. `type: "FeatureCollection"`, `features[0].geometry.coordinates` (LineString), `features[0].properties.summary`: `{ distance` (metres), `duration` (seconds) `}`.  
- Error (400): JSON `{ "error": "Invalid coordinates", "details": "start and end are required; each must be [lng, lat] or { lng, lat }" }`.  
- Error (502): JSON `{ "error": string, "details"?: any }`.  
- Error (503): JSON `{ "error": "OpenRoute not configured", "details": "..." }` when `OPEN_ROUTE_API_KEY` is missing.

---

## Quick reference – all new/updated endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/heat-advisory` | Heat Advisory AI: tagline + advices (Gemini or fallback). |
| GET | `/api/heat-advisory` | Same as POST via query params. |
| GET | `/api/heat/export/city` | KPI Export CSV (date, city_id). |
| GET | `/api/historical-trends/export` | Historical Trends Export CSV (city_id, days, date). |
| POST | `/api/ors/directions` | Show Route: directions GeoJSON (start, end, profile). |

---

## Environment (backend)

- **Heat Advisory:** `GEMINI_API_KEY` (optional; fallback used if missing).
- **Export CSV:** No extra env (uses existing Supabase + heat/summary data).
- **Route visualization:** `OPEN_ROUTE_API_KEY` (same as batch travel times).

---

## Contents of this document

- All implemented changes (list)
- Dashboard overview (which API per section) + **Dashboard UI layout (top-to-bottom order)**
- Dashboard & heat map – backend implementation details (full request/response/errors)
- Heat Advisory AI – full contract
- Export CSV – full contract (KPI + Historical Trends)
- Show Route (ORS Directions) – full contract
- Dashboard API contract – full
- All Barangays table – backend contract
- Troubleshooting – dashboard and frontend
- Sections 1–6: Heat Advisory, Export CSV x2, Route, Data sync, **Supabase (for frontend)**, Barangay geo (summaries + checklists)
- Backend implementation details (for alignment) – Heat Advisory, Export CSV, Directions
- Quick reference – endpoints table
- Environment (backend)
- **Frontend changes alignment confirmation** (below)

---

## Frontend changes alignment confirmation

Analysis of the frontend changes you listed. **Verdict: aligned** with the backend. A few optional refinements are noted.

**1. Heat service (fetchHeatCounts, fetchHeatSummary, fetchHistoricalTrends, fetchBarangayTemperatures)**  
- **Aligned.** `GET /api/heat/counts` returns array of `{ risk_level, risk_label, total }`. `GET /api/heat/summary?city_id=davao` returns `risk_counts` and `city_avg_temp_c` (and `recorded_at`, `city_avg_temp`). `GET /api/historical-trends?city_id=davao&days=7|14` returns past data (rows, trend_7d_avg_c, trend_14d_avg_c, summary). Barangay temps: `GET /api/heat/davao/barangays` returns `barangays`, `min`, `max`, `meta`; use `response.min` / `response.max` for legend when present (see Troubleshooting above).

**2. Dashboard (KPI, city avg temp, barangay rows, Historical Trends chart, Export CSV)**  
- **Aligned.** Using `heatSummary.risk_counts` and `heatSummary.city_avg_temp_c` when available matches backend. Barangay rows using backend `temp_c`, `risk_level`, `risk_label` and GeoJSON for names and facility counts is correct. Historical Trends from `fetchHistoricalTrends` (not forecast) is correct. Export CSV: KPI strip → `GET /api/heat/export/city?date=...&city_id=davao`, filename `heat_risk_city_avg_YYYY-MM-DD.csv`; Historical → `GET /api/historical-trends/export?city_id=davao&days=...&date=...`, filename `historical_trends_YYYY-MM-DD.csv`. Button change from "barangays" to "city" for KPI export is consistent with the endpoint.

**3. Route visualization (Show Route – ORS)**  
- **Aligned.** `fetchDirections(start, end, profile)` calling `POST /api/ors/directions` with `start`, `end` ([lng, lat] or { lng, lat }), `profile` (driving-car | foot-walking | cycling-regular) matches backend. Drawing polyline from `features[0].geometry.coordinates`, color #FF9559, weight 4, start/end markers (📍/🏥), fit bounds, tooltip with distance/duration matches. Fallback to straight line when no ORS result is fine. Clearing route when zone or facility changes matches. ZoneInfoCard: profile dropdown (Walking/Driving/Cycling), “Show Route” per facility, distance (km) and time (min) from route summary, left-border highlight #FF9559 when route active – all aligned.

**4. Docs (Export CSV)**  
- **Aligned.** The Export CSV behaviour you described (KPI and Historical endpoints, filenames, column list) matches this document and the backend.

**5. Heat Advisory**  
- **Aligned.** Using `POST /api/heat-advisory` via heatAdvisoryService with the contract above (tagline + advices, optional body fields) is correct. No change needed.

**6. Facilities `total_label`, ZoneInfoCard, Dashboard badge & View (latest frontend summary)**  
- **Aligned.** Backend `GET /api/facilities/by-barangay/:barangayId` returns `total_label` (e.g. `"5 facilities"`), and when no facilities are in the barangay it returns `fallback_nearest: true` and `message` ("No facilities in this barangay; showing nearest with distance_meters.").  
- **HealthFacilitiesService:** Returning `total_label`, `message`, and using backend `fallback_nearest` when present matches the API.  
- **Heat map → ZoneInfoCard:** Zone data including `facilitiesTotalLabel: result.total_label` and passing `facilitiesTotalLabel={selectedZone.facilitiesTotalLabel}` to ZoneInfoCard is correct.  
- **ZoneInfoCard:** Prop `facilitiesTotalLabel`; label e.g. "Health Facilities in the Area (5 facilities)" when set matches backend `total_label`.  
- **Dashboard:** `nearbyTotalLabel` from `selectedZone.facilitiesTotalLabel` when using zone data, or from `res.total_label` when calling the API; "Nearby Health Facilities" badge showing e.g. "5 facilities"; Facilities panel (View) storing `totalLabel: res.total_label` and showing "Facilities in {barangay} (5 facilities)" when `totalLabel` exists — all aligned with backend response shape.  
- **Frontend reference doc:** A single reference doc on the frontend repo (e.g. `docs/FRONTEND_BACKEND_INTEGRATION_REFERENCE.md`) that mirrors this document (implemented changes, dashboard → API mapping, request/response/error details, Heat Advisory, Export CSV, Show Route, All Barangays, troubleshooting, data sync, Supabase note, backend implementation details, endpoint quick reference) is fine. This backend doc remains the canonical source; frontend can keep their copy in sync when contracts change.

**Optional backend alignment details:**  
- For `GET /api/heat/davao/barangays`, prefer `response.min` and `response.max` for the temperature legend when present (backend sends them at top level).  
- Errors from any endpoint are JSON `{ "error": string, "details"?: string }`; frontend can handle generically.

**Summary:** All described frontend changes (including total_label, facilitiesTotalLabel, nearbyTotalLabel, ZoneInfoCard label, Dashboard badge and View text, and the frontend reference doc) are aligned with the backend. No corrections required.
