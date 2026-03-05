# UI Layout and Backend Integration

This document describes how dashboard UI sections map to backend APIs. It is the single reference for the frontend and backend so both stay aligned.

---

## 3.2.1 All Barangays table – backend contract

### What the UI is

- **Table:** “ALL BARANGAYS — HEAT RISK OVERVIEW”
- **Columns:** Barangay, Temperature, Risk Level, Nearby Facilities (count), View (opens facility list for that barangay).
- **Client-side:** Search and “View All” / “Show Less” (no backend calls for these).

### Where the data comes from

| Purpose | Source | Endpoint / request | Response (relevant parts) |
|--------|--------|--------------------|----------------------------|
| Barangay list and names | GeoJSON (frontend, e.g. `fetchDavaoBoundaries()`) | — | IDs must match backend (e.g. `adm4_psgc`) |
| Temperature and risk per barangay | Backend | `GET /api/heat/davao/barangays` | `barangays[]` with `barangay_id`, `temperature_c`, `risk_level`, `risk_label`. IDs match GeoJSON. |
| Facility count per row (Nearby Facilities) | Backend | `POST /api/facilities/counts-by-barangays` | `{ "counts": { "1130700001": 3, "1130700002": 0, ... } }` |
| When user clicks **View** | Backend | `GET /api/facilities/by-barangay/:barangayId` | Same as Heat Map facility list: `{ barangayId, total, facilities[], fallback_nearest? }` |

### Request / response details

**1. Heat barangays (table rows: Barangay, Temperature, Risk Level)**

- **Request:** `GET /api/heat/davao/barangays`
- **Response:**  
  - `barangays`: array of `{ barangay_id, temperature_c, risk_level, risk_label, lat, lng, area_km2, ... }`  
  - `barangay_id` values must match GeoJSON (e.g. `adm4_psgc`) so the frontend can join with names and show the correct row.

**2. Batch facility counts (column “Nearby Facilities”)**

- **Request:** `POST /api/facilities/counts-by-barangays`  
  - Body: `{ "barangayIds": ["1130700001", "1130700002", ...] }`  
  - Use the same IDs as in `GET /api/heat/davao/barangays` (e.g. all `barangay_id` from that response).
- **Response:** `{ "counts": { "1130700001": 3, "1130700002": 0, ... } }`  
  - Key = barangay ID (string), value = number of facilities (within backend’s distance rules).

**3. View button (facility list for one barangay)**

- **Request:** `GET /api/facilities/by-barangay/:barangayId`  
  - Example: `GET /api/facilities/by-barangay/1130700001`
- **Response:** Same contract as the Heat Map facility list: `{ barangayId, total, facilities[], fallback_nearest?, message? }`.

### Summary table for backend

| Purpose | Endpoint | Request | Response |
|--------|----------|---------|----------|
| Barangay list, temps, risk | `GET /api/heat/davao/barangays` | — | `barangays[]` with `barangay_id`, `temperature_c`, `risk_level`, `risk_label` (IDs match GeoJSON) |
| Batch facility counts | `POST /api/facilities/counts-by-barangays` | `{ "barangayIds": ["id1", "id2", ...] }` | `{ "counts": { "id1": n, "id2": m, ... } }` |
| Single-barangay facilities (View) | `GET /api/facilities/by-barangay/:barangayId` | — | `{ barangayId, total, facilities[], fallback_nearest? }` |

The Dashboard “All Barangays” table depends on: heat barangays (IDs matching GeoJSON), batch facility counts via `POST /api/facilities/counts-by-barangays`, and per-barangay facility list for the View button.
