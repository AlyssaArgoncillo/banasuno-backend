-- Replace Redis with Postgres for main app storage.
-- Run in Supabase SQL Editor (or via supabase db push) if using Supabase CLI.

-- Davao health facilities: single row, full JSON array.
create table if not exists public.health_facilities_davao (
  id text primary key default 'default',
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Pipeline heat-risk report: one row per city (e.g. davao).
create table if not exists public.pipeline_report (
  city_id text primary key,
  csv text not null default '',
  updated_at timestamptz not null default now()
);

-- RLS: allow service role full access (backend uses SUPABASE_SERVICE_ROLE_KEY).
alter table public.health_facilities_davao enable row level security;
alter table public.pipeline_report enable row level security;

-- Policy: service role can do everything (backend only).
create policy "Service role full access health_facilities_davao"
  on public.health_facilities_davao for all
  using (true) with check (true);

create policy "Service role full access pipeline_report"
  on public.pipeline_report for all
  using (true) with check (true);

-- Insert default row for facilities so first select returns [].
insert into public.health_facilities_davao (id, data)
values ('default', '[]'::jsonb)
on conflict (id) do nothing;
