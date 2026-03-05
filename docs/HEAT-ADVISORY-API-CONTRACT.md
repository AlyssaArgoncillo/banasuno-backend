# Heat Advisory AI – Frontend/Backend API Contract

Use this as the single source of truth for wiring the **Heat Advisory** UI to the backend.

---

## Base URL

- **Backend base:** `https://<your-backend-host>` (e.g. `http://localhost:3000` in dev).
- **Heat Advisory endpoint base:** `/api/heat-advisory`.

---

## Endpoint for the Heat Advisory page (UrgencyTicker)

Use this for the **Safety Recommendations** block: one **tagline** and a list of **advices** (title + body).

| Method | Path | When to use |
|--------|------|-------------|
| **POST** | `/api/heat-advisory` | Preferred: send JSON body with selected zone + risk. |
| **GET** | `/api/heat-advisory` | Same contract via query params. |

All request fields are **optional**. If none are sent, backend returns an advisory for default risk (e.g. Caution).

---

## Request

### POST (recommended)

- **Content-Type:** `application/json`
- **Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `barangay_id` | string | No | PSGC code (e.g. `"1130700001"`). |
| `barangay_name` | string | No | Display name (e.g. `"Calinan"`). |
| `risk_level` | number | No | PAGASA level 1–5 (1 = Not Hazardous … 5 = Extreme Danger). |
| `risk_label` | string | No | One of: `"Not Hazardous"`, `"Caution"`, `"Extreme Caution"`, `"Danger"`, `"Extreme Danger"`. |
| `temperature_c` | number | No | Current temp °C for context (e.g. `28.5`). |

**Example:**

```json
{
  "barangay_id": "1130700001",
  "barangay_name": "Calinan",
  "risk_level": 2,
  "risk_label": "Caution",
  "temperature_c": 28.5
}
```

- If you send only `risk_level`, backend derives `risk_label` (and vice versa).  
- If you send neither, backend uses default (e.g. level 2, "Caution").

### GET (query params)

Same fields as above as query params:

- `barangay_id`, `barangay_name`, `risk_level`, `risk_label`, `temperature_c`

Example:

```
GET /api/heat-advisory?barangay_id=1130700001&barangay_name=Calinan&risk_level=2&risk_label=Caution&temperature_c=28.5
```

---

## Response (200 OK)

- **Required for UI:** `tagline` and `advices`.
- **Optional:** `risk_level`, `barangay_name`, `generated_at` (for display or caching).

**Shape:**

```json
{
  "tagline": "Heat is noticeable. Make smart choices throughout the day.",
  "advices": [
    {
      "title": "Stay Hydrated",
      "body": "At this level, your body loses water faster. Set hourly reminders and carry a water bottle."
    },
    {
      "title": "Limit Outdoor Exposure",
      "body": "Keep outdoor activities under 30 minutes during daytime. Seek shade and wear a wide-brimmed hat."
    },
    {
      "title": "Keep Your Space Cool",
      "body": "Use fans, open windows at night, and hang damp cloths near fans to cool down indoor spaces."
    }
  ],
  "risk_level": 2,
  "barangay_name": "Calinan",
  "generated_at": "2025-02-28T12:34:56.789Z"
}
```

| Field | Type | Notes |
|-------|------|--------|
| `tagline` | string | One short sentence; use as the main tagline in UrgencyTicker. |
| `advices` | array | At least 3 items. Each has `title` (string) and `body` (string). |
| `risk_level` | number | 1–5, echoed from request or derived. |
| `barangay_name` | string \| null | Echoed from request or null. |
| `generated_at` | string | ISO 8601 timestamp; optional for caching/debug. |

---

## Error response (4xx / 5xx)

On failure the backend returns JSON, e.g.:

```json
{
  "error": "Failed to generate heat advisory",
  "details": "<message>"
}
```

- **Frontend:** Show a fallback (e.g. static advisories by risk level) or an error message when status is not 2xx.

---

## PAGASA risk levels (for reference)

| risk_level | risk_label |
|------------|------------|
| 1 | Not Hazardous |
| 2 | Caution |
| 3 | Extreme Caution |
| 4 | Danger |
| 5 | Extreme Danger |

Frontend can send either `risk_level` or `risk_label`; backend normalizes to both.

---

## Caching

- Backend caches responses per `(barangay_id or "default", risk_level)` for **5 minutes**.
- Same request within the TTL returns the cached payload (same shape). No special headers required from frontend.

---

## Summary for frontend

1. **Call:** `POST /api/heat-advisory` with JSON body (or GET with query params) using `barangay_id`, `barangay_name`, `risk_level`, `risk_label`, `temperature_c` as available from the selected zone / risk selector.
2. **Use in UI:** `response.tagline` and `response.advices` (each with `title` and `body`). Render tagline and the list of 3 advices in UrgencyTicker.
3. **On error:** Use static advisories by risk level or show an error state.

This contract is implemented on the backend; frontend and backend stay aligned by following this document.
