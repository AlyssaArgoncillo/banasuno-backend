-- Davao citizen numbers used for heat-risk SMS.
-- Numbers are loaded from the partner agency (for example the city DRRM office).
-- There is no public signup. RLS is on with no policies, so only the backend
-- service role can read or write these rows.

create table if not exists public.sms_recipients (
  id bigint generated always as identity primary key,
  phone text not null,
  city_id text not null default 'davao',
  active boolean not null default true,
  source text,
  created_at timestamptz not null default now(),
  unique (phone, city_id)
);

create index if not exists idx_sms_recipients_city_active
  on public.sms_recipients (city_id, active);

alter table public.sms_recipients enable row level security;

-- One row per successful city alert. The hourly job uses this so the same
-- barangay and risk level is not texted again on the same Manila date.
create table if not exists public.sms_alert_log (
  id bigint generated always as identity primary key,
  city_id text not null,
  alert_date date not null,
  barangay_psgc text not null,
  barangay_name text,
  risk_level integer not null,
  risk_label text,
  heat_index_c numeric(5,1),
  message text not null,
  recipient_count integer not null default 0,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

create index if not exists idx_sms_alert_log_dedupe
  on public.sms_alert_log (city_id, alert_date, barangay_psgc, risk_level, status);

alter table public.sms_alert_log enable row level security;
