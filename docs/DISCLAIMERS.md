# Disclaimers – What each process does, where it comes from, and validity

This document describes **what each process actually does**, **where the data comes from**, and the **validity and limitations** of outputs. Use these for in-app disclaimers and to cite sources. For **AI and advisory disclaimers** (assist-only, no guarantees, cross-check with PAGASA and official sources), see **docs/AI-DISCLAIMER.md**.

---

## 1. Barangay temperatures (heat map data)

**What it does:** Provides **air temperature (°C)** per barangay (or one city-wide value for all barangays) for the heat map. Used as the primary input for the heat-risk assessment.

**Where it comes from:**
- **WeatherAPI** (`WEATHER_API_KEY`): Per-barangay current weather by centroid (lat,lon). Each barangay can have a different temperature and **relative humidity** (%). Cached 10 minutes per location. Humidity is returned by WeatherAPI’s current weather endpoint and is used when available for PAGASA-aligned heat index; see **Barangay heat risk** below.

**Validity and limitations:**
- Temperatures (and humidity) are **model/API outputs**, not official PAGASA or NWS observations. They are suitable for **planning and awareness**, not for regulatory or official hazard declaration.
- When **humidity** is available per barangay, the backend computes **heat index** (NOAA Rothfusz) and maps it to PAGASA categories for risk levels.
- **Not a substitute** for local weather stations or official heat advisories from PAGASA.

**References:** See **docs/HEAT-RISK-MODEL-BASIS.md** and **docs/CITED-SOURCES.md**.

---

## 2. Barangay heat risk (map risk levels)

**What it does:** Assigns each barangay a **risk level 1–5** (PAGASA-style: Not Hazardous, Caution, Extreme Caution, Danger, Extreme Danger) and a **score 0–1**. The score is derived **only** from the validated PAGASA level. The API returns only validated outputs (score, level, label, temp_c, heat_index_c when used); no delta, population, or density.

**Where it comes from:**
- **Input:** Barangay temperatures and **relative humidity** (from WeatherAPI current weather per lat,lon, see above). When humidity is returned, heat index is used for PAGASA-aligned risk.
- **Heat index (when humidity available):** **NOAA Rothfusz** formula (NWS SR 90-23). Official source: https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
- **Risk levels and bands:** **PAGASA** heat index classification (27–32°C Caution, 33–41°C Extreme Caution, etc.). Official source: https://www.pagasa.dost.gov.ph/weather/heat-index
- **Score:** `(level − 1) / 4` so level 1→0, 5→1. No delta or density in score.

**Validity and limitations:**
- When **heat index** is used (`usedHeatIndex: true` in the API), the **level and score** are based on **validated** methods (NOAA + PAGASA).
- When only **air temperature** is used (no humidity), the same PAGASA **bands** are applied to temperature; this is **not** the full PAGASA “heat index” (which includes humidity) but preserves the same category scale.
- Outputs are **for planning and awareness only**. They are **not** official PAGASA heat advisories or regulatory determinations.

**References:** **docs/HEAT-RISK-MODEL-BASIS.md**, **docs/LOGICAL-COMPUTATIONS.md**, **docs/CITED-SOURCES.md**.

---

## 3. Forecast (7- or 14-day)

**What it does:** Returns **7- or 14-day weather forecast** for Davao City (single location). Used for trend and planning, not per-barangay risk.

**Where it comes from:** **WeatherAPI** (https://www.weatherapi.com). One request per city center; cached 10 minutes.

**Validity and limitations:**
- Forecast data is from a **third-party provider**. It is **not** from PAGASA or NWS. Use for **general planning** only; do not rely for official warnings or critical decisions.

---

## 4. AI and advisory disclaimer

**What it does:** Responses and advisories are **generated or assisted by AI** and are intended to **assist** users, not to replace authoritative sources. The system makes **no over-claimed data, no predictions, and no authoritative guarantees**. Users should **always cross-check** with **PAGASA** and other **valid, official sources**. The system ensures validity by **transparency**, avoiding **unsupported claims**, and **clearly labeling** advisory logic. Full text: **docs/AI-DISCLAIMER.md**.


---

## Summary table

| Process              | What it does                          | Main data sources              | Validity / use                          |
|----------------------|----------------------------------------|--------------------------------|-----------------------------------------|
| Barangay temperatures| Temp °C per barangay by lat,lon       | WeatherAPI                     | For planning; not official observations |
| Barangay heat risk   | Level 1–5 + score from temp/heat index| NOAA Rothfusz, PAGASA          | Validated when heat index; for awareness only |
| Forecast             | 7/14-day forecast for city            | WeatherAPI                     | Third-party; for general planning       |
| AI / advisory        | Assist-only; cross-check with PAGASA and official sources | See AI-DISCLAIMER.md            | No guarantees; transparency and clear labeling       |

---

**Full citations and DOIs:** **docs/CITED-SOURCES.md**.

---

## Display text for frontend

Heat APIs do not return `disclaimer`, `sources`, or `validity` in the response body. Use this document and **docs/CITED-SOURCES.md** to build in-app disclaimers and source attributions:

- **Barangay temperatures / heat map** – Use §1 above (barangay temperatures) for source and validity text.
- **Barangay heat risk** – Use §2 (barangay heat risk); response still includes `basis`, `usedHeatIndex` for context.
- **Forecast** – Use §3 (forecast).
- **AI and advisory** – Use **docs/AI-DISCLAIMER.md** (§4 above) for disclaimer and source text across the app.
