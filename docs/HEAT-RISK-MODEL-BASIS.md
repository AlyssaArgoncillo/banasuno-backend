# Heat risk model – basis and references

This document provides the **official and scientific basis** for the heat-risk model in `src/services/heatRiskModel.js`: temperature-based risk levels, validated score from PAGASA level only, and related logic.

**User-facing disclaimers (what it does, where it comes from, validity):** See **docs/DISCLAIMERS.md** § 2. The API **GET /api/heat/davao/barangays** returns **meta.basis** and **meta.legend** for in-app display.

---

## Validated computational logic (when humidity is available)

When the backend has **air temperature** (and optionally humidity) per barangay (e.g. from WeatherAPI), the model uses a **validated** computation path:

1. **Heat index (apparent temperature)**  
   Computed with the **NOAA / NWS Rothfusz regression** (National Weather Service Technical Attachment **SR 90-23**, Lans P. Rothfusz, 1990).  
   - **Source:** https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml  
   - **Formula:** T (°F) and RH (%) → HI (°F) via the published equation; low- and high-humidity adjustments as per NWS; for HI &lt; 80°F the simple Steadman-consistent formula is used.  
   - **Implementation:** `src/lib/heatIndex.js` — input/output in °C (convert to/from °F at boundaries).

2. **Risk level and category**  
   The **heat index in °C** is mapped to **PAGASA categories** (27–32 Caution, 33–41 Extreme Caution, 42–51 Danger, ≥52 Extreme Danger; we add &lt;27 “Not Hazardous”). PAGASA defines heat index as temperature + humidity, so using Rothfusz HI as input to PAGASA bands is **aligned with PAGASA’s definition**.

3. **Risk score (0–1)**  
   **Score = (level − 1) / 4**, so level 1→0, 2→0.25, 3→0.5, 4→0.75, 5→1. The score is a deterministic function of the validated PAGASA level only. The API does not expose delta, population, or density; see **docs/VALIDITY.md** §1.3 for the engineering justification.

**Result:** With humidity available, **heat index**, **level**, and **score** are all derived from validated sources (NOAA, PAGASA). The API returns only these validated outputs; no delta, population, or density.

**When humidity is not available:** The model uses **air temperature only** as input to PAGASA bands. That path is not fully aligned with PAGASA’s “heat index” (which includes humidity) but preserves the same category bands. The API returns `usedHeatIndex: true` when the validated (Rothfusz + PAGASA) path was used.

---

## 1. Temperature-based risk levels (PAGASA)

The **primary basis** is the **PAGASA (Philippine Atmospheric, Geophysical and Astronomical Services Administration) heat index** classification:

- **Official source:**  
  PAGASA – Heat Index  
  https://www.pagasa.dost.gov.ph/weather/heat-index  
  (also: https://bagong.pagasa.dost.gov.ph/weather/heat-index)

- **Categories used by PAGASA (heat index °C):**
  - **27–32°C:** Caution — fatigue, heat cramps possible
  - **33–41°C:** Extreme Caution — heat cramps/exhaustion possible; continued activity may lead to heatstroke
  - **42–51°C:** Danger — heat cramps/exhaustion likely; heatstroke probable with continued exposure
  - **52°C and above:** Extreme Danger — heatstroke imminent

Our implementation maps **heat index °C** (when computed from temperature + humidity via NOAA Rothfusz) or **air temperature °C** (when humidity is missing) to the same bands. We add a **“Not Hazardous”** band for **&lt; 27°C** so that all barangays receive a level and a normalized score; this is an extension below PAGASA’s lowest hazard band for completeness.

**Note:** PAGASA’s heat index is “feels like” temperature (temperature + humidity). Our backend uses **air temperature only** for the risk level mapping; humidity can be incorporated in a future iteration (e.g. via a heat-index formula such as NOAA’s).

---

## 2. Heat health risk in Philippine cities (scientific framework)

For the **conceptual framework** of heat hazard + exposure + vulnerability (used in the **pipeline**; the backend heat-risk API does not use density or delta):

- **Estoque, R.C., Ooba, M., Seposo, X.T., Togawa, T., Hijioka, Y., Takahashi, K., & Nakamura, S.** (2020). Heat health risk assessment in Philippine cities using remotely sensed data and social-ecological indicators. *Nature Communications*, **11**, 1581.  
  **DOI:** https://doi.org/10.1038/s41467-020-15218-8

This study assesses heat health risk in **139 Philippine cities** using the **IPCC risk framework** (hazard, exposure, vulnerability) with remotely sensed data and social-ecological indicators. It supports combining **heat hazard** (temperature) with **exposure** (e.g. population/urban density) for risk prioritization in Philippine contexts.

---

## 3. Population density / exposure (pipeline only; not in backend API)

The **pipeline** (K-Means in `ai/`) uses population density as a feature. Conceptual support:

- **Urban heat island (UHI)** and **exposure**: Denser areas tend to have higher UHI intensity and more people exposed per unit area.
- **Reid, C.E., O’Neill, M.S., Gronlund, C.J., Brines, S.J., Brown, D.G., Diez-Roux, A.V., & Schwartz, J.** (2009). Mapping community determinants of heat vulnerability. *Environmental Health Perspectives*, **117**(11), 1730–1736.  
  **DOI:** https://doi.org/10.1289/ehp.0900683

Reid et al. map community-level heat vulnerability; density as exposure/UHI proxy is consistent with Estoque et al. The **backend heat-risk API** does not use or expose density; it returns only validated outputs (score, level, label, temp_c, heat_index_c). The pipeline uses only temperature and facility score (no density). See **docs/CITED-SOURCES.md** §3–4.

---

## 4. What is validated vs heuristic

**Full verification table and primary-source checks:** **docs/VALIDITY.md** §1 (especially §1.4). Summary:

| Component | Validated by | Notes |
|-----------|--------------|--------|
| **Heat index (T + RH → apparent temp)** | **NOAA Rothfusz** (NWS SR 90-23); WPC equation page | Used when humidity is available; implemented in `src/lib/heatIndex.js`. |
| **Temperature bands & category labels** (27–32 Caution, etc.) | **PAGASA** (official pages) | Bands/labels from PAGASA. "Not Hazardous" &lt; 27°C is our extension. |
| **Input to PAGASA when RH available** | **Rothfusz HI (°C)** | Aligns with PAGASA’s definition of heat index (temperature + humidity). |
| **Risk score** | **Derived from level** | `score = (level − 1) / 4`; only validated level is used. |

**Summary:** The API returns only validated outputs (score, level, label, temp_c, heat_index_c when used). No delta, population, or density. The **score** uses only validated inputs: heat index (or air temp) → PAGASA level → score = (level−1)/4. The API reports `usedHeatIndex: true` when the validated (Rothfusz + PAGASA) path was used.

---

## 5. Independent verification of computational logic

The heat index formula and PAGASA category boundaries have been verified **against the primary sources** (NWS WPC equation page and PAGASA heat index pages), not only against this repo’s documentation. Verification includes:

- **Rothfusz equation:** Coefficients, low- and high-humidity adjustments, and simple formula for HI &lt; 80°F checked against [WPC Heat Index Equation](https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml). Implementation in `src/lib/heatIndex.js` matches.
- **Numeric spot-check:** 90°F, 90% RH → code yields 121.90°F, consistent with NWS-style calculators (~122°F).
- **PAGASA bands:** Boundaries 27–32, 33–41, 42–51, ≥52°C and category labels checked against PAGASA heat index pages; `tempToPAGASALevel` in `src/services/heatRiskModel.js` matches.

**Detailed verification table (what was checked, primary source URLs, results):** **docs/VALIDITY.md** §1.
