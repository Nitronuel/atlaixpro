-- Detection Engine token impact timeline cache.
-- Stores filtered, high-value token impact events so every user sees warmed
-- timelines instead of starting from a blank browser session.

create table if not exists public.token_impact_events (
    event_key text primary key,
    chain text not null,
    token_address text not null,
    event_id text not null,
    tx_hash text not null,
    event_type text not null,
    severity text not null,
    title text not null,
    description text,
    usd_value numeric not null default 0,
    token_amount numeric not null default 0,
    wallet text,
    detected_at timestamptz not null,
    saved_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    raw_event jsonb not null,
    constraint token_impact_events_chain_token_event_key unique (chain, token_address, event_id)
);

create index if not exists token_impact_events_token_detected_idx
    on public.token_impact_events (chain, token_address, detected_at desc);

create index if not exists token_impact_events_saved_at_idx
    on public.token_impact_events (saved_at desc);

create index if not exists token_impact_events_tx_hash_idx
    on public.token_impact_events (tx_hash);

alter table public.token_impact_events enable row level security;

drop policy if exists "Token impact events are readable" on public.token_impact_events;
create policy "Token impact events are readable"
    on public.token_impact_events
    for select
    using (true);

drop policy if exists "Token impact events can be inserted by anon clients" on public.token_impact_events;
create policy "Token impact events can be inserted by anon clients"
    on public.token_impact_events
    for insert
    with check (true);

drop policy if exists "Token impact events can be updated by anon clients" on public.token_impact_events;
create policy "Token impact events can be updated by anon clients"
    on public.token_impact_events
    for update
    using (true)
    with check (true);

drop policy if exists "Token impact events can be deleted by anon clients" on public.token_impact_events;
create policy "Token impact events can be deleted by anon clients"
    on public.token_impact_events
    for delete
    using (true);

create or replace function public.set_token_impact_events_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists token_impact_events_set_updated_at on public.token_impact_events;

create trigger token_impact_events_set_updated_at
before update on public.token_impact_events
for each row
execute function public.set_token_impact_events_updated_at();
