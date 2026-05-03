create table if not exists public.detection_engine_events (
    event_key text primary key,
    token_address text,
    ticker text not null,
    name text,
    chain text not null,
    event_type text not null,
    severity text not null,
    score numeric not null default 0,
    detected_at timestamptz,
    updated_at timestamptz not null default now(),
    raw_event jsonb not null
);

create index if not exists detection_engine_events_updated_at_idx
    on public.detection_engine_events (updated_at desc);

create index if not exists detection_engine_events_score_idx
    on public.detection_engine_events (score desc);

create index if not exists detection_engine_events_chain_event_type_idx
    on public.detection_engine_events (chain, event_type);

alter table public.detection_engine_events enable row level security;

drop policy if exists "Detection engine events are readable" on public.detection_engine_events;
create policy "Detection engine events are readable"
    on public.detection_engine_events
    for select
    using (true);

drop policy if exists "Detection engine events can be written by anon clients" on public.detection_engine_events;
create policy "Detection engine events can be written by anon clients"
    on public.detection_engine_events
    for insert
    with check (true);

drop policy if exists "Detection engine events can be updated by anon clients" on public.detection_engine_events;
create policy "Detection engine events can be updated by anon clients"
    on public.detection_engine_events
    for update
    using (true)
    with check (true);
