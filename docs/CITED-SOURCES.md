# Cited sources – Heat Risk Model and Pipeline

All sources used to validate or support the **Heat Risk Model** (`src/services/heatRiskModel.js`) and the **weighted heat risk pipeline** (`ai/weighted_heat_risk_pipeline.py`, K-Means clustering), with links and DOIs where available.

**Logic flows:** **docs/LOGIC-FLOWS.md** · **Validity and verification:** **docs/VALIDITY.md** · **Disclaimers:** **docs/DISCLAIMERS.md**

---

## Heat Risk Model (backend)

### 1. Heat index formula (validated)

| Item | Details |
|------|--------|
| **What** | NOAA / NWS Rothfusz regression for apparent temperature (heat index) |
| **Citation** | National Weather Service Technical Attachment **SR 90-23** (Lans P. Rothfusz, 1990). |
| **URL** | https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml |
| **DOI** | None (U.S. government technical document) |
| **Use** | When humidity is available, heat index is computed with this formula; result is used as input to PAGASA categories. Implemented in `src/lib/heatIndex.js`. |

---

### 2. Temperature bands and risk categories (validated)

| Item | Details |
|------|--------|
| **What** | PAGASA heat index classification (categories and °C bands) |
| **Citation** | PAGASA (Philippine Atmospheric, Geophysical and Astronomical Services Administration) – Heat Index. |
| **URLs** | https://www.pagasa.dost.gov.ph/weather/heat-index  
| | https://bagong.pagasa.dost.gov.ph/weather/heat-index |
| **DOI** | None (official agency page) |
| **Use** | Risk levels 1–5 and labels (Not Hazardous &lt;27°C; Caution 27–32°C; Extreme Caution 33–41°C; Danger 42–51°C; Extreme Danger ≥52°C). We add "Not Hazardous" for &lt;27°C. |

---

### 3. Heat health risk framework – Philippine cities (conceptual)

**Why cite conceptual sources (§3–4):** The backend heat-risk API returns only validated outputs (score, level, label, temp_c, heat_index_c). Estoque and Reid are cited for **conceptual context** (hazard + exposure + vulnerability) only. The pipeline uses only temperature and facility score (no density). They do not validate the backend score.

| Item | Details |
|------|--------|
| **What** | Heat health risk assessment using hazard, exposure, vulnerability (IPCC-style) |
| **Citation** | Estoque, R.C., Ooba, M., Seposo, X.T., Togawa, T., Hijioka, Y., Takahashi, K., & Nakamura, S. (2020). Heat health risk assessment in Philippine cities using remotely sensed data and social-ecological indicators. *Nature Communications*, **11**, 1581. |
| **DOI** | **10.1038/s41467-020-15218-8** |
| **URL** | https://doi.org/10.1038/s41467-020-15218-8 |
| **Use** | Conceptual support for hazard + exposure + vulnerability. Not used in pipeline (pipeline uses temp + facility only); backend API does not expose delta/density. |

---

### 4. Community heat vulnerability (conceptual)

| Item | Details |
|------|--------|
| **What** | Mapping community determinants of heat vulnerability |
| **Citation** | Reid, C.E., O'Neill, M.S., Gronlund, C.J., Brines, S.J., Brown, D.G., Diez-Roux, A.V., & Schwartz, J. (2009). Mapping community determinants of heat vulnerability. *Environmental Health Perspectives*, **117**(11), 1730–1736. |
| **DOI** | **10.1289/ehp.0900683** |
| **URL** | https://doi.org/10.1289/ehp.0900683 |
| **Use** | Conceptual support for density/urban factors in vulnerability. Not used in pipeline (pipeline uses temp + facility only); backend heat-risk API does not expose it. |

---

## Pipeline (K-Means clustering)

### 5. Temperature input (validated when heat index used)

Same as **§1** (NOAA Rothfusz) and **§2** (PAGASA). The pipeline uses temperature (or heat index when the backend provides it) from the same backend APIs; when the fetch script gets `heat_index_c` from `barangays`, that value is validated by §1 and §2.

---

### 6. Equal weight approach for vulnerability indices (validated)

| Item | Details |
|------|--------|
| **What** | Equal weight method for heat vulnerability index; comparison with PCA |
| **Citation** | Spatial distribution of heat vulnerability in Toronto, Canada. *Urban Climate*, **54**, 101838 (2024). |
| **DOI** | **10.1016/j.uclim.2024.101838** |
| **URL** | https://doi.org/10.1016/j.uclim.2024.101838 |
| **Use** | Validates equal weight approach (EWA) for composite heat vulnerability; similar results to PCA, simpler and reproducible. Pipeline uses EWA (1/2 each for temp and facility_score). |

---

### 7. Systematic review – Heat Vulnerability Index methods (supporting EWA)

| Item | Details |
|------|--------|
| **What** | Systematic review of HVI development: factors, methods, spatial units |
| **Citation** | Niu, Y. et al. (2021). A Systematic Review of the Development and Validation of the Heat Vulnerability Index: Major Factors, Methods, and Spatial Units. *Current Climate Change Reports*, **7**, 87–97. |
| **DOI** | **10.1007/s40641-021-00173-3** |
| **URL** | https://doi.org/10.1007/s40641-021-00173-3  
| **PMC** | PMC8531084 (https://pmc.ncbi.nlm.nih.gov/articles/PMC8531084/) |
| **Use** | Context for HVI methods and validation; supports use of simple, reproducible weighting (e.g. EWA). |

---

## Summary table

| # | Source | Used in | DOI | URL |
|---|--------|--------|-----|-----|
| 1 | NOAA Rothfusz (NWS SR 90-23) | Heat model, pipeline temp | — | https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml |
| 2 | PAGASA heat index | Heat model, pipeline levels | — | https://www.pagasa.dost.gov.ph/weather/heat-index |
| 3 | Estoque et al. 2020 | Conceptual (heat model) | 10.1038/s41467-020-15218-8 | https://doi.org/10.1038/s41467-020-15218-8 |
| 4 | Reid et al. 2009 | Conceptual (heat model) | 10.1289/ehp.0900683 | https://doi.org/10.1289/ehp.0900683 |
| 5 | (Same as 1–2) | Pipeline temperature | — | — |
| 6 | Toronto heat vulnerability (Urban Climate 2024) | Pipeline EWA | 10.1016/j.uclim.2024.101838 | https://doi.org/10.1016/j.uclim.2024.101838 |
| 7 | Niu et al. 2021 (Current Climate Change Reports) | Pipeline EWA context | 10.1007/s40641-021-00173-3 | https://doi.org/10.1007/s40641-021-00173-3 |

---

**Note:** The backend heat-risk API returns only validated outputs (score, level, label, temp_c, heat_index_c when used). Estoque and Reid are cited for the pipeline’s use of density and for conceptual context; they do not supply the backend formula. The pipeline uses temperature and facility score with EWA (1/2 each); facility score `1/(1+n)` is a standard inverse proxy.

**Independent verification and validity cross-checking:** **docs/VALIDITY.md**
