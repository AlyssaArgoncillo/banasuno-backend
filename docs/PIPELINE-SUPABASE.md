# Moving AI pipeline CSV storage to Supabase

This doc describes how to **stop saving pipeline data as CSV files in the `ai/` folder** and instead **read input from and write the final report to Supabase**.

---

## Current flow (CSV in `ai/`)

1. **Fetch** – `fetch_pipeline_data.py` calls backend APIs and writes **`barangay_data_today.csv`** (or appends to `barangay_data.csv`). Columns: `barangay_id`, `date`, `temperature`, `facility_distance`.
2. **Pipeline** – `weighted_heat_risk_pipeline.py` reads that CSV and writes **`barangay_heat_risk_today.csv`**. Columns: `barangay_id`, `risk_level` (1–5), `cluster`.

---

## Target flow (Supabase)

1. **Fetch** – Same API calls; **insert** today’s rows into a Supabase table (e.g. `pipeline_barangay_data`) instead of (or in addition to) writing CSV.
2. **Pipeline** – **Read** input from Supabase (e.g. query `pipeline_barangay_data` for the date range), run K-Means and severity mapping, then **insert** the final report into Supabase (e.g. `pipeline_heat_risk_report`) instead of writing `barangay_heat_risk_today.csv`.

You can keep CSV as an optional export (e.g. “download latest report as CSV”) by querying Supabase and streaming CSV from the backend.

---

## Supabase tables for the pipeline

Create these in the Supabase SQL editor (or via migrations). Use the same project as `heat_snapshots`; the backend already uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. For Python you can use the same URL and key (e.g. via env or a small backend endpoint that the script calls).

### Table: `pipeline_barangay_data` (pipeline input)

Replaces `barangay_data.csv` / `barangay_data_today.csv`. One row per barangay per day.

```sql
create table public.pipeline_barangay_data (
  id uuid primary key default gen_random_uuid(),
  barangay_id text not null,
  date date not null,
  temperature numeric(4,2) not null,
  facility_distance numeric(10,6) not null,
  created_at timestamptz default now()
);

create index idx_pipeline_barangay_data_date
  on public.pipeline_barangay_data (date desc);
create index idx_pipeline_barangay_data_barangay_date
  on public.pipeline_barangay_data (barangay_id, date);
```

- **Fetch step:** `INSERT` one row per barangay for today (or use `upsert` on `(barangay_id, date)` if you run fetch more than once per day).
- **Pipeline step:** `SELECT barangay_id, date, temperature, facility_distance WHERE date >= ... ORDER BY barangay_id, date` to build the DataFrame (e.g. last 7 days for rolling, or single day for `--no-rolling`).

### Table: `pipeline_heat_risk_report` (final report)

Replaces `barangay_heat_risk_today.csv`. One row per barangay per report run (e.g. one “report date” per run).

```sql
create table public.pipeline_heat_risk_report (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  barangay_id text not null,
  risk_level int not null check (risk_level between 1 and 5),
  cluster int not null,
  created_at timestamptz default now()
);

create unique index idx_pipeline_heat_risk_report_latest
  on public.pipeline_heat_risk_report (report_date, barangay_id);
create index idx_pipeline_heat_risk_report_report_date
  on public.pipeline_heat_risk_report (report_date desc);
```

- **Pipeline step:** After computing risk levels, `INSERT` one row per barangay with `report_date = today` (or the latest date in the input). Optionally delete or mark superseded rows for the same `report_date` if you re-run.
- **Backend / dashboard:** Query `WHERE report_date = (SELECT max(report_date) FROM pipeline_heat_risk_report)` to get the latest report; optionally expose as API or CSV export.

---

## Implementation notes

1. **Credentials** – Use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (same as backend). In Python you can use `os.environ` and the official `supabase` client (`pip install supabase`), or call a small backend endpoint that does the insert/select.
2. **Fetch script** – In `fetch_pipeline_data.py`: after building `rows`, instead of (or in addition to) `df.to_csv(...)`, loop and insert into `pipeline_barangay_data` (or use the client’s bulk insert if available). Use today’s date as `date`.
3. **Pipeline script** – In `weighted_heat_risk_pipeline.py`: add a mode (e.g. `--from-supabase` and `--to-supabase`) or a separate runner that (a) loads input from Supabase into a DataFrame, (b) runs the existing pipeline logic, (c) writes results to `pipeline_heat_risk_report` instead of CSV. Reuse the same `load_data` / `prepare_features` / `run_kmeans_and_risk_levels` flow.
4. **Backward compatibility** – Keep `--input` / `--output` so local CSV remains supported for development; Supabase becomes the default or opt-in via flags/env.
5. **RLS** – If you enable RLS on these tables, allow the service role full access (or add policies that match how the backend or cron runs the pipeline).

---

## Summary

| Current (CSV in `ai/`)        | Target (Supabase)                    |
|------------------------------|--------------------------------------|
| `barangay_data_today.csv`    | `pipeline_barangay_data` (insert)    |
| `barangay_data.csv` (history)| Same table, multiple `date` values   |
| `barangay_heat_risk_today.csv` | `pipeline_heat_risk_report` (insert) |

After migration, the “final report” is the latest set of rows in `pipeline_heat_risk_report`. The backend (or an Edge Function) can serve it via API or generate CSV export from that table.
