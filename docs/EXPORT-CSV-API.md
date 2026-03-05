# Export CSV – API contract (KPI strip & Historical Trends)

Backend support for the two dashboard “Export CSV” actions. Frontend should call these URLs with the selected date/options and trigger a file download (e.g. open in new tab or `fetch` + blob download).

---

## 1. KPI strip – “Export CSV” (city heat / risk counts)

**Endpoint:** `GET /api/heat/export/city`

**Query parameters:**

| Parameter   | Type   | Required | Description |
|------------|--------|----------|-------------|
| `date`     | string | No       | `YYYY-MM-DD`. Default: today (UTC). |
| `city_id`  | string | No       | City ID, e.g. `davao`. Default: `davao`. |

**Example:**

```http
GET /api/heat/export/city?date=2025-02-28&city_id=davao
```

**Response:**

- **Content-Type:** `text/csv; charset=utf-8`
- **Content-Disposition:** `attachment; filename="heat_risk_city_avg_YYYY-MM-DD.csv"`  
  (the date in the filename is the requested `date` or today)

**CSV columns:**

| Column         | Description |
|----------------|-------------|
| `city_id`      | City identifier (e.g. davao). |
| `recorded_at`  | Timestamp/date of the city average (may be null if no city_temperatures row for that date). |
| `risk_level`   | PAGASA level 1–5. |
| `risk_label`   | Not Hazardous, Caution, Extreme Caution, Danger, Extreme Danger. |
| `total`        | Count of barangays in that risk level for the date. |
| `avg_temp_c`   | City average temperature (°C) for the date (same on each row; may be null). |

**Frontend:** Call this URL with the user’s selected date (and optional `city_id`), then trigger download (e.g. set `window.location`, open in new tab, or fetch and create blob URL). Use the same date in any in-app label (e.g. “Heat risk city avg 2025-02-28”).

---

## 2. Historical Trends – “Export CSV”

**Endpoint:** `GET /api/historical-trends/export`

**Query parameters:**

| Parameter   | Type   | Required | Description |
|------------|--------|----------|-------------|
| `city_id`  | string | No       | City ID, e.g. `davao`. Default: `davao`. |
| `days`     | number | No       | `7` or `14` (number of days of data). If omitted, uses `limit` default 14. |
| `limit`    | number | No       | Max rows (1–90). Used when `days` is not 7 or 14. Default: 14. |
| `date`     | string | No       | `YYYY-MM-DD`. Used only for the filename; data is still last N days. Default: today. |

**Example:**

```http
GET /api/historical-trends/export?city_id=davao&days=14&date=2025-02-28
```

**Response:**

- **Content-Type:** `text/csv; charset=utf-8`
- **Content-Disposition:** `attachment; filename="historical_trends_YYYY-MM-DD.csv"`  
  (the date in the filename is the requested `date` or today)

**CSV columns:**

| Column              | Description |
|---------------------|-------------|
| `recorded_at`        | Date of the record (YYYY-MM-DD). |
| `city_id`           | City identifier (e.g. davao). |
| `city_avg_temp_c`   | City average temperature (°C) that day. |
| `city_max_temp_c`   | City max temperature (°C) that day (optional). |
| `city_min_temp_c`   | City min temperature (°C) that day (optional). |
| `rolling_7d_avg_c`  | 7-day rolling average °C ending that day (optional). |
| `rolling_14d_avg_c` | 14-day rolling average °C ending that day (optional). |

**Frontend:** Call this URL with the same `city_id`, `days` (or `limit`) and optional `date` the user has selected in the Historical Trends section, then trigger download. Use the same `date` in any in-app label (e.g. “Historical trends 2025-02-28”).

---

## Summary

| UI location           | Endpoint                         | Main query params              | Filename |
|-----------------------|----------------------------------|--------------------------------|----------|
| KPI strip Export CSV  | `GET /api/heat/export/city`      | `date`, `city_id`              | `heat_risk_city_avg_YYYY-MM-DD.csv` |
| Historical Trends CSV | `GET /api/historical-trends/export` | `city_id`, `days`, `date`  | `historical_trends_YYYY-MM-DD.csv` |

Both endpoints return CSV with `Content-Disposition: attachment` so the browser can open or save the file. On 4xx/5xx the backend returns JSON error; frontend should handle that and optionally show a message or fallback.
