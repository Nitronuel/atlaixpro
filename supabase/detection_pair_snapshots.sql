-- Historical Detection Engine pair snapshots.
-- This table is different from detected_token_snapshots:
-- detected_token_snapshots is the latest shared feed row, while this table stores
-- time-series market state for delta-based detection.

create table if not exists public.detection_pair_snapshots (
    id bigint generated always as identity primary key,
    snapshot_key text not null,
    chain text not null,
    token_address text not null,
    pair_address text,
    dex_id text,
    base_symbol text,
    quote_symbol text,
    price_usd numeric not null default 0,
    liquidity_usd numeric not null default 0,
    market_cap numeric not null default 0,
    fdv numeric not null default 0,
    volume_5m numeric,
    volume_1h numeric,
    volume_6h numeric,
    volume_24h numeric not null default 0,
    buys_5m numeric,
    sells_5m numeric,
    buys_1h numeric,
    sells_1h numeric,
    buys_6h numeric,
    sells_6h numeric,
    buys_24h numeric not null default 0,
    sells_24h numeric not null default 0,
    price_change_5m numeric,
    price_change_1h numeric,
    price_change_6h numeric,
    price_change_24h numeric,
    boosts_active numeric not null default 0,
    has_profile boolean not null default false,
    has_website boolean not null default false,
    has_socials boolean not null default false,
    source text not null default 'dexscreener',
    raw_pair jsonb not null default '{}'::jsonb,
    captured_at timestamptz not null default timezone('utc', now())
);

create index if not exists detection_pair_snapshots_lookup_idx
    on public.detection_pair_snapshots (chain, token_address, captured_at desc);

create index if not exists detection_pair_snapshots_pair_idx
    on public.detection_pair_snapshots (chain, pair_address, captured_at desc);

create index if not exists detection_pair_snapshots_captured_idx
    on public.detection_pair_snapshots (captured_at desc);

create index if not exists detection_pair_snapshots_key_idx
    on public.detection_pair_snapshots (snapshot_key, captured_at desc);

-- Prune old history and optionally cap total rows so free-tier databases do not
-- become a dumping ground for stale market state.
create or replace function public.prune_detection_pair_snapshots(
    retention_days integer default 7,
    max_rows integer default 50000
)
returns integer
language plpgsql
security definer
as $$
declare
    deleted_count integer := 0;
    deleted_old integer := 0;
    deleted_overflow integer := 0;
begin
    delete from public.detection_pair_snapshots
    where captured_at < timezone('utc', now()) - make_interval(days => greatest(retention_days, 1));

    get diagnostics deleted_old = row_count;

    if max_rows > 0 then
        with overflow as (
            select id
            from public.detection_pair_snapshots
            order by captured_at desc
            offset max_rows
        )
        delete from public.detection_pair_snapshots snapshots
        using overflow
        where snapshots.id = overflow.id;

        get diagnostics deleted_overflow = row_count;
    end if;

    deleted_count := deleted_old + deleted_overflow;
    return deleted_count;
end;
$$;

alter table public.detection_pair_snapshots enable row level security;

drop policy if exists "Detection pair snapshots are readable" on public.detection_pair_snapshots;
create policy "Detection pair snapshots are readable"
    on public.detection_pair_snapshots
    for select
    using (true);

drop policy if exists "Detection pair snapshots can be inserted by anon clients" on public.detection_pair_snapshots;
create policy "Detection pair snapshots can be inserted by anon clients"
    on public.detection_pair_snapshots
    for insert
    with check (true);
