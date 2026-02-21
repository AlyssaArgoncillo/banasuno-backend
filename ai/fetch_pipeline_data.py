#!/usr/bin/env python3
"""
Fetch data from backend APIs for the weighted heat risk pipeline.

- GET /api/heat/davao/barangays → per-barangay temp + risk (heat_index_c when available)
- POST /api/facilities/counts-by-barangays → facility count per barangay

Writes CSV with columns: barangay_id, date, temperature, facility_distance.
temperature: heat index °C when backend returns it (validated); else air temp °C.
facility_distance = 1/(1+facility_count).

Requires: BACKEND_URL (e.g. http://localhost:3000)
"""

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests


def get_barangay_heat_data(base_url: str, timeout: int = 120) -> tuple[dict[str, float], bool, str]:
    """
    Fetch GET /api/heat/davao/barangays. Uses heat_index_c when present (validated), else temp_c.
    Returns (barangay_id -> temperature value, used_heat_index, temperatures_source).
    """
    url = f"{base_url.rstrip('/')}/api/heat/davao/barangays"
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    items = data.get("barangays") or []
    out: dict[str, float] = {}
    used_hi = False
    for b in items:
        bid = b.get("barangay_id")
        if not bid:
            continue
        risk = b.get("risk") or {}
        temp_c = b.get("temp_c")
        hi = risk.get("heat_index_c")
        if isinstance(hi, (int, float)):
            out[str(bid)] = float(hi)
            used_hi = True
        elif isinstance(temp_c, (int, float)):
            out[str(bid)] = float(temp_c)
    meta = data.get("meta") or {}
    temperatures_source = meta.get("temperaturesSource") or "weatherapi"
    return out, used_hi, temperatures_source


def get_facility_count(base_url: str, barangay_id: str) -> int:
    """Fetch facility count for one barangay."""
    url = f"{base_url.rstrip('/')}/api/facilities/by-barangay/{barangay_id}"
    r = requests.get(url, timeout=15)
    if r.status_code == 404:
        return 0
    r.raise_for_status()
    data = r.json()
    return int(data.get("total") or 0)


def get_facility_counts_batch(base_url: str, barangay_ids: list[str], timeout: int = 60) -> dict[str, int]:
    """Fetch facility counts for many barangays in one request (faster). Returns { barangay_id: count }."""
    url = f"{base_url.rstrip('/')}/api/facilities/counts-by-barangays"
    r = requests.post(url, json={"barangayIds": list(barangay_ids)}, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    counts = data.get("counts") or {}
    return {str(k): int(v) for k, v in counts.items()}


def facility_count_to_distance(facility_count: int) -> float:
    """Convert facility count to a risk proxy: fewer facilities = higher value (like distance)."""
    return 1.0 / (1.0 + facility_count)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch heat + facilities data from backend for AI pipeline")
    parser.add_argument(
        "--output",
        default="barangay_data_today.csv",
        help="Output CSV path (today's snapshot)",
    )
    parser.add_argument(
        "--append",
        metavar="CSV",
        help="Append today's rows to this CSV (e.g. barangay_data.csv) for rolling history",
    )
    parser.add_argument(
        "--backend",
        default=os.environ.get("BACKEND_URL", "http://localhost:3000"),
        help="Backend base URL (default: BACKEND_URL or http://localhost:3000)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="Timeout in seconds for heat API (default 120; increase if per-barangay fetch is slow)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=20,
        help="Concurrent requests for facility counts (default 20)",
    )
    args = parser.parse_args()

    base_url = args.backend.rstrip("/")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    print(f"Requesting heat data from {base_url} (timeout={args.timeout}s) ...", flush=True)
    temperatures: dict[str, float] = {}
    used_heat_index = False
    temperatures_source = ""
    try:
        temperatures, used_heat_index, temperatures_source = get_barangay_heat_data(base_url, timeout=args.timeout)
    except requests.RequestException as e:
        print(f"Error fetching heat data: {e}", file=sys.stderr)
        return 1

    if not temperatures:
        print("No barangay temperatures returned from API.", file=sys.stderr)
        return 1

    print("  Using temperatures from GET /api/heat/davao/barangays.", flush=True)
    if used_heat_index:
        print("  Heat index (validated) used as temperature.", flush=True)

    n = len(temperatures)
    barangay_ids = list(temperatures.keys())

    # Prefer batch endpoint (1 request); fall back to parallel per-barangay requests
    facility_counts: dict[str, int] = {}
    try:
        print(f"Fetched temperatures for {n} barangays. Fetching facility counts (batch)...", flush=True)
        facility_counts = get_facility_counts_batch(base_url, barangay_ids)
        if len(facility_counts) < n:
            for bid in barangay_ids:
                if bid not in facility_counts:
                    facility_counts[bid] = 0
    except requests.RequestException as e:
        print(f"  Batch not available ({e}), using {args.workers} parallel requests...", flush=True)
        def fetch_one(bid: str) -> tuple[str, int]:
            try:
                return (bid, get_facility_count(base_url, bid))
            except requests.RequestException:
                return (bid, 0)

        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(fetch_one, bid): bid for bid in barangay_ids}
            for future in as_completed(futures):
                barangay_id, count = future.result()
                facility_counts[barangay_id] = count
                done += 1
                if done % 50 == 0 or done == n:
                    print(f"  {done}/{n} facility counts...", flush=True)

    rows = [
        {
            "barangay_id": barangay_id,
            "date": today,
            "temperature": round(temp, 2),
            "facility_distance": round(facility_count_to_distance(facility_counts.get(barangay_id, 0)), 6),
        }
        for barangay_id, temp in temperatures.items()
    ]

    df = pd.DataFrame(rows)

    if args.append:
        append_path = Path(args.append)
        if append_path.exists():
            existing = pd.read_csv(append_path)
            for c in df.columns:
                if c not in existing.columns:
                    existing[c] = pd.NA
            df = pd.concat([existing, df], ignore_index=True)
        df.to_csv(append_path, index=False)
        print(f"Appended {len(rows)} rows to {append_path}", flush=True)
    else:
        df.to_csv(args.output, index=False)
        print(f"Wrote {len(rows)} rows to {args.output}", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
