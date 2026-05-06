-- Shared Detection Engine token snapshots.
-- This is the common server-side pot that every browser reads from.

create table if not exists public.detected_token_snapshots (
    detection_key text primary key,
    chain text not null,
    token_address text not null,
    pair_address text,
    ticker text not null,
    name text,
    image_url text,
    price text,
    price_change_1h numeric not null default 0,
    price_change_24h numeric not null default 0,
    volume_24h numeric not null default 0,
    liquidity numeric not null default 0,
    market_cap numeric not null default 0,
    buys_24h numeric not null default 0,
    sells_24h numeric not null default 0,
    buy_volume_24h numeric not null default 0,
    sell_volume_24h numeric not null default 0,
    score numeric not null default 0,
    severity text not null,
    event_type text not null,
    triggers jsonb not null default '[]'::jsonb,
    summary text,
    metrics jsonb not null default '{}'::jsonb,
    first_detected_at timestamptz not null default timezone('utc', now()),
    last_refreshed_at timestamptz not null default timezone('utc', now()),
    last_provider_status text not null default 'ok',
    raw_event jsonb not null
);

create index if not exists detected_token_snapshots_score_idx
    on public.detected_token_snapshots (score desc);

create index if not exists detected_token_snapshots_refreshed_idx
    on public.detected_token_snapshots (last_refreshed_at desc);

create index if not exists detected_token_snapshots_chain_event_idx
    on public.detected_token_snapshots (chain, event_type);

create index if not exists detected_token_snapshots_token_idx
    on public.detected_token_snapshots (chain, token_address);

alter table public.detected_token_snapshots enable row level security;

drop policy if exists "Detected token snapshots are readable" on public.detected_token_snapshots;
create policy "Detected token snapshots are readable"
    on public.detected_token_snapshots
    for select
    using (true);

drop policy if exists "Detected token snapshots can be inserted by anon clients" on public.detected_token_snapshots;
create policy "Detected token snapshots can be inserted by anon clients"
    on public.detected_token_snapshots
    for insert
    with check (true);

drop policy if exists "Detected token snapshots can be updated by anon clients" on public.detected_token_snapshots;
create policy "Detected token snapshots can be updated by anon clients"
    on public.detected_token_snapshots
    for update
    using (true)
    with check (true);
