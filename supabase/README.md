<!-- Supabase schema guide for intelligence storage. -->

# Supabase Schemas

This folder contains SQL schemas used by the Atlaix intelligence database.

The current schema files support Live Alpha Feed discovered tokens, shared Detection Engine token snapshots, Detection Engine events, Token Impact Timeline events, Smart Money scanner jobs, and qualified wallet records.

Apply `discovered_tokens.sql` in Supabase SQL Editor when Live Alpha Feed tokens are not persisting between reloads.
Apply `token_impact_events.sql` when Token Impact Timeline events need to persist across users and Railway restarts.
Apply `detected_token_snapshots.sql` when the Detection Engine feed should be served from the shared backend state.
