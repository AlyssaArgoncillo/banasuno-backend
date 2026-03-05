# API Fetched Data – Organized Summary

This document organizes the structure and usage of data returned by the main BanasUno API endpoints (as in the terminal curl examples).

**Frontend dashboard:** For which API to use for the **KPI strip**, **health facility directory (chosen place only)**, **historical trends (not forecast)**, and **All Barangays table**, see **[FRONTEND-DASHBOARD-API.md](FRONTEND-DASHBOARD-API.md)**. Full UI/backend contract for the All Barangays table: **[UI_LAYOUT_AND_BACKEND_INTEGRATION.md](UI_LAYOUT_AND_BACKEND_INTEGRATION.md)** §3.2.1.

---

## 1. Facilities (`GET /api/facilities`)

**Purpose:** List health facilities (hospitals, clinics, pharmacies, etc.) for Davao City.

| Field | Description |
|-------|--------------|
| `total` | Total number of facilities (e.g. 168) |
| `offset` | Pagination offset (default 0) |
| `limit` | Page size (default 100) |
| `facilities` | Array of facility objects |

**Per-facility fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | OSM or internal ID |
| `name` | string | Facility name |
| `city` | string | e.g. "Davao City" |
| `barangay` | string | Barangay name (may be empty) |
| `district` | string | District (may be empty) |
| `facility_type` | string | `hospital`, `clinic`, `pharmacy`, `doctors`, `health_center` |
| `address` | string | Full address |
| `address_street`, `address_postcode`, `address_house_number` | string | Parsed address parts |
| `address_other` | object | `addr_city`, `addr_postc`, `addr_street`, etc. |
| `latitude`, `longitude` | number | Coordinates |
| `phone`, `url` | string | Contact info |
| `beds` | string | Bed count (if known) |
| `emergency` | string | e.g. "yes", "no" |
| `ownership` | string | e.g. "private", "public", "government" |
| `operator` | string | Operator name |
| `opening_hours` | string | e.g. "24/7", "Mo-Su 08:00-21:00" |
| `source` | string | e.g. "way", "node" |

**Query params:** `type`, `source`, `ownership`, `name`, `limit`, `offset`

---

## 2. Facility Types (`GET /api/types`)

**Purpose:** Count of facilities by type.

| Field | Description |
|-------|-------------|
| `total` | Total facilities (e.g. 168) |
| `by_type` | Array of `{ type, count }` |

**Example:**

| type | count |
|------|-------|
| clinic | 58 |
| pharmacy | 52 |
| hospital | 27 |
| doctors | 21 |
| health_center | 10 |

---

## 3. Heat – Barangays (`GET /api/heat/:cityId/barangays`)

**Purpose:** Per-barangay temperature, risk level, and risk label; IDs match GeoJSON PSGC codes. Prefers Supabase when today's data exists; otherwise live WeatherAPI/Open-Meteo.

| Field | Description |
|-------|-------------|
| `barangays` | Array of barangay heat objects |
| `updatedAt` | ISO timestamp of data |
| `meta` | Metadata including `temperature_min_c`, `temperature_max_c` for legend |

**Per-barangay fields (frontend-ready):**

| Field | Type | Description |
|-------|------|-------------|
| `barangay_id` | string | PSGC code (matches GeoJSON) |
| `temp_c` | number | Temperature °C |
| `temperature_c` | number | Same as temp_c (frontend alias) |
| `risk_level` | number | 1–5 (PAGASA level) |
| `risk_label` | string | e.g. "Not Hazardous", "Caution", "Extreme Caution" |
| `risk` | object | `score`, `level`, `label`, `heat_index_c` |
| `lat`, `lng` | number | Centroid coordinates |
| `area_km2` | number | Barangay area (km²) |

**Meta:** `meta.temperature_min_c`, `meta.temperature_max_c` for the temperature legend; `meta.dataSource` is `"supabase"` or `"live"`.

**Risk levels (from meta.legend):**

| level | label | range |
|-------|--------|--------|
| 1 | Not Hazardous | < 27°C |
| 2 | Caution | 27–32°C |
| 3 | Extreme Caution | 33–41°C |
| 4 | Danger | 42–51°C |
| 5 | Extreme Danger | ≥ 52°C |

**Query params:** `?limit=` (optional)

---

## 4. Heat – Forecast (`GET /api/heat/:cityId/forecast`)

**Purpose:** 7- or 14-day weather forecast for the city.

| Field | Description |
|-------|-------------|
| `cityId` | City identifier (e.g. "davao") |
| `days` | Requested days (e.g. 7) |
| `forecastDayCount` | Number of days returned |
| `location` | `{ name, region, country, lat, lon, tz_id }` |
| `forecastDay` | Array of daily forecast objects |
| `updatedAt` | ISO timestamp |

**Per-day fields:**

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | YYYY-MM-DD |
| `date_epoch` | number | Unix timestamp |
| `mintemp_c`, `maxtemp_c`, `avgtemp_c` | number | Temperatures °C |
| `condition` | string | e.g. "Moderate rain" |
| `daily_chance_of_rain` | number | 0–100 |
| `totalprecip_mm` | number | Precipitation mm |

**Query params:** `?days=7` or `?days=14`

---

## 5. Historical Trends Sync (`POST /api/historical-trends/sync`)

**Purpose:** Sync city historical temperature trends from WeatherAPI and run 30-day cleanup.

**Request body:** `{ "city_id": "davao", "days": 14 }` (optional; `days` defaults to 30)

**Response:**

| Field | Description |
|-------|-------------|
| `ok` | boolean |
| `city_id` | string |
| `inserted` | number of rows inserted/updated |
| `cleanup.deleted` | rows deleted (older than 30 days) |

---

## Quick reference – curl examples

```bash
# Facilities (paginated)
curl "http://localhost:3000/api/facilities?limit=10"

# Facility type counts
curl "http://localhost:3000/api/types"

# Barangay heat data for Davao
curl "http://localhost:3000/api/heat/davao/barangays"

# 7-day forecast
curl "http://localhost:3000/api/heat/davao/forecast?days=7"

# Sync historical trends (POST)
curl -X POST "http://localhost:3000/api/historical-trends/sync" \
  -H "Content-Type: application/json" \
  -d '{"city_id":"davao","days":14}'
```

---

## Historical trends (7 or 14 days) — use this, not forecast

**Historical trends** = past temperature data (from WeatherAPI history → `historical_trends` table).  
**Forecast** = future weather (from WeatherAPI forecast). Do not use the forecast endpoint when you need historical trends.

**API for historical trends (7-day or 14-day):**

| What you want | Request |
|---------------|---------|
| Last **7 days** of historical data + 7d/14d rolling averages | `GET /api/historical-trends?city_id=davao&days=7` or `&limit=7` |
| Last **14 days** of historical data + 7d/14d rolling averages | `GET /api/historical-trends?city_id=davao&days=14` or `&limit=14` |
| Refresh from WeatherAPI then get trends | `GET /api/historical-trends?city_id=davao&days=14&sync=1` |

Query params: **`city_id`** (default `davao`), **`days`** (optional: `7` or `14` — number of days of history), **`limit`** (optional: 1–90, ignored if `days` is 7 or 14), **`sync`** (optional: `1` to fetch from WeatherAPI and upsert before returning).

**Example:**

```bash
# Historical trends – 7 days (past data, 7d and 14d rolling averages)
curl "http://localhost:3000/api/historical-trends?city_id=davao&days=7"

# Historical trends – 14 days
curl "http://localhost:3000/api/historical-trends?city_id=davao&days=14"
```

**Response:** `city_id`, `rows` (each with `recorded_at`, `city_avg_temp_c`, `city_max_temp_c`, `city_min_temp_c`, `rolling_7d_avg_c`, `rolling_14d_avg_c`), `trend_7d_avg_c`, `trend_14d_avg_c`, `summary`.

**Do not use for historical:** `GET /api/heat/davao/forecast?days=7` — that returns **future** forecast, not past trends.

---

## Heat summary

**GET /api/heat/summary** – Today's city average and aggregated risk counts (from Supabase `city_temperatures` + `heat_risk_counts`). Response: `city_id`, `city_avg_temp_c`, `recorded_at`, `risk_counts`, `city_avg_temp`.

**GET /api/facilities/by-barangay/:id** – Facilities for that barangay; if none, returns nearest facilities with `distance_meters` and `fallback_nearest: true`.

---

## Summary table

| Endpoint | Method | Returns |
|----------|--------|--------|
| `/api/facilities` | GET | Paginated facilities list |
| `/api/facilities/by-barangay/:id` | GET | Facilities for barangay, or nearest with distance |
| `/api/types` | GET | Facility counts by type |
| `/api/heat/:cityId/barangays` | GET | Barangay temp + risk + geo; min/max for legend |
| `/api/heat/summary` | GET | Today's city average + risk counts |
| `/api/heat/:cityId/forecast` | GET | 7/14-day forecast |
| `/api/historical-trends` | GET | City historical avg/max/min + 7d/14d rolling |
| `/api/historical-trends/sync` | POST | Sync result (inserted, cleanup) |
