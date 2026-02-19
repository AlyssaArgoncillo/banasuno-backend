# Backend logic – usage guide

This guide explains how to use the BanasUno backend: heat data, heat-risk assessment, and how they fit together.

---

## 1. Overview

| Concern | What it does |
|--------|----------------|
| **Barangay temperatures** | Different temp per barangay: Meteosource (per centroid). Fallback: WeatherAPI gives one city average for all. |
| **Heat risk assessment** | Takes barangay-level temperatures and assigns a 5-level category using **PAGASA heat index** (Not Hazardous &lt;27°C → Extreme Danger ≥52°C). See [PAGASA heat index](https://www.pagasa.dost.gov.ph/weather/heat-index). |
| **Health facilities** | Serves Davao health facilities from Redis. **By barangay:** facilities are assigned to the barangay whose centroid (lat/lon) is nearest to the facility; barangays have only lat/lon, no polygon. |

**Data flow for heat map:**

1. **Meteosource** → one request per barangay centroid (lat/lon) → `temperatures[barangayId]` = temp °C.
2. **WeatherAPI** (optional) → one request for “Davao City” → `averageTemp` used to adjust risk (barangay vs city).
3. **Heat risk model** → `assessBarangayHeatRisk(temperatures, { averageTemp })` → `risks[barangayId]` = { level 1–5, label (PAGASA), score, temp_c, delta_c }. Response includes `legend` (with `range` per level) and `basis` (PAGASA URL).

---

## 2. Environment and setup

### Required for heat/risk

| Variable | Required for | Where to get it |
|----------|--------------|------------------|
| `METEOSOURCE_API_KEY` | **Required for different heat temps per barangay.** Barangay-level temps by centroid; heat risk varies by barangay. | [Meteosource](https://www.meteosource.com/client) |
| `WEATHER_API_KEY` | City average (optional with Meteosource; or use alone for one temp for all barangays) | [WeatherAPI](https://www.weatherapi.com/my/) |

- **Heat risk endpoint** requires `METEOSOURCE_API_KEY`. Without it you get 503 and a hint to set it.
- **Different temp per barangay** requires Meteosource. WeatherAPI only → one city average for all barangays.

Copy `.env.example` to `.env` and set at least:

```bash
METEOSOURCE_API_KEY=your_meteosource_key
# Optional: for city average in risk and fallback temps
WEATHER_API_KEY=your_weatherapi_key
```

Then:

```bash
npm install
npm start
```

Server runs at `http://localhost:3000` (or `PORT` from `.env`).

---

## 3. Endpoints

### 3.1 Barangay temperatures only

```http
GET /api/heat/:cityId/barangay-temperatures
```

- **Supported `cityId`:** `davao` (lowercase).
- **Query:** none. This route always returns all barangays (no `limit`).
- **Response:** `{ temperatures: { [barangayId]: temp_c }, min, max, averageTemp? }`. When `WEATHER_API_KEY` is set, `averageTemp` is included (city-level from WeatherAPI).

**Example**

```bash
curl "http://localhost:3000/api/heat/davao/barangay-temperatures"
```

Use this when you only need temps (e.g. your own risk logic or a simple temp map).

---

### 3.2 Barangay heat risk (temperatures + PAGASA 5-level heat index)

```http
GET /api/heat/:cityId/barangay-heat-risk
```

- **Supported `cityId`:** `davao`.
- **Requires:** `METEOSOURCE_API_KEY` in `.env` (barangay-level temps required for risk).
- **Query:** optional `?limit=N` (e.g. `5` or `20`, max 500) to cap how many barangays are fetched; useful for quick tests during development. Invalid values (e.g. `?limit=abc`) are ignored and all barangays are returned. For official deployment, omit `limit` or revisit the cap in `src/routes/heat.js` if you need full coverage without a cap.

**Response shape**

```json
{
  "temperatures": { "1130700001": 24.5, "1130700002": 27.2 },
  "averageTemp": 26.8,
  "risks": {
    "1130700001": {
      "score": 0.1,
      "level": 1,
      "label": "Not Hazardous",
      "temp_c": 24.5,
      "delta_c": -2.3
    },
    "1130700002": {
      "score": 0.3,
      "level": 2,
      "label": "Moderate",
      "temp_c": 27.2,
      "delta_c": 0.4
    }
  },
  "minRisk": 0.1,
  "maxRisk": 0.8,
  "counts": { "not_hazardous": 50, "caution": 80, "extreme_caution": 30, "danger": 15, "extreme_danger": 2 },
  "updatedAt": "2025-02-18T12:00:00.000Z",
  "legend": [
    { "level": 1, "label": "Not Hazardous", "range": "< 27°C", "color": "#48bb78" },
    { "level": 2, "label": "Caution", "range": "27–32°C", "color": "#ecc94b" },
    { "level": 3, "label": "Extreme Caution", "range": "33–41°C", "color": "#ed8936" },
    { "level": 4, "label": "Danger", "range": "42–51°C", "color": "#f97316" },
    { "level": 5, "label": "Extreme Danger", "range": "≥ 52°C", "color": "#dc2626" }
  ],
  "basis": "PAGASA heat index (https://www.pagasa.dost.gov.ph/weather/heat-index)",
  "meta": {
    "cityId": "davao",
    "temperaturesSource": "meteosource",
    "averageSource": "weatherapi"
  }
}
```

**Example**

```bash
# Full run (all barangays; can be slow)
curl "http://localhost:3000/api/heat/davao/barangay-heat-risk"

# Quick test (first N barangays)
curl "http://localhost:3000/api/heat/davao/barangay-heat-risk?limit=10"
```

Use this for the heat map: color barangays by `risks[id].level` (1–5) and use `legend` for the bottom legend (PAGASA: Not Hazardous, Caution, Extreme Caution, Danger, Extreme Danger). Each legend entry includes `range` (e.g. "27–32°C").

---

### 3.3 7- and 14-day forecast (historical trend)

```http
GET /api/heat/:cityId/forecast
```

- **Supported `cityId`:** `davao`.
- **Requires:** `WEATHER_API_KEY` in `.env`.
- **Query:** `?days=7` (default) or `?days=14`. Any other value is treated as 7.
- **Response:** City-center forecast from WeatherAPI: `days` (7 or 14), `forecastDayCount` (number of days returned), `location`, `forecastDay` (array of daily min/max/avg temp, condition, chance of rain, etc.), `updatedAt`. Use `forecastDayCount` to confirm 7- or 14-day data was returned (some plans may cap days).

**Example**

```bash
curl "http://localhost:3000/api/heat/davao/forecast"
curl "http://localhost:3000/api/heat/davao/forecast?days=14"
```

Use this for backend logic that needs a 7- or 14-day temperature trend (e.g. heat trend charts, planning). Results are cached for 10 minutes.

---

## 4. Backend logic in code

### 4.1 Where things live

| Piece | File | Role |
|-------|------|------|
| Heat routes | `src/routes/heat.js` | Exposes `/barangay-temperatures`, `/barangay-heat-risk`, and `/forecast`; fetches temps (Meteosource or WeatherAPI), calls risk model, returns JSON. |
| Barangay temps (Meteosource) | `src/services/meteosourceService.js` | `getCurrentWeather(apiKey, lat, lon)` → temp °C per point. |
| City average (WeatherAPI) | `src/services/weatherService.js` | `getCurrentWeather(apiKey, "Davao City, Philippines")` → one temp for city. |
| Heat risk model | `src/services/heatRiskModel.js` | `assessBarangayHeatRisk(temperatures, { averageTemp })` → risks + legend. Barangay-level temps (from Meteosource) are the input. |
| Geo | `src/lib/geo.js` | `getFeatureCentroid(feature)` → [lng, lat] for each barangay polygon. |

### 4.2 Flow for heat risk

1. **Route** (`heat.js`): Requires `METEOSOURCE_API_KEY`, calls `fetchBarangaySpecificTemps(meteosourceKey, limit)`.
2. **Temperatures:** Load Davao barangay GeoJSON → for each (or limited) feature get centroid → call Meteosource per unique location → build `temperatures[barangayId]`.
3. **Average (optional):** If `WEATHER_API_KEY` is set, fetch city temp once → `averageTemp`.
4. **Risk:** `assessBarangayHeatRisk(tempsData.temperatures, { averageTemp })`:
   - Input: barangay-level temperatures from Meteosource.
   - Uses **PAGASA heat index** bands: &lt;27°C → Not Hazardous, 27–32°C → Caution, 33–41°C → Extreme Caution, 42–51°C → Danger, ≥52°C → Extreme Danger. Optional delta vs `averageTemp` slightly adjusts score.
   - Returns `risks`, `counts`, `legend`, `minRisk`, `maxRisk`, etc.
5. **Response:** Route returns temperatures + assessment + legend + meta.

### 4.3 Using the risk model directly (e.g. tests)

```js
import { assessBarangayHeatRisk, HEAT_LEVELS } from "./src/services/heatRiskModel.js";

const temperatures = {
  "1130700001": 24,
  "1130700002": 30,
  "1130700003": 36,
};
const result = assessBarangayHeatRisk(temperatures, { averageTemp: 28 });
console.log(result.risks);
console.log(result.legend);
```

---

## 5. Using from a frontend

- **Base URL:** e.g. `http://localhost:3000` (or your deployed API). Backend sends `Access-Control-Allow-Origin: *`.
- **Heat map data:** `GET /api/heat/davao/barangay-heat-risk` (optionally `?limit=N` for development/testing; omit for full Davao).
- **Barangay IDs:** Use the same IDs as your GeoJSON (e.g. `feature.id` or `feature.properties.adm4_psgc`). Backend uses the same Davao GeoJSON from the repo.
- **Coloring:** Use `response.risks[barangayId].level` (1–5) and `response.legend[level - 1].color`. Build the legend from `response.legend` (each has `label`, `range`, `color`). Response includes `basis` (PAGASA URL).
- **Optional:** Use `response.temperatures` for tooltips (e.g. show `temp_c` and `label`).

**Minimal fetch example**

```js
const base = "http://localhost:3000";
const res = await fetch(`${base}/api/heat/davao/barangay-heat-risk`);
const data = await res.json();
if (!res.ok) {
  console.error(data.error, data.hint);
  return;
}
const { risks, legend, temperatures } = data;
// e.g. color polygon for barangay id: legend[risks[id].level - 1].color
```

---

## 6. Scripts and diagnostics

- **Seed facilities:** `npm run seed:facilities` (needs Redis + `FACILITIES_JSON_PATH` or file in `data/`). Not needed for heat/risk.
- **Check WeatherAPI per point (diagnostic):** `node scripts/check-weatherapi-per-barangay.js` (uses `WEATHER_API_KEY`). Compares several barangay coordinates to see if WeatherAPI returns different temps or same regional value.

---

## 7. Summary

| Goal | Endpoint | Env |
|------|----------|-----|
| Barangay temps only | `GET /api/heat/davao/barangay-temperatures` | Meteosource and/or WeatherAPI |
| Temps + PAGASA heat index (5 levels) for map | `GET /api/heat/davao/barangay-heat-risk` | **METEOSOURCE_API_KEY** required; WeatherAPI optional for average |
| 7- or 14-day forecast (trend) | `GET /api/heat/davao/forecast?days=7\|14` | **WEATHER_API_KEY** required |
| Health facilities | `GET /api/facilities`, etc. | Redis + seed (see README) |
| Facilities in a barangay | `GET /api/facilities/by-barangay/:barangayId` | Redis + seed. Uses nearest barangay (lat/lon only). |

The **temperature used in the heat risk model is the barangay-level temperature fetched from Meteosource** (one per centroid). The heat-risk endpoint requires Meteosource so that risk is always computed from these per-barangay temps.
