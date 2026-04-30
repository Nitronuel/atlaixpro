-- Smart Money scanner job and wallet result tables.
-- These tables persist scanner progress, qualification counts, and wallet-level evidence.

create table if not exists public.smart_money_scan_jobs (
    id text primary key,
    token_address text not null,
    chain text not null,
    status text not null,
    created_at_ms bigint not null,
    updated_at_ms bigint not null,
    scan_limit integer not null default 100,
    buyers_found integer not null default 0,
    wallets_queued integer not null default 0,
    wallets_scanned integer not null default 0,
    qualified_count integer not null default 0,
    failed_count integer not null default 0,
    error text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.smart_money_scan_wallets (
    id text primary key,
    token_job_id text not null references public.smart_money_scan_jobs(id) on delete cascade,
    wallet text not null,
    source_token text not null,
    chain text not null,
    status text not null,
    created_at_ms bigint not null,
    updated_at_ms bigint not null,
    first_seen_at text,
    tx_hash text,
    net_worth text,
    win_rate text,
    pnl text,
    active_positions text,
    profitable_positions text,
    score integer,
    qualification jsonb,
    buyer_usd_value numeric,
    pair_address text,
    exchange text,
    source text,
    confidence text,
    error text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists smart_money_scan_jobs_created_idx on public.smart_money_scan_jobs (created_at_ms desc);

create index if not exists smart_money_scan_wallets_job_idx on public.smart_money_scan_wallets (token_job_id, created_at_ms desc);

create index if not exists smart_money_scan_wallets_wallet_idx on public.smart_money_scan_wallets (lower(wallet));

alter table public.smart_money_scan_wallets
    add column if not exists process_status text,
    add column if not exists decision text,
    add column if not exists wallet_type text,
    add column if not exists intelligence_confidence text,
    add column if not exists discovery_source text,
    add column if not exists source_token_symbol text,
    add column if not exists source_token_name text,
    add column if not exists first_buy_usd numeric,
    add column if not exists first_buy_amount_raw text,
    add column if not exists first_seen_tx text,
    add column if not exists net_worth_usd numeric,
    add column if not exists realized_pnl_usd numeric,
    add column if not exists unrealized_pnl_usd numeric,
    add column if not exists total_pnl_usd numeric,
    add column if not exists pnl_pct numeric,
    add column if not exists win_rate_pct numeric,
    add column if not exists capital_efficiency numeric,
    add column if not exists avg_buy_usd numeric,
    add column if not exists trades_analyzed integer,
    add column if not exists winning_trades integer,
    add column if not exists losing_trades integer,
    add column if not exists tokens_traded integer,
    add column if not exists days_active numeric,
    add column if not exists last_active_at text,
    add column if not exists score_total integer,
    add column if not exists score_profitability integer,
    add column if not exists score_consistency integer,
    add column if not exists score_timing integer,
    add column if not exists score_capital_efficiency integer,
    add column if not exists score_risk_adjusted integer,
    add column if not exists reason_codes text[],
    add column if not exists risk_flags text[],
    add column if not exists decision_summary text,
    add column if not exists saved_to_tracker boolean,
    add column if not exists action_taken text;

create index if not exists smart_money_scan_wallets_decision_idx
    on public.smart_money_scan_wallets (decision, score_risk_adjusted desc, updated_at_ms desc);

create index if not exists smart_money_scan_wallets_export_idx
    on public.smart_money_scan_wallets (token_job_id, decision, intelligence_confidence, score_risk_adjusted desc);

alter table public.smart_money_scan_jobs enable row level security;
alter table public.smart_money_scan_wallets enable row level security;

create policy "Public can read smart money scanner jobs"
    on public.smart_money_scan_jobs
    for select
    using (true);

create policy "Public can insert smart money scanner jobs"
    on public.smart_money_scan_jobs
    for insert
    with check (true);

create policy "Public can update smart money scanner jobs"
    on public.smart_money_scan_jobs
    for update
    using (true)
    with check (true);

create policy "Public can delete smart money scanner jobs"
    on public.smart_money_scan_jobs
    for delete
    using (true);

create policy "Public can read smart money scanner wallets"
    on public.smart_money_scan_wallets
    for select
    using (true);

create policy "Public can insert smart money scanner wallets"
    on public.smart_money_scan_wallets
    for insert
    with check (true);

create policy "Public can update smart money scanner wallets"
    on public.smart_money_scan_wallets
    for update
    using (true)
    with check (true);

create policy "Public can delete smart money scanner wallets"
    on public.smart_money_scan_wallets
    for delete
    using (true);

create or replace function public.set_smart_money_scanner_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists smart_money_scan_jobs_set_updated_at on public.smart_money_scan_jobs;
create trigger smart_money_scan_jobs_set_updated_at
before update on public.smart_money_scan_jobs
for each row
execute function public.set_smart_money_scanner_updated_at();

drop trigger if exists smart_money_scan_wallets_set_updated_at on public.smart_money_scan_wallets;
create trigger smart_money_scan_wallets_set_updated_at
before update on public.smart_money_scan_wallets
for each row
execute function public.set_smart_money_scanner_updated_at();
