# Backend API – sample JSON responses

Sample response bodies for the main backend endpoints. Base URL: `http://localhost:3000` (or your deployed backend). All heat endpoints that need weather require **WEATHER_API_KEY** in `.env`.

---

## Health and index

### GET /health

```json
{
  "status": "ok",
  "database": "connected"
}
```

(`database` can be `"connected"`, `"not_configured"`, or `"error"`.)

### GET /api

```json
{
  "name": "BanasUno Backend",
  "version": "1.0",
  "endpoints": {
    "GET /api/facilities": "List Davao health facilities (query: type, source, ownership, name, limit, offset)",
    "GET /api/facilities/:id": "Get one facility by id",
    "GET /api/facilities/by-barangay/:barangayId": "Facilities assigned to barangay by nearest barangay lat/lon only",
    "POST /api/facilities/counts-by-barangays": "Batch facility counts for many barangay IDs (body: { barangayIds: [] }, for pipeline)",
    "GET /api/types": "Facility type summary",
    "GET /api/heat/:cityId/barangays": "Per-barangay temp + risk + lat/lng + area. Optional ?limit=.",
    "GET /api/heat/:cityId/current": "City center current weather (temp, feels-like).",
    "GET /api/heat/:cityId/forecast": "7- or 14-day forecast (?days=7|14).",
    "GET /api/heat/:cityId/barangay-population": "Population and density per barangay (pipeline).",
    "GET /api/heat/:cityId/pipeline-report/meta": "Pipeline report meta (available, updatedAt).",
    "GET /api/heat/:cityId/pipeline-report": "Download latest pipeline report CSV; 404 if none.",
    "POST /api/heat/:cityId/pipeline-report/generate": "Generate pipeline report on demand.",
    "POST /api/heat/:cityId/pipeline-report": "Upload pipeline report CSV (body: text/csv)."
  }
}
```

---

## Facilities

### GET /api/facilities?limit=2

```json
{
  "total": 450,
  "offset": 0,
  "limit": 2,
  "facilities": [
    {
      "id": 1068744746,
      "name": "Example Health Center",
      "facility_type": "Health Center",
      "lat": 7.123,
      "lng": 125.456,
      "barangay_id": "1130700001",
      "source": "healthsites",
      "ownership": "public"
    },
    {}
  ]
}
```

### GET /api/facilities/by-barangay/1130700001

```json
{
  "barangayId": "1130700001",
  "total": 3,
  "facilities": [
    {
      "id": 1068744746,
      "name": "Example Health Center",
      "facility_type": "Health Center",
      "lat": 7.123,
      "lng": 125.456,
      "barangay_id": "1130700001"
    }
  ]
}
```

### GET /api/facilities/1068744746

```json
{
  "id": 1068744746,
  "name": "Example Health Center",
  "facility_type": "Health Center",
  "lat": 7.123,
  "lng": 125.456,
  "barangay_id": "1130700001",
  "source": "healthsites",
  "ownership": "public"
}
```

### POST /api/facilities/counts-by-barangays

**Request body:**

```json
{
  "barangayIds": ["1130700001", "1130700002", "1130700003"]
}
```

**Response (200):**

```json
{
  "counts": {
    "1130700001": 3,
    "1130700002": 0,
    "1130700003": 5
  }
}
```

### GET /api/types

```json
{
  "total": 450,
  "by_type": [
    { "type": "Health Center", "count": 120 },
    { "type": "Hospital", "count": 45 }
  ]
}
```

---

## Heat API

### GET /api/heat/davao/barangays

Per-barangay temp + risk + lat/lng + area. Optional: `?limit=5`.

```json
{
  "barangays": [
    {
      "barangay_id": "1130700001",
      "temp_c": 26.3,
      "risk": {
        "score": 0,
        "level": 1,
        "label": "Not Hazardous"
      },
      "lat": 7.12,
      "lng": 125.61,
      "area_km2": 2.5
    }
  ],
  "updatedAt": "2026-02-20T12:00:00.000Z",
  "meta": {
    "cityId": "davao",
    "count": 1,
    "usedHeatIndex": false,
    "temperaturesSource": "weatherapi",
    "legend": [],
    "basis": "PAGASA level (air temp) → score = (level−1)/4. Refs: docs/HEAT-RISK-MODEL-BASIS.md"
  }
}
```

When humidity is available, `risk` may include `heat_index_c`. Use for map, exports, or pipeline.

### GET /api/heat/davao/current

City center current weather (one WeatherAPI call).

```json
{
  "cityId": "davao",
  "temp_c": 26.5,
  "feelslike_c": 27.2,
  "difference_c": 0.7,
  "updatedAt": "2026-02-20T12:00:00.000Z"
}
```

### GET /api/heat/davao/forecast

Optional: `?days=14` (default 7).

```json
{
  "cityId": "davao",
  "days": 7,
  "forecastDayCount": 7,
  "location": {
    "name": "Davao",
    "region": "Davao del Sur",
    "country": "Philippines",
    "lat": 7.19,
    "lon": 125.46,
    "tz_id": "Asia/Manila"
  },
  "forecastDay": [
    {
      "date": "2026-02-20",
      "mintemp_c": 24.5,
      "maxtemp_c": 32.1,
      "avgtemp_c": 27.8
    }
  ],
  "updatedAt": "2026-02-20T12:00:00.000Z"
}
```

### GET /api/heat/davao/barangay-population

```json
{
  "1130700001": {
    "population": 3861,
    "density": 351
  },
  "1130700002": {
    "population": 7064,
    "density": 0
  }
}
```

### GET /api/heat/davao/pipeline-report/meta

```json
{
  "available": true,
  "updatedAt": "2026-02-20T12:00:00.000Z"
}
```

When no report exists: `"available": false`, `"updatedAt": null`.

### POST /api/heat/davao/pipeline-report/generate

**Response (200)** – may take 1–2 minutes:

```json
{
  "ok": true,
  "updatedAt": "2026-02-20T12:05:00.000Z",
  "rows": 182,
  "hint": "Download via GET /api/heat/davao/pipeline-report."
}
```

### POST /api/heat/davao/pipeline-report

**Request:** Body = raw CSV (`Content-Type: text/csv`). Optional header: `x-pipeline-report-key` (required if `PIPELINE_REPORT_WRITER_KEY` is set).

**Response (201):**

```json
{
  "ok": true,
  "updatedAt": "2026-02-20T12:00:00.000Z",
  "hint": "Users can download via GET /api/heat/davao/pipeline-report."
}
```

### GET /api/heat/davao/pipeline-report

Returns the CSV file (binary/text). **Not JSON.**  
Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="barangay_heat_risk_davao_....csv"`.

**404 when no report:**

```json
{
  "error": "No pipeline report available",
  "hint": "Run the pipeline and upload the report (POST with x-pipeline-report-key), or wait for the next scheduled run."
}
```

---

## Error responses (common)

**503 (service unavailable, e.g. missing WEATHER_API_KEY):**

```json
{
  "error": "Weather API not configured",
  "hint": "Set WEATHER_API_KEY for barangay temperatures and heat risk (https://www.weatherapi.com/my/)"
}
```

**404 (city not supported):**

```json
{
  "error": "City not supported",
  "cityId": "manila"
}
```

**502 (upstream failure, e.g. WeatherAPI down):**

```json
{
  "error": "Failed to fetch city average from WeatherAPI"
}
```

**401 (upload without key when required):**

```json
{
  "error": "Unauthorized",
  "hint": "Set x-pipeline-report-key to PIPELINE_REPORT_WRITER_KEY."
}
```
