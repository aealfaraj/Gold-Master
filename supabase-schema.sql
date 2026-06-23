create table if not exists public.signals (
  id text primary key,
  symbol text not null,
  direction text not null,
  entry text,
  take_profit text,
  take_profit_2 text,
  stop_loss text,
  last_price text,
  status text not null default 'Active',
  type text not null default 'PRO_SIGNAL',
  timeframe text,
  pnl numeric,
  notes text,
  raw_alert jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signals_created_at_idx
  on public.signals (created_at desc);

create index if not exists signals_status_idx
  on public.signals (status);
