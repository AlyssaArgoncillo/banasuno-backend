# Heat API – Barangay temperature & heat risk

This document describes the **backend** API and logic for barangay-level temperature and heat risk. The backend is the source of truth; the frontend consumes the API and renders the heat map. **Two different approaches** are in use: **live map** (rule-based, validated) and **pipeline report** (K-Means clustering + weighted features; a standard ML algorithm for batch grouping, not “AI” in the sense of adaptive or generative systems).

**Sample JSON** for all heat and other backend endpoints: **docs/API-SAMPLES.md**.

---

## 1. API contract

**Endpoint**

```http
GET /api/heat/:cityId/barangay-temperatures
```

**Query**  
- **`?limit=N`** – Cap number of barangays fetched (e.g. `?limit=20`). Omit for all barangays.

**Response**

```json
{
  "temperatures": { "1130700001": 31.2, "1130700002": 33.1 },
  "min": 26,
  "max": 39,
  "meta": {
    "uniqueLocations": 2,
    "perBarangay": false,
    "uhiMaxC": 0,
    "autoSpreadApplied": false
  }
}
```

- **`temperatures`** – Barangay ID (PSGC) → air temperature (°C). Used for validated heat risk (air temp + humidity → NOAA Rothfusz heat index when available).
- **`min`** / **`max`** – Range for legend and normalization.
- **`meta.uniqueLocations`** – Number of distinct WeatherAPI calls (location grouping by 3-decimal lat,lon).
- **`meta.perBarangay`** – True when `HEAT_PER_BARANGAY=1` (one request per barangay).
- **`meta.uhiMaxC`** – Urban heat island cap (°C) when set via `HEAT_UHI_MAX`.
- **`meta.autoSpreadApplied`** – True when all API temps were identical and a density-based spread (0–1°C) was applied.

---

## 2. Backend responsibilities

The backend **owns**:

- **Sources of truth** for temperature: sensors, third-party APIs (e.g. WeatherAPI), cached or historical data.
- **Business rules**: aggregation, time window, min/max range, validation.
- **Resolving** `cityId` (e.g. `davao`) to the correct geographic / barangay set and returning temperatures keyed by barangay ID.

The frontend calls this API and uses the response in `getBarangayHeatData` → `buildHeatPointsFromBarangays`; it does not implement temperature logic.

---

## 3. Current implementation

- **Route:** `src/routes/heat.js`
- **Per-barangay temp:** [WeatherAPI](https://www.weatherapi.com/docs/) with `q=lat,lon` per centroid. **Air temperature (temp_c)** is used so the heat-risk model can apply the validated path: when **humidity** is returned by the API, backend computes **NOAA Rothfusz** heat index and maps to PAGASA levels. Cached by location (10 min). Optional **`?limit=N`**.
- **Env:** **WEATHER_API_KEY** (required for heat). Optional: **HEAT_PER_BARANGAY=1** (one request per barangay, exact centroid); **HEAT_UHI_MAX** (0–N °C urban heat island adjustment by density rank). When the API returns the same temp for all locations, a small density-based spread (0–1°C) is applied automatically so the map is not flat. See `.env.example`.
- **GET /api/heat/:cityId/temp-vs-feelslike** – Single WeatherAPI call for city center; returns `temp_c`, `feelslike_c`, and `difference_c` for comparison. Heat risk uses **air temp** (validated Rothfusz + PAGASA when humidity available).

### 3.1 Pipeline report (generate and download)

The pipeline heat-risk report is stored in Postgres (Supabase; not in the repo). Users can **generate** it from the frontend, then **download** it.

- **POST /api/heat/davao/pipeline-report/generate** – Generates the report on demand (same logic as the Python pipeline: heat + facilities + density, K-Means clustering, PAGASA levels 1–5). May take 1–2 minutes (WeatherAPI per-barangay temps). Returns `{ ok, updatedAt, rows }`. No auth required; call from the frontend to trigger generation.
- **GET /api/heat/davao/pipeline-report** – Returns the latest report as a CSV file (`Content-Disposition: attachment`). Responds 404 if no report has been generated or uploaded.
- **POST /api/heat/davao/pipeline-report** – Upload report (body: `text/csv`). Used by the Python pipeline when run with `--upload`. If `PIPELINE_REPORT_WRITER_KEY` is set, the request must include header `x-pipeline-report-key`.

**Frontend flow to trigger generate then download:**

1. **“Generate report”** – `POST /api/heat/davao/pipeline-report/generate`. Show a loading state (request can take 1–2 min). On success (200), show “Report ready” and enable the download button. The response includes `disclaimer`, `sources`, and `validity` for display.
2. **“Download report”** – Open or fetch `GET /api/heat/davao/pipeline-report` and trigger a file download. If 404, show “No report available; generate one first.”
3. **Disclaimers** – Use **`GET /api/heat/davao/pipeline-report/meta`** for `disclaimer`, `sources`, and `validity` to show next to the download button. Same fields are in **`GET /api/heat/davao/barangay-heat-risk`** for the map (display near the heat map legend).

**In-app disclaimers:** All relevant APIs return short **disclaimer**, **sources**, and **validity** text. Full text: **docs/DISCLAIMERS.md**.

---

## 4. Live map vs pipeline report (rule-based vs clustering)

**What actually runs where?**

| Use case | What runs | Type | Where |
|----------|-----------|------|--------|
| **Live map** (barangay temps + risk levels on the map) | **Rule-based only.** Temperatures from WeatherAPI; risk from **NOAA Rothfusz** heat index (when humidity available) + **PAGASA** bands; score = (level−1)/4. No clustering. | Validated formula | `src/services/heatRiskModel.js`; `GET /api/heat/:cityId/barangay-heat-risk` |
| **Pipeline report** (CSV for download / prioritization) | **K-Means clustering** (k=5), MinMaxScaler, equal-weight combination of temperature (or heat index), **facility access**, and **population density**. Cluster rank → PAGASA levels 1–5. Standard unsupervised ML for grouping, not adaptive or generative “AI.” | Batch, clustering + EWA | **`ai/weighted_heat_risk_pipeline.py`**; also **`POST /api/heat/davao/pipeline-report/generate`** (backend runs same logic). |

So:

- The **pipeline** (Python script or backend generate endpoint) uses **K-Means**—a standard machine-learning algorithm—to group barangays and assign risk levels for the **report CSV**. It is used when you run the pipeline (e.g. `ai/run_pipeline.cmd`) or call **POST …/pipeline-report/generate**. We do not call it “AI” in the sense of adaptive or generative systems; it is deterministic clustering + weighted features.
- The **live map** never uses the pipeline; it uses only the **rule-based** heat risk model (Rothfusz + PAGASA).

See **ai/README.md** and **docs/PIPELINE-COMPUTATIONAL-BASIS.md** for the pipeline’s computational logic.
