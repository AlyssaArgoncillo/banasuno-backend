# Logic flows – backend and pipeline

Single place for **step-by-step computation flows**: backend (heat data and heat risk) and pipeline (weighted heat risk CSV). For **validity and verification** see **docs/VALIDITY.md**. For **cited sources** see **docs/CITED-SOURCES.md**.

---

## 1. Backend logic flow

Code: `src/routes/heat.js`, `src/services/heatRiskModel.js`, `src/lib/heatIndex.js`, `src/lib/barangays.js`, `src/services/weatherService.js`.

### 1.1 Barangay temperatures (used by `barangays`)

| Step | What is computed | Where |
|------|------------------|--------|
| 1 | **Load barangay geography** — Fetch Davao GeoJSON (cached in memory). | `getDavaoBarangayGeo()` → `src/lib/barangays.js` |
| 2 | **Centroids** — One (lat, lng) per barangay from polygon centroid. Optional `?limit=N` caps number of barangays. | `getBarangayCentroids(geo)` → `src/lib/barangays.js` |
| 3 | **Location keys** — If `HEAT_PER_BARANGAY=1`: one key per barangay (`b:<id>`). Else: group by rounded (lat,lng) to 3 decimals so many barangays can share one WeatherAPI call. | `src/routes/heat.js` `fetchBarangayTempsWeatherAPI` |
| 4 | **Expire cache** — Entries older than 10 minutes (per location) are removed. | Same function |
| 5 | **Weather per location** — For each key: if cache hit (same key, &lt; 10 min), use cached `temp_c` and `humidity`. Else call WeatherAPI `current.json?q=lat,lng`, read `temp_c` and `humidity` (0–100), round temp to 1 decimal, store in cache. | `getWeatherWeatherAPI()` → `src/services/weatherService.js`; cache in `heat.js` |
| 6 | **Assign to barangays** — For each key, set `temperatures[barangayId] = temp_c` and `humidityByBarangay[barangayId] = humidity` for every barangay ID that shares that key. | Same function |
| 7 | **Optional UHI / auto-spread** — If `HEAT_UHI_MAX` &gt; 0: add 0 to `HEAT_UHI_MAX` °C per barangay by density rank (low→high). If all API temps were identical and `HEAT_UHI_MAX` is 0: apply 0–1°C spread by density rank so the map is not flat. | Same function |
| 8 | **Min / max** — `min` = minimum of all `temperatures` values; `max` = maximum. | Same function |

**Result:** `{ temperatures, min, max, humidityByBarangay, ... }`. Passed into §1.2 and returned in **GET barangays**.

### 1.2 Heat risk (barangays)

| Step | What is computed | Where |
|------|------------------|--------|
| 9 | **Average temp** — Mean of all `temperatures` values; returned as `averageTemp` at response level only (not used per-barangay). | `assessBarangayHeatRisk()` → `src/services/heatRiskModel.js` |
| 10 | **Per barangay:** | Same function |
| 10a | **Input to PAGASA** — If barangay has humidity (0–100): `inputForPAGASA = heatIndexRothfusz(temp_c, humidity)` (NOAA Rothfusz). Else: `inputForPAGASA = temp_c`. | `heatIndexRothfusz()` → `src/lib/heatIndex.js` |
| 10b | **PAGASA level and label** — Map `inputForPAGASA` (°C) to level 1–5 and label: &lt;27 → Not Hazardous, 27–32 → Caution, 33–41 → Extreme Caution, 42–51 → Danger, ≥52 → Extreme Danger. | `tempToPAGASALevel()` in `heatRiskModel.js` |
| 10c | **Score** — `score = (level − 1) / 4` (0, 0.25, 0.5, 0.75, 1). Only validated level is used. | `scoreFromLevel()` in `heatRiskModel.js` |
| 10d | **Response fields** — For each barangay: `score`, `level`, `label`, `temp_c`, optional `heat_index_c`. No delta, population, or density. | Same function |
| 11 | **Aggregates** — Counts per level, `minScore`, `maxScore`, `legend` (HEAT_LEVELS), `basis` (string indicating Rothfusz vs air temp only), `usedHeatIndex`. | Same function |

**Result:** `{ temperatures, averageTemp, risks, minRisk, maxRisk, counts, legend, basis, usedHeatIndex, updatedAt, meta }`.

### 1.3 Heat index formula (Rothfusz) — used in step 10a

| Step | What is computed | Where |
|------|------------------|--------|
| A | **°C → °F** — Convert air temp to Fahrenheit for the formula. | `heatIndex.js` |
| B | **If HI &lt; ~80°F** — Simple formula `0.5*{T + 61 + (T−68)*1.2 + RH*0.094}`, then average with T; return result in °C. | Same file |
| C | **If HI ≥ 80°F** — Full Rothfusz regression (coefficients from NWS SR 90-23); apply low-RH and high-RH adjustments per WPC; convert result to °C. If result out of range, return air temp. | Same file |

---

## 2. Pipeline logic flow

Code: `ai/fetch_pipeline_data.py`, `ai/weighted_heat_risk_pipeline.py`. Input CSV filled from backend APIs.

| Step | What happens |
|------|----------------|
| 1 | **Load CSV** — `barangay_id`, `date`, `temperature`, `facility_distance`. Filled by `fetch_pipeline_data.py` from backend APIs. |
| 2 | **Temperature feature** — Single date: `temp_rolling` = `temperature`. Multiple dates: 7‑day rolling mean per barangay. `temperature` = heat index °C when backend provided `heat_index_c`, else air temp °C. |
| 3 | **Other features** — `facility_score` = `1 / (1 + facility_count)`. |
| 4 | **Weights** — Two features (temp, facility_score) with equal weights 1/2 each (EWA). |
| 5 | **Scale** — MinMaxScaler (sklearn): each feature → [0, 1] over the dataset. |
| 6 | **Cluster** — K‑Means, k = 5, fixed seed (42). Each row gets cluster 0–4. |
| 7 | **Severity per cluster** — For each cluster, mean of each scaled feature; then severity_score = weighted sum (same EWA weights). |
| 8 | **Map to PAGASA 1–5** — Rank clusters by severity_score (ascending); lowest → risk_level 1, highest → risk_level 5. |
| 9 | **Output** — One row per barangay: `barangay_id`, `risk_level`, `cluster`; CSV includes `#` comment block (disclaimer, sources). |

**Data sources:** Temperature/heat index from backend `barangays`; facility count from backend facilities API.
