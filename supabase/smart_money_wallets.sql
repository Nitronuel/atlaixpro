-- Smart Money wallet registry schema.
-- This table stores wallet labels, performance metadata, and scanner-derived classifications.

create table if not exists public.smart_money_wallets (
    wallet_address text primary key,
    name text not null,
    categories text[] not null default array['Smart Money']::text[],
    last_balance text,
    last_win_rate text,
    last_pnl text,
    smart_money_score integer not null default 0,
    qualification jsonb,
    source text not null default 'wallet-tracking',
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists smart_money_wallets_score_idx
    on public.smart_money_wallets (smart_money_score desc, updated_at desc);

alter table public.smart_money_wallets enable row level security;

create policy "Public can read smart money wallets"
    on public.smart_money_wallets
    for select
    using (true);

create policy "Public can insert smart money wallets"
    on public.smart_money_wallets
    for insert
    with check (true);

create policy "Public can update smart money wallets"
    on public.smart_money_wallets
    for update
    using (true)
    with check (true);

create or replace function public.set_smart_money_wallets_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists smart_money_wallets_set_updated_at on public.smart_money_wallets;

create trigger smart_money_wallets_set_updated_at
before update on public.smart_money_wallets
for each row
execute function public.set_smart_money_wallets_updated_at();

