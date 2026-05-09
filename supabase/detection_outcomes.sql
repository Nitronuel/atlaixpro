-- Detection Engine outcome tracking.
-- Stores post-detection measurements so thresholds can be tuned from evidence.

create table if not exists public.detection_outcomes (
    id bigint generated always as identity primary key,
    detection_key text not null,
    chain text not null,
    token_address text not null,
    pair_address text,
    ticker text,
    event_type text not null,
    lane text,
    score numeric not null default 0,
    confidence_score numeric,
    detected_at timestamptz not null,
    measured_at timestamptz not null default timezone('utc', now()),
    horizon text not null,
    price_return_pct numeric,
    liquidity_change_pct numeric,
    volume_change_pct numeric,
    transaction_change_pct numeric,
    still_active boolean not null default true,
    raw_metrics jsonb not null default '{}'::jsonb
);

create unique index if not exists detection_outcomes_unique_idx
    on public.detection_outcomes (detection_key, horizon);

create index if not exists detection_outcomes_lookup_idx
    on public.detection_outcomes (chain, token_address, measured_at desc);

create index if not exists detection_outcomes_event_idx
    on public.detection_outcomes (event_type, horizon);

alter table public.detection_outcomes enable row level security;

drop policy if exists "Detection outcomes are readable" on public.detection_outcomes;
create policy "Detection outcomes are readable"
    on public.detection_outcomes
    for select
    using (true);

drop policy if exists "Detection outcomes can be inserted by anon clients" on public.detection_outcomes;
create policy "Detection outcomes can be inserted by anon clients"
    on public.detection_outcomes
    for insert
    with check (true);

drop policy if exists "Detection outcomes can be updated by anon clients" on public.detection_outcomes;
create policy "Detection outcomes can be updated by anon clients"
    on public.detection_outcomes
    for update
    using (true)
    with check (true);
