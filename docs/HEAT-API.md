# Heat API – Barangay temperature & heat risk

This document describes the **backend** API and logic for barangay-level temperature and heat risk. The backend is the source of truth; the frontend consumes the API and renders the heat map. **Live map** is rule-based and validated. For **AI and advisory disclaimers**, see **docs/AI-DISCLAIMER.md**.

**Sample JSON** for all heat and other backend endpoints: **docs/API-SAMPLES.md**.

---

## 1. API contract

**Barangays (single endpoint for map and exports)**

```http
GET /api/heat/:cityId/barangays
```

**Query**  
- **`?limit=N`** – Cap number of barangays (e.g. `?limit=20`). Omit for all.

**Response**  
- **`barangays`** – Array of `{ barangay_id, temp_c, risk: { score, level, label [, heat_index_c ] }, lat, lng, area_km2 }`.
- **`updatedAt`** – ISO timestamp.
- **`meta`** – `cityId`, `count`, `usedHeatIndex`, `temperaturesSource`, `legend`, `basis`.

Use for heat map and exports. Temperature is air temp (°C); when WeatherAPI returns humidity, **heat index** (NOAA Rothfusz) is computed and included in `risk.heat_index_c` and used for PAGASA level.

**City current**

```http
GET /api/heat/:cityId/current
```

One WeatherAPI call for city center. Response: **`temp_c`**, **`feelslike_c`**, **`difference_c`**, **`updatedAt`**.

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

### 3.1 Why live and local (or different deployments) can show different temperatures

Different temperatures between **live** and **local** (or between two deployments) are expected when any of the following differ:

| Cause | Effect |
|-------|--------|
| **`HEAT_PER_BARANGAY`** | **Live unset** → centroids grouped by rounded lat,lng (3 decimals); many barangays share the same temp (e.g. 25.8). **Local `HEAT_PER_BARANGAY=1`** → one WeatherAPI request per barangay (exact centroid) → more variety (e.g. 27.4, 28.2, 28.9). Check **`meta.perBarangay`** in the response. |
| **`HEAT_UHI_MAX`** | When set (e.g. `1.5`), the backend adds 0–HEAT_UHI_MAX °C by density rank (urban heat island proxy). **Live `0`** vs **local `1.5`** → different spread. Check **`meta.uhiMaxC`**. |
| **Time and cache** | Weather changes over time. Responses are cached per location for 10 minutes. A request 10 minutes later or from another region can get different WeatherAPI values. |
| **Same code, different env** | Ensure live and local use the same env (or document the intended production env) so behaviour is consistent. |

To align behaviour: set the same `HEAT_PER_BARANGAY` and `HEAT_UHI_MAX` (or leave both unset) on both deployments, and treat small differences as normal due to cache and time.

### 3.2 Disclaimers

Use **docs/DISCLAIMERS.md** and **docs/AI-DISCLAIMER.md** for disclaimer and source text. **GET /api/heat/davao/barangays** returns **meta.basis** for display near the heat map legend.
