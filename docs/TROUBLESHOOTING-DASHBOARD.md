# Dashboard troubleshooting – backend and frontend

This doc explains the issues you saw and how they are fixed or handled.

---

## 1. Backend: OpenRoute 429 (Too Many Requests)

**What you see:**  
`[assessFacilitiesInBarangay] OpenRoute failed, using straight-line fallback: OpenRoute matrix failed: 429`

**What it means:**  
- The backend calls **OpenRouteService (ORS)** to get driving distance/time from a barangay to nearby facilities.
- **429** = ORS rate limit: too many requests in a short time.
- This used to happen when many barangays were processed (e.g. All Barangays table or batch facility counts).

**What’s implemented (recommended approach):**  
1. **Batch counts use straight-line only**  
   - `POST /api/facilities/counts-by-barangays` now calls `assessFacilitiesInBarangay(..., { skipOrs: true })`.  
   - No ORS calls for the “Nearby Facilities” count column, so loading All Barangays no longer triggers 100+ ORS requests and 429s.

2. **Single-barangay lookups are cached**  
   - `GET /api/facilities/by-barangay/:id` (and any other call that uses ORS) uses a **5‑minute in-memory cache** per barangay.  
   - Repeated requests for the same barangay within 5 minutes return the cached result and do not call ORS again.

3. **Fallback when ORS fails**  
   - If ORS is called and returns 429 or any error, the backend still falls back to straight-line distance (Haversine). The app keeps working with `distance_meters` (and `travel_time_seconds` when ORS succeeds).

**If you still see 429:**  
- It can only come from single-barangay “View” requests (e.g. many users or rapid clicks on different barangays). Optionally reduce how often the frontend calls `GET /api/facilities/by-barangay/:id`, or rely on the 5‑min cache for repeat visits to the same barangay.

---

## 2. Frontend: “backend provided min/max: no, using derived”

**What you see:**  
`[fetchBarangayTemperatures] Temp range: min= 19 max= 31.9 (backend provided min/max: no, using derived)`

**What it means:**  
- The heat map needs a temperature range (min/max) for the legend.
- The frontend was only checking for **top-level** `min` and `max` on the response.
- The backend was only sending **`meta.temperature_min_c`** and **`meta.temperature_max_c`**, so the frontend thought “backend provided min/max: no” and derived min/max from the barangay list.

**Backend fix (done):**  
- The response of **`GET /api/heat/davao/barangays`** now includes **top-level** `min` and `max` (same values as `meta.temperature_min_c` and `meta.temperature_max_c`).
- Example: `{ "barangays": [...], "meta": { ..., "temperature_min_c": 19, "temperature_max_c": 31.9 }, "min": 19, "max": 31.9 }`

**Frontend:**  
- Prefer reading **`response.min`** and **`response.max`** for the legend so “backend provided min/max: yes” and you don’t need to derive.  
- You can still fall back to deriving from `barangays` if `min`/`max` are null.

---

## 3. Frontend: React duplicate key “26”

**What you see:**  
`Encountered two children with the same key, 26. Keys should be unique...` at `Dashboard.jsx:1174`

**What it means:**  
- In a list (e.g. `.map()`), React requires each child to have a **unique `key`**.
- Something at that line is using a **non-unique key** (e.g. the number `26`). Often that’s:
  - `risk_level` (e.g. two rows with risk_level 2),
  - or an index/count that repeats,
  - or another numeric field that isn’t unique per item.

**Fix (frontend only):**  
- In **Dashboard.jsx** around line 1174, find the list that renders with `key={...}`.
- Use a key that is **unique per item**, for example:
  - `key={\`${risk_level}-${risk_label}-${index}\`}`  
  - or `key={\`${item.id}-${index}\`}`  
  - or `key={barangay_id}` for barangay rows.  
- Do **not** use only `key={risk_level}` or `key={26}` if more than one item can share that value.

---

## 4. All Barangays: facility count vs View count mismatch

**What you see:**  
- In the All Barangays table, one column shows e.g. **"3 facilities"** for a barangay.
- When the user clicks **View** for that barangay, the modal/list shows **27 facilities** (or a different number).

**What it means:**  
- The **count** and the **View** list can come from different logic or limits.
- Count might be "facilities within 10 km" (e.g. 3) while View might return "nearest 10" or "all within 10 km" (e.g. 27 if many are within 10 km).

**Backend (fixed):**  
- **`POST /api/facilities/counts-by-barangays`** uses `assessFacilitiesInBarangay(..., { skipOrs: true })`: facilities within 2 km, else 5 km, else 10 km (straight-line). Count = length of that list.
- **`GET /api/facilities/by-barangay/:id`** now uses the **same** options: `assessFacilitiesInBarangay(..., { skipOrs: true })`, so the list returned is exactly what was counted. When count is 0, View returns up to 10 nearest (with `fallback_nearest: true`). Response includes **`total_label`** (e.g. `"1 facility"`, `"3 facilities"`).
- Previously, counts used straight-line and View used ORS (driving) when available, so count (e.g. 3) and list (e.g. 1) could disagree; both now use straight-line so they match.

**Frontend:**  
- Use **"1 facility"** (not "1 facilties") when `total === 1`. Prefer `response.total_label` from the backend when present.

---

## Summary

| Issue | Where | Status |
|-------|--------|--------|
| OpenRoute 429 | Backend (ORS rate limit) | Handled by straight-line fallback; optional: cache or fewer calls. |
| “backend provided min/max: no” | Backend + frontend | Backend now sends top-level `min`/`max`; frontend should use `response.min`/`response.max`. |
| Duplicate key `26` | Frontend (Dashboard.jsx) | Use a unique key per item in the list at line 1174 (e.g. composite key or stable id). |
| Facility count vs View | Backend | Both endpoints now use `skipOrs: true` (straight-line); count = length of list. Backend returns `total_label` for "1 facility" / "N facilities". |
| Bar measurement in All Barangays | Frontend | Remove the small horizontal bar next to temperature in the All Barangays section (or keep; backend does not send it). |
| Heat label/color vs temperature | Backend | Ensure `risk_level`/`risk_label` in heat_risk_counts and GET barangays use PAGASA bands (27–32°C = Caution). |
