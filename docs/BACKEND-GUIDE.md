# Backend logic – usage guide

This guide explains how to use the BanasUno backend: heat data, heat-risk assessment, and how they fit together.

---

## 1. Overview

| Concern | What it does |
|--------|----------------|
| **Barangay temperatures** | Per-barangay temp by lat,lon: WeatherAPI (one request per centroid). |
| **Heat risk assessment** | Takes barangay-level temperatures and assigns a 5-level category using **PAGASA heat index** (Not Hazardous &lt;27°C → Extreme Danger ≥52°C). See [PAGASA heat index](https://www.pagasa.dost.gov.ph/weather/heat-index). |
| **Health facilities** | Serves Davao health facilities from Postgres (Supabase). **By barangay:** facilities are assigned to the barangay whose centroid (lat/lon) is nearest to the facility; barangays have only lat/lon, no polygon. |

**Data flow for heat map:**

1. **WeatherAPI** → one request per barangay centroid (lat,lon) → `temperatures[barangayId]` = temp °C.
2. **Heat risk model** → `assessBarangayHeatRisk(temperatures, { humidityByBarangay })` → `risks[barangayId]` = { level 1–5, label (PAGASA), score, temp_c, optional heat_index_c }. Response includes `legend`, `basis`, `averageTemp`. No delta, population, or density.

---

**Backend computation flow (step-by-step):** **docs/LOGIC-FLOWS.md** §1. **Validity and verification:** **docs/VALIDITY.md**. **Cited sources:** **docs/CITED-SOURCES.md**.

---

## 2. Environment and setup

### Required for heat/risk

| Variable | Required for | Where to get it |
|----------|--------------|------------------|
| `WEATHER_API_KEY` | Barangay temps (per lat,lon) and heat risk. Required for heat/forecast. | [WeatherAPI](https://www.weatherapi.com/my/) |

Copy `.env.example` to `.env` and set:

```bash
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

### 3.1 Barangays (temp + risk + lat/lng + area)

```http
GET /api/heat/:cityId/barangays
```

- **Supported `cityId`:** `davao`.
- **Requires:** `WEATHER_API_KEY` in `.env`.
- **Query:** optional `?limit=N` (max 500).

**Response:** `{ barangays, updatedAt, meta }`. Each **`barangays[]`** item: `barangay_id`, `temp_c`, `risk` (score, level, label, optional heat_index_c), `lat`, `lng`, `area_km2`. **`meta`** includes `legend`, `basis` (for map disclaimer).

**Example**

```bash
curl "http://localhost:3000/api/heat/davao/barangays"
curl "http://localhost:3000/api/heat/davao/barangays?limit=10"
```

Use for heat map (color by `risk.level`, use `meta.legend`), exports, or pipeline. Env: **HEAT_PER_BARANGAY=1**, **HEAT_UHI_MAX** (see `.env.example`).

**City current**

```http
GET /api/heat/:cityId/current
```

One WeatherAPI call for city center. Response: `temp_c`, `feelslike_c`, `difference_c`, `updatedAt`.

---

### 3.2 7- and 14-day forecast (historical trend)

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
| Heat routes | `src/routes/heat.js` | Exposes `/barangays`, `/current`, `/forecast`; WeatherAPI (per lat,lon), PAGASA risk model. |
| Barangay temps | `src/routes/heat.js` (fetchBarangayTempsWeatherAPI) | WeatherAPI `getCurrentWeather(apiKey, "lat,lon")` → temp °C per point. |
| City average (WeatherAPI) | `src/services/weatherService.js` | `getCurrentWeather(apiKey, "Davao City, Philippines")` → one temp for city. |
| Heat risk model | `src/services/heatRiskModel.js` | `assessBarangayHeatRisk(temperatures, { averageTemp })` → risks + legend. Barangay-level temps (from WeatherAPI) are the input. |
| Geo | `src/lib/geo.js` | `getFeatureCentroid(feature)` → [lng, lat] for each barangay polygon. |

### 4.2 Flow for heat risk

1. **Route** (`heat.js`): Requires `WEATHER_API_KEY`, calls `fetchBarangayTempsWeatherAPI(weatherApiKey, limit)`.
2. **Temperatures:** Load Davao barangay GeoJSON → for each (or limited) feature get centroid → call WeatherAPI per unique location (q=lat,lon) → build `temperatures[barangayId]`.
3. **Average (optional):** If `WEATHER_API_KEY` is set, fetch city temp once → `averageTemp`.
4. **Risk:** `assessBarangayHeatRisk(tempsData.temperatures, { averageTemp })`:
   - Input: barangay-level temperatures from WeatherAPI.
   - Uses **PAGASA heat index** bands: &lt;27°C → Not Hazardous, 27–32°C → Caution, 33–41°C → Extreme Caution, 42–51°C → Danger, ≥52°C → Extreme Danger. Score = (level−1)/4 only; no delta or density. Response per barangay: score, level, label, temp_c, optional heat_index_c.
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
- **Heat map data:** `GET /api/heat/davao/barangays` (optionally `?limit=N` for development; omit for full Davao).
- **Barangay IDs:** Use the same IDs as your GeoJSON (e.g. `feature.id` or `feature.properties.adm4_psgc`). Backend uses the same Davao GeoJSON from the repo.
- **Coloring:** Use `response.risks[barangayId].level` (1–5) and `response.legend[level - 1].color`. Build the legend from `response.legend` (each has `label`, `range`, `color`). Response includes `basis` (PAGASA URL).
- **Optional:** Use `response.temperatures` for tooltips (e.g. show `temp_c` and `label`).

**Minimal fetch example**

```js
const base = "http://localhost:3000";
const res = await fetch(`${base}/api/heat/davao/barangays`);
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

- **Seed facilities:** `npm run seed:facilities` (needs Supabase + `FACILITIES_JSON_PATH` or file in `data/`). Not needed for heat/risk.
- **Check WeatherAPI per point (diagnostic):** `node scripts/check-weatherapi-per-barangay.js` (uses `WEATHER_API_KEY`). Compares several barangay coordinates to see if WeatherAPI returns different temps or same regional value.

---

## 7. Summary

| Goal | Endpoint | Env |
|------|----------|-----|
| Barangays (temp + risk + geo) | `GET /api/heat/davao/barangays` | **WEATHER_API_KEY** required |
| City current | `GET /api/heat/davao/current` | WeatherAPI |
| 7- or 14-day forecast (trend) | `GET /api/heat/davao/forecast?days=7\|14` | **WEATHER_API_KEY** required |
| Health facilities | `GET /api/facilities`, etc. | Supabase + seed (see README) |
| Facilities in a barangay | `GET /api/facilities/by-barangay/:barangayId` | Supabase + seed. Uses nearest barangay (lat/lon only). |

The **temperature used in the heat risk model is the barangay-level temperature fetched from WeatherAPI** (one per centroid, q=lat,lon). The heat-risk endpoint requires WEATHER_API_KEY.
