-- Live Alpha Feed discovered token cache.
-- This table stores tokens that pass the feed qualification pipeline so reloads
-- can hydrate from Supabase instead of running a fresh discovery scan each time.

create table if not exists public.discovered_tokens (
    address text not null,
    chain text not null,
    ticker text not null,
    name text,
    price text,
    liquidity text,
    volume_24h text,
    last_seen_at timestamptz not null default timezone('utc', now()),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    raw_data jsonb not null,
    constraint discovered_tokens_address_chain_key unique (address, chain)
);

create index if not exists discovered_tokens_last_seen_idx
    on public.discovered_tokens (last_seen_at desc);

create index if not exists discovered_tokens_chain_last_seen_idx
    on public.discovered_tokens (chain, last_seen_at desc);

create index if not exists discovered_tokens_ticker_idx
    on public.discovered_tokens (ticker);

alter table public.discovered_tokens enable row level security;

drop policy if exists "Discovered tokens are readable" on public.discovered_tokens;
create policy "Discovered tokens are readable"
    on public.discovered_tokens
    for select
    using (true);

drop policy if exists "Discovered tokens can be inserted by anon clients" on public.discovered_tokens;
create policy "Discovered tokens can be inserted by anon clients"
    on public.discovered_tokens
    for insert
    with check (true);

drop policy if exists "Discovered tokens can be updated by anon clients" on public.discovered_tokens;
create policy "Discovered tokens can be updated by anon clients"
    on public.discovered_tokens
    for update
    using (true)
    with check (true);

drop policy if exists "Discovered tokens can be deleted by anon clients" on public.discovered_tokens;
create policy "Discovered tokens can be deleted by anon clients"
    on public.discovered_tokens
    for delete
    using (true);

create or replace function public.set_discovered_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists discovered_tokens_set_updated_at on public.discovered_tokens;

create trigger discovered_tokens_set_updated_at
before update on public.discovered_tokens
for each row
execute function public.set_discovered_tokens_updated_at();
