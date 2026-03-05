# OpenRouteService Directions API – Frontend spec (copy-paste)

I already have OpenRouteService set up on the **backend**. Implement route visualization between the selected barangay and the clicked health facility by calling **our backend** (do not call OpenRouteService from the client).

---

## Requirements

1. When the user clicks **"Show Route"** on a facility card, request the road-based route from the **backend** (do not call OpenRouteService from the client).
2. Support **walking, driving, and biking** via a dropdown: `foot-walking`, `driving-car`, `cycling-regular`.
3. Draw the route on the map with a **Leaflet polyline**, color **#FF9559**, **4px** thickness.
4. Add a **start marker** (e.g. 📍) at the barangay center and an **end marker** (e.g. 🏥) at the facility.
5. In the facility card, show **distance (km)** and **estimated travel time (minutes)** from the route response.
6. **Fit map bounds** so the full route (and markers) is visible.
7. When a route is active for that facility, **highlight the facility card** (e.g. left border).
8. **Clear the previous route** (and card highlight) when a new "Show Route" is used or when selection changes.

---

## Backend endpoint

**POST** `<backend-base>/api/ors/directions`

Example: `POST https://your-backend.vercel.app/api/ors/directions` (replace with your actual backend URL).

---

## Request body

| Field     | Type                          | Required | Description                                                                 |
|-----------|-------------------------------|----------|-----------------------------------------------------------------------------|
| `start`   | `[lng, lat]` or `{ lng, lat }` | Yes      | Barangay center (start).                                                    |
| `end`     | `[lng, lat]` or `{ lng, lat }` | Yes      | Facility location (end).                                                   |
| `profile` | string                        | No       | `driving-car` \| `foot-walking` \| `cycling-regular`. Default: `driving-car`. |

**Example request:**

```json
{
  "start": [125.4553, 7.1907],
  "end": [125.46, 7.19],
  "profile": "foot-walking"
}
```

---

## Response (200)

GeoJSON from OpenRouteService (unchanged):

- **type:** `"FeatureCollection"`
- **features:** Array of route features. Use the first feature:
  - **geometry:** LineString → `features[0].geometry.coordinates` (array of `[lng, lat]`) to draw the polyline.
  - **properties.summary:** `distance` (metres), `duration` (seconds) → convert to km and minutes for the card.

---

## Frontend implementation

1. **Route service:** `POST <backend>/api/ors/directions` with `{ start, end, profile }`; return the JSON.
2. **Map:** Draw the route with Leaflet from `features[0].geometry.coordinates` (polyline #FF9559, 4px); add start/end markers; fit bounds to the line (or to markers + line).
3. **Facility card:** "Show Route" button; profile dropdown; display distance (km) and time (min) from `summary`; left-border highlight when this facility's route is active; clear route/highlight when another route is shown or selection changes.

---

## Errors

- **400** – Invalid or missing `start`/`end`.
- **502** – Backend/ORS error.
- **503** – Backend not configured (e.g. missing `OPEN_ROUTE_API_KEY`).

---

## Profile options

| profile            | Use case   |
|--------------------|------------|
| `driving-car`      | Car route  |
| `foot-walking`     | Walking    |
| `cycling-regular`  | Biking     |

Same key as batch travel times: `OPEN_ROUTE_API_KEY` in backend `.env`.
