# Frontend Dashboard API Contract

This document tells the **frontend** which backend APIs to use for each section of the dashboard. The backend is aligned with these choices.

---

## 1. KPI Strip – Heat risk zone counts

**Purpose:** Show counts per heat risk level (e.g. Not Hazardous, Caution, Extreme Caution, Danger, Extreme Danger). Data must come from **heat_risk_counts** (today’s aggregated counts), not from the full barangay list.

**Use this API:**

- **`GET /api/heat/counts`**  
  - Optional: `?city_id=davao` (if the backend adds city scoping later; currently counts are for the whole table for today.)

**Response shape:**

```json
[
  { "risk_level": 1, "risk_label": "Not Hazardous", "total": 85 },
  { "risk_level": 2, "risk_label": "Caution", "total": 42 },
  { "risk_level": 3, "risk_label": "Extreme Caution", "total": 55 },
  ...
]
```

**Alternative (if you also need today’s city average temp):**

- **`GET /api/heat/summary?city_id=davao`**  
  - Returns `risk_counts` (same structure as above) plus `city_avg_temp_c`, `recorded_at`, `city_avg_temp`.

**Do not use:**  
- Do not derive KPI counts from `GET /api/heat/:cityId/barangays` (that’s for the map). Use the dedicated counts/summary API above.

---

## 2. Health facility directory (Row 3) – Chosen place only

**Purpose:** Show health facilities **only for the selected barangay/place**. Do not show all facilities for all barangays.

**Use this API:**

- **`GET /api/facilities/by-barangay/:barangayId`**
  - `barangayId` = the **chosen place** (e.g. PSGC code from the map, e.g. `1130700001`).

**Example:**

```http
GET /api/facilities/by-barangay/1130700001
```

**Response shape:**

```json
{
  "barangayId": "1130700001",
  "total": 5,
  "facilities": [
    {
      "id": "...",
      "name": "...",
      "latitude": 7.19,
      "longitude": 125.60,
      "distance_meters": 1200,
      "travel_time_seconds": 180,
      ...
    }
  ],
  "fallback_nearest": false
}
```

- If there are no facilities in that barangay, the backend returns the **nearest** facilities with `fallback_nearest: true` and `distance_meters` so the user still sees options.

**Do not use:**  
- Do **not** use `GET /api/facilities` (no query) for this row. That returns **all** facilities; the directory row must be scoped to the **chosen place** via `by-barangay/:barangayId`.

---

## 3. Historical trends (Row 4) – Past data only

**Purpose:** Show **past** temperature trends and 7‑day / 14‑day rolling averages. Data must come from the **historical trends** API (WeatherAPI history → `historical_trends` table), **not** from the forecast API.

**Use this API:**

- **`GET /api/historical-trends?city_id=davao&days=7`** for the last 7 days.  
- **`GET /api/historical-trends?city_id=davao&days=14`** for the last 14 days.

**Examples:**

```http
GET /api/historical-trends?city_id=davao&days=7
GET /api/historical-trends?city_id=davao&days=14
```

**Response shape (relevant fields):**

```json
{
  "city_id": "davao",
  "rows": [
    {
      "recorded_at": "2026-02-26",
      "city_avg_temp_c": 27.5,
      "city_max_temp_c": 31,
      "city_min_temp_c": 24,
      "rolling_7d_avg_c": 27.2,
      "rolling_14d_avg_c": 27.1
    }
  ],
  "trend_7d_avg_c": 27.2,
  "trend_14d_avg_c": 27.1,
  "summary": {
    "avg_c": 27.2,
    "max_c": 31,
    "min_c": 24,
    "rolling_7d_avg_c": 27.2,
    "rolling_14d_avg_c": 27.1
  }
}
```

**Do not use:**  
- Do **not** use `GET /api/heat/davao/forecast?days=7` or `?days=14` for this section. That endpoint returns the **future forecast**, not historical trends. Use **`/api/historical-trends`** only for the historical trends row.

---

## 4. All Barangays table – Heat risk overview

**Purpose:** Table “ALL BARANGAYS — HEAT RISK OVERVIEW” with columns: Barangay, Temperature, Risk Level, Nearby Facilities (count), View (opens facility list). Search and “View All” / “Show Less” are client-side.

**Data sources:**

| What you need | API | Request / response |
|---------------|-----|---------------------|
| Barangay list and names | GeoJSON (frontend, e.g. `fetchDavaoBoundaries()`) | IDs must match backend (e.g. `adm4_psgc`). |
| Temperature and risk per row | `GET /api/heat/davao/barangays` | `barangays[]` with `barangay_id`, `temperature_c`, `risk_level`, `risk_label`. Use same IDs as GeoJSON. |
| Nearby Facilities count per row | `POST /api/facilities/counts-by-barangays` | Body: `{ "barangayIds": ["1130700001", ...] }`. Response: `{ "counts": { "1130700001": 3, ... } }`. |
| View button (facility list for one barangay) | `GET /api/facilities/by-barangay/:barangayId` | Same as Heat Map: `{ barangayId, total, facilities[], fallback_nearest? }`. |

**Example – batch counts:**

```http
POST /api/facilities/counts-by-barangays
Content-Type: application/json

{ "barangayIds": ["1130700001", "1130700002", "1130700003"] }
```

```json
{ "counts": { "1130700001": 3, "1130700002": 0, "1130700003": 5 } }
```

**Full contract:** See **[UI_LAYOUT_AND_BACKEND_INTEGRATION.md](UI_LAYOUT_AND_BACKEND_INTEGRATION.md)** §3.2.1 (All Barangays table – backend contract).

---

## Summary table for frontend

| Section              | API to use                                      | Do not use |
|----------------------|--------------------------------------------------|------------|
| KPI Strip            | `GET /api/heat/counts` or `GET /api/heat/summary` | Counts from `/api/heat/davao/barangays` |
| Health facility dir  | `GET /api/facilities/by-barangay/:barangayId`     | `GET /api/facilities` (all facilities) |
| Historical trends    | `GET /api/historical-trends?city_id=davao&days=7` or `&days=14` | `GET /api/heat/davao/forecast` (forecast = future) |
| All Barangays table  | `GET /api/heat/davao/barangays` (rows); `POST /api/facilities/counts-by-barangays` (counts); `GET /api/facilities/by-barangay/:id` (View) | — |

---

## Base URL

- Local: `http://localhost:3000`  
- Production: your backend base URL (e.g. `https://api.example.com`).

All paths above are relative to that base (e.g. `GET /api/heat/counts` → `GET http://localhost:3000/api/heat/counts`).
