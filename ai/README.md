# AI – Weighted heat risk pipeline

This folder contains a **weighted heat risk pipeline** that uses the backend’s heat and facilities APIs as input. It combines temperature (and optional humidity), facility access, and optional 7‑day rolling averages, then assigns PAGASA-style risk levels 1–5 via K‑Means and a weighted severity score.

## Data basis

- **Temperature (and optional humidity)** – From backend: `GET /api/heat/davao/barangay-temperatures`. Optionally append daily snapshots to build history for 7‑day rolling.
- **Facility access** – From backend: `GET /api/facilities/by-barangay/:barangayId`; pipeline uses a facility score (e.g. `1 / (1 + facility_count)`) so fewer facilities → higher risk.
- **CSV** – Pipeline expects `barangay_data.csv` with columns: `barangay_id`, `date`, `temperature`, `facility_distance` (or `facility_score`). You can generate rows with `fetch_pipeline_data.py` and append them daily. Optionally, use **Supabase** for input and output instead of CSV: see **`docs/PIPELINE-SUPABASE.md`** (tables `pipeline_barangay_data`, `pipeline_heat_risk_report`).

## Setup

```bash
cd ai
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

## Test run (quick)

**Prerequisites:** Backend running (`npm start` in repo root), Redis + facilities seeded (`npm run seed:facilities`), and at least one of `WEATHER_API_KEY` or `METEOSOURCE_API_KEY` in `.env` so the heat API returns data.

**Terminal 1 – backend:**
```bash
cd path/to/banasuno-backend
npm start
```

**Terminal 2 – AI pipeline:**
```bash
cd path/to/banasuno-backend/ai
pip install -r requirements.txt
set BACKEND_URL=http://localhost:3000
python fetch_pipeline_data.py
python weighted_heat_risk_pipeline.py --input barangay_data_today.csv --no-rolling --output barangay_heat_risk_today.csv
```

On Linux/macOS use `export BACKEND_URL=http://localhost:3000` instead of `set`.

**Windows: "Python was not found"** – Use the runner script (uses `py` launcher): from repo root run **`ai\run_pipeline.cmd`** or **`.\ai\run_pipeline.ps1`**. Or run by hand: `py -m pip install -r requirements.txt`, `py fetch_pipeline_data.py`, then `py weighted_heat_risk_pipeline.py --input barangay_data_today.csv --no-rolling --output barangay_heat_risk_today.csv`. If `py` is not found, install Python from [python.org](https://www.python.org/downloads/) and tick "Add Python to PATH".

You should see: fetch writes `barangay_data_today.csv` (one row per barangay); pipeline writes `barangay_heat_risk_today.csv` with `barangay_id`, `risk_level` (1–5), `cluster`. If the heat API returns 503 (no API key), set `WEATHER_API_KEY` or `METEOSOURCE_API_KEY` in the backend `.env`.

---

## 1. Fetch data from backend APIs

Backend must be running (e.g. `npm start` in repo root). Set base URL:

```bash
# Windows PowerShell
$env:BACKEND_URL="http://localhost:3000"

# Linux/macOS
export BACKEND_URL=http://localhost:3000
```

Then run:

```bash
python fetch_pipeline_data.py
```

This writes **today’s** snapshot to `barangay_data_today.csv`. To build a 7‑day history, run this daily and append rows into `barangay_data.csv` (see script `--append` option if implemented, or concatenate manually).

## 2. Run the weighted heat risk pipeline

With a CSV that has at least one row per barangay (single day or multiple days):

```bash
python weighted_heat_risk_pipeline.py
```

- **Input:** `barangay_data.csv` (default) or path via `--input`.
- **Output:** `barangay_heat_risk_today.csv` with `barangay_id`, `risk_level` (1–5), `cluster`.

If you only have a single-day CSV (e.g. from one run of `fetch_pipeline_data.py`):

```bash
python weighted_heat_risk_pipeline.py --input barangay_data_today.csv --no-rolling --output barangay_heat_risk_today.csv
```

## Weights and clustering

- Default weights: **temperature 0.6**, **facility 0.4** (no humidity).
- K‑Means with **k = 5**; clusters are ranked by weighted severity and mapped to **PAGASA levels 1–5** (1 = lowest risk, 5 = extreme danger).

## Storing data in Supabase instead of CSV

To move pipeline input and the final report from CSV files in `ai/` to Supabase, see **`docs/PIPELINE-SUPABASE.md`**. It describes:

- Tables: **`pipeline_barangay_data`** (input: barangay_id, date, temperature, facility_distance) and **`pipeline_heat_risk_report`** (output: barangay_id, risk_level, cluster per report_date).
- How to change the fetch script to insert into Supabase and the pipeline to read from / write to Supabase while keeping CSV as an optional fallback.

## Files

| File | Purpose |
|------|--------|
| `weighted_heat_risk_pipeline.py` | Main pipeline: rolling averages (optional), scaling, K‑Means, weighted severity, risk level output. |
| `fetch_pipeline_data.py` | Fetches temperatures and facility counts from backend; writes CSV row(s) for today (or Supabase; see docs). |
| `requirements.txt` | Python dependencies (pandas, numpy, scikit-learn, requests). |
