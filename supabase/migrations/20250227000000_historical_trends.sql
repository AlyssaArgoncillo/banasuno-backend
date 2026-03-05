-- City-level historical temperature trends from WeatherAPI history.json.
-- One row per (recorded_at, city_id). Retention: backend deletes rows older than 30 days.

create table if not exists public.historical_trends (
  id bigint generated always as identity primary key,
  recorded_at date not null,
  city_id text not null,
  city_avg_temp_c numeric(5,2) not null,
  city_max_temp_c numeric(5,2),
  city_min_temp_c numeric(5,2),
  created_at timestamptz not null default now(),
  unique (recorded_at, city_id)
);

create index if not exists idx_historical_trends_city_recorded
  on public.historical_trends (city_id, recorded_at desc);

alter table public.historical_trends enable row level security;

create policy "Service role full access historical_trends"
  on public.historical_trends for all
  using (true) with check (true);
