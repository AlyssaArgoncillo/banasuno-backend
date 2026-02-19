# Data export & Supabase schema

This doc defines the contents of downloadable CSV files and the Supabase table layout. The **backend** owns persistence (writing heat snapshots to Supabase), export endpoints (e.g. CSV), and this schema. The frontend dashboard consumes the heat API and, when export is backend-backed, calls the backend for CSV or snapshot data.

---

## 1. Dashboard data (what the UI shows)

- **Today’s date / time** – snapshot moment
- **The day’s average temperature** – average of all barangay temperatures for the current snapshot (or day aggregate when stored in Supabase)
- **High-risk zone count** – counts per PAGASA heat index level: Not Hazardous, Caution, Extreme Caution, Danger, Extreme Danger
- **Historical trends** – temperature (and optionally counts) over 7 or 14 days

---

## 2. Downloadable CSV files

### 2.1 Current snapshot by barangay (primary export)

One row per barangay for the **current** heat snapshot. Matches the map and “High-Risk Zone Count” breakdown.

| Column            | Type   | Description                                      |
|-------------------|--------|--------------------------------------------------|
| `recorded_at`     | ISO8601| Snapshot date/time (e.g. `2025-02-18T10:30:00Z`) |
| `city_id`         | text   | e.g. `davao`                                    |
| `barangay_id`     | text   | PSGC code (e.g. `1130700001`)                   |
| `barangay_name`   | text   | Name from GeoJSON (`adm4_en` or `name`)         |
| `temperature_c`   | number | Temperature °C                                  |
| `heat_index_level`| int    | PAGASA level 1–5                                 |
| `heat_index_label`| text   | Not Hazardous / Caution / … / Extreme Danger    |

**Example:**

```csv
recorded_at,city_id,barangay_id,barangay_name,temperature_c,heat_index_level,heat_index_label
2025-02-18T10:30:00Z,davao,1130700001,Barangay 1,26.2,1,Not Hazardous
2025-02-18T10:30:00Z,davao,1130700002,Barangay 2,30.1,2,Caution
```

### 2.2 Snapshot summary (one row per snapshot)

One row per snapshot: date, average temp, and counts per PAGASA level. Used for “day’s average” and for historical trend CSV.

| Column                  | Type    | Description                            |
|-------------------------|---------|----------------------------------------|
| `recorded_at`           | ISO8601 | Snapshot date/time                     |
| `city_id`               | text    | e.g. `davao`                           |
| `temp_min`              | number  | Min temperature °C across barangays   |
| `temp_max`              | number  | Max temperature °C                     |
| `temp_avg`              | number  | Average temperature °C (day/snapshot)  |
| `count_not_hazardous`   | int     | Count in PAGASA level 1                |
| `count_caution`         | int     | Count in PAGASA level 2                |
| `count_extreme_caution` | int     | Count in PAGASA level 3                |
| `count_danger`          | int     | Count in PAGASA level 4                |
| `count_extreme_danger`  | int     | Count in PAGASA level 5                |

**Example:**

```csv
recorded_at,city_id,temp_min,temp_max,temp_avg,count_not_hazardous,count_caution,count_extreme_caution,count_danger,count_extreme_danger
2025-02-18T10:30:00Z,davao,24.1,32.0,27.5,120,45,12,3,0
```

### 2.3 Historical trends (optional CSV)

Same columns as **Snapshot summary**, one row per day (or per snapshot) for the selected period (e.g. last 7 or 14 days). Lets users export the data behind the “Historical Trends” graph.

---

## 3. Supabase schema

Use two tables: one for **summary** (dashboard “day’s average” and trend graph), one for **per-barangay detail** (drill-down and barangay-level CSV). Run the SQL below in the Supabase SQL editor (or migrations) to create the schema. The backend connects via `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see `src/lib/supabase.js`); `/health` reports Supabase status once these tables exist.

### 3.1 Table: `heat_snapshots` (summary)

Stores one row per snapshot. Backs “The day’s average temperature” and “High-Risk Zone Count” and the historical trend graph.

```sql
create table public.heat_snapshots (
  id uuid primary key default gen_random_uuid(),
  city_id text not null default 'davao',
  recorded_at timestamptz not null default now(),
  temp_min numeric(4,1),
  temp_max numeric(4,1),
  temp_avg numeric(4,1),
  count_not_hazardous int not null default 0,
  count_caution int not null default 0,
  count_extreme_caution int not null default 0,
  count_danger int not null default 0,
  count_extreme_danger int not null default 0,
  source text
);

create index idx_heat_snapshots_city_recorded
  on public.heat_snapshots (city_id, recorded_at desc);
```

- **source**: optional (e.g. `meteosource`, `weatherapi`).

### 3.2 Table: `heat_snapshot_barangays` (per-barangay detail)

Stores one row per barangay per snapshot. Used for “Current snapshot by barangay” CSV and for future drill-down.

```sql
create table public.heat_snapshot_barangays (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.heat_snapshots(id) on delete cascade,
  barangay_id text not null,
  barangay_name text,
  temperature_c numeric(4,1) not null,
  heat_index_level int not null check (heat_index_level between 1 and 5),
  heat_index_label text not null
);

create index idx_heat_snapshot_barangays_snapshot
  on public.heat_snapshot_barangays (snapshot_id);
create index idx_heat_snapshot_barangays_barangay
  on public.heat_snapshot_barangays (barangay_id, snapshot_id);
```

### 3.3 Row Level Security (RLS)

Enable RLS and add policies as needed (e.g. allow anonymous read for public dashboard, restrict write to backend or authenticated roles).

---

## 4. Backend flow

1. **Heat API** (`GET /api/heat/:cityId/barangay-temperatures`): when returning temperatures, the backend can also write one row to `heat_snapshots` and one row per barangay to `heat_snapshot_barangays` (using PAGASA level from temp: &lt;27 → 1, 27–32 → 2, etc.).
2. **Writing snapshots via Edge Function (optional):** To persist snapshots to Supabase, call the **heat-snapshot-writer** Edge Function (POST with `summary` + `barangays` aligned with §3.1 and §3.2). The backend does not currently include a built-in client; add a route or script that POSTs to `HEAT_SNAPSHOT_WRITER_URL` with header `x-heat-writer-key: HEAT_WRITER_KEY` when you need this. Keep the key server-side only; do not commit it.
3. **Export endpoints** (to implement):
   - `GET /api/heat/:cityId/export/barangays.csv` – latest snapshot by barangay (CSV as in §2.1).
   - `GET /api/heat/:cityId/export/summary.csv` – latest snapshot summary (one row, §2.2).
   - `GET /api/heat/:cityId/export/trends.csv?days=7` – snapshot summary rows for last N days (§2.3).
4. **Dashboard (frontend)** can:
   - Keep using the heat API for live map + counts; optionally call the backend export URL for CSV instead of building CSV client-side.
   - Read from Supabase (or a backend endpoint) for “day’s average” and Historical Trends when those are backed by stored snapshots.

CSV column names and types in this doc match the Supabase columns so exports can be generated directly from Supabase queries or from in-memory snapshot data in the backend.

**AI pipeline storage:** To store the weighted heat risk pipeline’s input and final report in Supabase instead of CSV files in `ai/`, use the tables and flow described in **`docs/PIPELINE-SUPABASE.md`** (`pipeline_barangay_data`, `pipeline_heat_risk_report`).
