# Validity and verification

Cross-checking of computations **against primary sources** and summary of what is **validated** vs **cited** vs **standard/heuristic**. For **logic flows** see **docs/LOGIC-FLOWS.md**. For **bibliography** see **docs/CITED-SOURCES.md**.

---

## 1. Independent verification (backend)

Heat index and PAGASA logic have been checked **against the primary sources below**, not only against this repo’s documentation.

### 1.1 Rothfusz heat index (NWS)

| Check | Primary source | Result |
|-------|----------------|--------|
| **Equation and coefficients** | [WPC Heat Index Equation](https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml) — NWS Technical Attachment SR 90-23 (Rothfusz, 1990) | Implementation in `src/lib/heatIndex.js` matches the published equation: HI = -42.379 + 2.04901523×T + 10.14333127×RH − 0.22475541×T×RH − 0.00683783×T² − 0.05481717×RH² + 0.00122874×T²×RH + 0.00085282×T×RH² − 0.00000199×T²×RH² (T and RH in °F). |
| **Low-humidity adjustment** | Same WPC page: if RH &lt; 13% and 80 ≤ T ≤ 112°F, **subtract** [(13−RH)/4]×√{[17−\|T−95\|]/17} | Code implements the same condition and formula; result subtracted from HI. |
| **High-humidity adjustment** | Same WPC page: if RH &gt; 85% and 80 ≤ T ≤ 87°F, **add** [(RH−85)/10]×[(87−T)/5] | Code implements the same condition and formula; result added to HI. |
| **Simple formula (HI &lt; ~80°F)** | Same WPC page: HI = 0.5×{T + 61 + (T−68)×1.2 + (RH×0.094)}; result averaged with T; if that value ≥ 80°F use full regression | Code computes simple HI, averages with T, uses full regression when averaged ≥ 80°F. |
| **Numeric spot-check** | NWS-style calculators (e.g. 90°F, 90% RH → ~122°F) | Code yields 121.90°F (49.95°C) for 90°F, 90% RH — consistent with published range. |

**Primary source:** https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml

### 1.2 PAGASA heat index categories

| Check | Primary source | Result |
|-------|----------------|--------|
| **Category boundaries (°C)** | PAGASA Heat Index ([pagasa.dost.gov.ph](https://www.pagasa.dost.gov.ph/weather/heat-index), [bagong.pagasa.dost.gov.ph](https://bagong.pagasa.dost.gov.ph/weather/heat-index)); band boundaries also reported in PNA, MB articles | Implementation in `src/services/heatRiskModel.js` (`tempToPAGASALevel`) uses: &lt;27, 27–32, 33–41, 42–51, ≥52°C with labels Caution, Extreme Caution, Danger, Extreme Danger. “Not Hazardous” for &lt;27°C is an extension; boundaries match PAGASA. |

**Primary sources:**  
https://www.pagasa.dost.gov.ph/weather/heat-index  
https://bagong.pagasa.dost.gov.ph/weather/heat-index

### 1.3 Backend risk score

The mapping **score = (level − 1) / 4** is an internal scaling choice (level 1→0, 5→1), not from NWS or PAGASA; it is applied consistently from the validated PAGASA level only.

**Engineering justification (risk score normalization):**

- **Single source of truth:** Score is a deterministic function of the validated PAGASA level only. No delta, density, or other unvalidated inputs enter the score, so the score remains auditable and tied to cited sources.
- **Interpretability:** A [0, 1] scale is standard for normalized risk (0 = lowest, 1 = highest). Downstream (UI, pipeline, APIs) can sort, filter, and visualize without re-deriving level.
- **Ordinal consistency:** PAGASA defines five ordinal categories. The linear map (level−1)/4 preserves order and spreads levels evenly; we do not claim cardinal meaning within a band.
- **Stability:** Score does not depend on city average, density, or sample composition. Same level always yields the same score; adding or removing barangays or missing density data does not change the mapping.
- **Simpler API:** The response contains only validated outputs (score, level, label, temp_c, heat_index_c when used); no delta, population, or density, so the API stays aligned with validated logic only.

### 1.4 Backend: what is validated vs heuristic

| Component | Validated by | Notes |
|-----------|--------------|--------|
| **Heat index (T + RH → apparent temp)** | **NOAA Rothfusz** (NWS SR 90-23); WPC equation page | Used when humidity is available; implemented in `src/lib/heatIndex.js`. |
| **Temperature bands & category labels** (27–32 Caution, etc.) | **PAGASA** (official pages) | Bands/labels from PAGASA. "Not Hazardous" &lt; 27°C is our extension. |
| **Input to PAGASA when RH available** | **Rothfusz HI (°C)** | Aligns with PAGASA’s definition of heat index (temperature + humidity). |
| **Risk score** | **Derived from level** | `score = (level − 1) / 4`; only validated level is used. |

The backend heat-risk API returns only validated outputs (score, level, label, temp_c, heat_index_c when used); no delta, population, or density.

---

## 2. Pipeline: validity vs documented citations and primary sources

| Component | In documented citations (CITED-SOURCES) | Checked against external/primary sources | Verdict |
|-----------|-----------------------------------------|------------------------------------------|---------|
| **Temperature / heat index input** | §1–2, §5: NOAA Rothfusz, PAGASA; pipeline uses backend `barangays` → `heat_index_c` when available. | **Yes.** WPC equation and PAGASA pages: backend formula and bands verified; pipeline consumes that backend output. | **Valid** — Input verified against NWS and PAGASA primary sources. |
| **PAGASA levels 1–5 (names and bands)** | §2: PAGASA heat index classification. | **Yes.** PAGASA and bagong PAGASA pages (and PNA/MB reporting): boundaries 27–32, 33–41, 42–51, ≥52°C and labels confirmed. | **Valid** — Bands/labels match PAGASA; pipeline maps cluster rank → 1–5 (ordinal alignment). |
| **Equal weight approach (EWA)** | §6–7: Urban Climate 2024 (Toronto), Niu et al. 2021 (HVI systematic review). | Not re-checked against those papers line-by-line; citations are the documented validation. | **Cited** — Method validated in literature; no separate primary-source re-verification of EWA formula. |
| **Facility score 1/(1+n)** | Described as standard inverse proxy; no single cited formula. | No external primary source (no agency or paper prescribing this exact form for heat risk). | **Standard proxy** — Common in access/vulnerability indices; not validated by a single source. |
| **MinMaxScaler** | Standard practice in doc. | Standard in ML/composite indices; no agency source. | **Standard** — Reproducible, well-defined. |
| **K-Means k=5, cluster→level by severity** | Reproducible design; k=5 to match PAGASA levels. | No external source that says “use k=5 for heat risk”; algorithm is standard (e.g. sklearn). | **Reproducible** — Deterministic; methodology standard; not validated by a single external source. |
| **7‑day rolling mean** | Standard smoothing in doc. | Common practice; no specific citation. | **Standard** — No separate validation. |

### 2.1 Pipeline verification summary

- **Temperature/heat index input** — Verified via backend verification above (pipeline uses backend output).
- **EWA (equal weights)** — Cited in **docs/CITED-SOURCES.md** §6–7; no separate code-level verification of the pipeline Python implementation.
- **K-Means, MinMaxScaler, cluster→level** — Standard and reproducible; documented in **docs/LOGIC-FLOWS.md** §2.

**Bottom line:** Temperature/heat index input is **verified against primary sources** (NWS WPC, PAGASA). PAGASA level names and bands are **verified against PAGASA**. EWA and use of temperature + facility are **supported by documented citations** (Urban Climate 2024, Niu et al. — **docs/CITED-SOURCES.md** §6–7). Facility score, MinMaxScaler, K-Means, and rolling mean are **standard/reproducible** but not tied to a single validating primary source.
