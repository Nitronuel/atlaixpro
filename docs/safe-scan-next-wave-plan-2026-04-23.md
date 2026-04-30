<!-- SafeScan roadmap notes for upcoming forensic intelligence improvements. -->

# Safe Scan Next-Wave Plan

Date: 2026-04-23

## Scope

This plan covers the next major improvement wave for Safe Scan:

- restore the correct Helius ordered-history path
- replace the current in-memory forensic runner with a durable queue-backed worker
- shrink the frontend entry bundle and isolate heavy routes
- make the resulting improvements measurable

The goal is not incremental cleanup. The goal is to produce visible, testable gains in:

- scan completion rate
- forensic quality
- repeat-scan speed
- first-load performance
- operational stability under provider pressure

## Research Summary

### Helius

Helius currently documents:

- `getTransactionsForAddress` as a Helius-exclusive RPC method
- Developer plan requirement or higher
- 50 credits per request
- support for ascending chronological order via `sortOrder: "asc"`
- `transactionDetails: "full"` for up to 100 transactions
- `transactionDetails: "signatures"` for up to 1000 signatures
- `paginationToken` for paging
- `tokenAccounts` controls for direct address history vs token-account-aware history

Important current limits:

- Developer RPC: 50 req/s
- Wallet API and Enhanced APIs: 10 req/s shared
- `getProgramAccounts`: 25 req/s on Developer
- `getTransactionsForAddress`: no batch requests

Important functional limitation:

- token-account-aware history does not support transactions prior to December 2022 because it depends on token transfer metadata introduced later

### Queueing / worker runtime

Two serious options fit this system:

1. `pg-boss`
   - runs on PostgreSQL
   - exactly-once delivery
   - retries with exponential backoff
   - dead-letter support
   - backpressure-aware polling
   - works well when the product already relies on Postgres/Supabase

2. `BullMQ`
   - Redis-backed
   - strong global and worker-level rate limiting
   - manual rate-limit support on external `429`s
   - excellent if Redis is already part of the production baseline

### Frontend performance

Vite and React currently recommend:

- route and component code splitting with `React.lazy`
- `Suspense` boundaries around lazy routes/components
- explicit chunking via `build.rollupOptions.output.manualChunks`
- optional `splitVendorChunkPlugin`
- relying on Vite's async preload optimization once real dynamic imports exist

## Key Decisions

## Decision 1: Use Helius ordered history as the primary launch-history engine

Why:

- It collapses what is currently a multi-step pattern into one history call.
- It gives chronological order directly.
- It removes a large amount of `getSignaturesForAddress` plus `getTransaction` fan-out.
- It is exactly the kind of method you are paying for on the Helius Developer plan.

How:

- For mint launch reconstruction, use:
  - `getTransactionsForAddress`
  - `sortOrder: "asc"`
  - `transactionDetails: "full"`
  - `encoding: "jsonParsed"`
  - `maxSupportedTransactionVersion: 0`
  - `limit: 100`
- If the first page is insufficient, page with `paginationToken`.
- For wallet-centric historical analysis where full tx payloads are not needed immediately, use `transactionDetails: "signatures"` first and only hydrate specific signatures.

Why this should improve results:

- Better first-buyer ordering
- Better block-zero and early-window analysis
- Better pool creation and funding origin tracing
- Lower failure risk than firing many per-signature RPC calls

## Decision 2: Keep Helius Wallet API, but enforce a separate budget

Why:

- On Developer, Wallet API shares the 10 req/s Enhanced API budget.
- Identity, funding, transfers, and history are valuable, but if they compete with everything else they will cause avoidable scan degradation.

How:

- Create a dedicated Wallet API scheduler with a hard ceiling below plan max.
- Use:
  - `batch-identity` for identity lookups whenever possible
  - `funded-by` only for top-priority wallets
  - `history` and `transfers` as secondary enrichment, not the first-line dependency
- Make enrichment tiered:
  - Tier A wallets: block-zero, launch buyers, top suspicious holders, deployer-linked
  - Tier B wallets: cluster-adjacent
  - Tier C wallets: no Wallet API enrichment unless promoted by evidence

Recommended caps on Developer:

- Helius ordered-history queue: 4 req/s
- Wallet API queue: 4 req/s
- generic RPC forensic queue: 15 req/s
- keep headroom for retries and non-forensic traffic

## Decision 3: Choose `pg-boss` first for the durable forensic queue

Why `pg-boss` is the best fit right now:

- The product already depends on Supabase/Postgres.
- It avoids introducing Redis before it is truly needed.
- It gives durable job state, retries, backoff, dead letters, and concurrency control with one fewer moving part.
- The current local environment is already on Node 24, and `pg-boss` supports current Node/Postgres generations.

Why not BullMQ first:

- BullMQ is excellent, especially for rate limiting, but it adds Redis as a hard infrastructure dependency.
- That is a reasonable later step if Redis becomes a firm production standard or if queue throughput needs outgrow Postgres-backed job processing.

When BullMQ becomes the better choice:

- if multiple heavy worker categories need centralized global rate limiting
- if Redis is already required elsewhere in the production stack
- if throughput goals rise enough that Postgres queue polling becomes the bottleneck

## Decision 4: Split the frontend by route and forensic feature boundary

Why:

- Current production build still emits a very large main chunk.
- The main entry still pays for Safe Scan and related heavy logic too early.
- Vite will only help if the imports are truly async and not also imported statically elsewhere.

How:

- Lazy-load routes:
  - Safe Scan
  - Wallet Tracking
  - Smart Money
  - Token Details
- Lazy-load heavy feature sections inside routes when possible:
  - `ForensicBundleSection`
  - graph/layout utilities
  - wallet portfolio detail surfaces
- Add `manualChunks` in Vite for:
  - `react-vendor`
  - `charts-graph`
  - `safe-scan`
  - `wallet-intel`
  - `services-heavy`
- Remove static imports that currently defeat chunk splitting, especially where the same service is both dynamically and statically imported.

## Execution Plan

## Phase 1: Helius Correctness

Deliverables:

- dedicated Helius adapter module
- correct `getTransactionsForAddress` request builder
- signatures-mode + full-mode helpers
- pagination via `paginationToken`
- explicit fallback reasons

Implementation details:

1. Replace the stubbed `fetchTransactionsForAddressViaHelius()` implementation.
2. Stop routing this method through generic provider fallbacks. If Helius is unavailable, fail into a clearly labeled degraded path.
3. Add two separate uses:
   - full chronological launch page
   - signatures-first historical walker
4. Record in the report:
   - ordered history used or not
   - page count
   - degraded reason

Expected gains:

- 40-70% lower launch reconstruction latency on supported scans
- significantly fewer malformed or fallback-driven failures
- better first-window attribution quality

## Phase 2: Durable Queue

Deliverables:

- `pg-boss` backed forensic queue
- persistent job states in Postgres
- retry policy and dead-letter queue
- cached completed reports in database storage
- job-stage progress model

Job model:

- `queued`
- `hydrating_inputs`
- `history_reconstruction`
- `wallet_enrichment`
- `graph_expansion`
- `cluster_scoring`
- `report_materialization`
- `completed`
- `failed`
- `dead_letter`

Retry policy:

- transient provider failures: 3-5 retries with exponential backoff
- invalid input: no retry
- plan/rate-limit exhaustion: delayed retry with queue-level cooldown

Expected gains:

- completed jobs survive restarts
- repeated scans of the same token reuse stored reports
- much fewer user-visible hard failures on worker restarts or transient outages

## Phase 3: Provider Budget Enforcement

Deliverables:

- separate schedulers for:
  - Helius ordered history
  - Helius Wallet API
  - generic Solana RPC
  - DexScreener discovery
  - DexScreener direct token lookup
- queue-aware cooldown handling
- per-provider metrics

Key rule:

- Safe Scan token detail and forensic jobs always outrank background market discovery

Expected gains:

- fewer 429 cascades
- better scan consistency under load
- no more Dashboard discovery stealing scan budget

## Phase 4: Frontend Split and Route Hygiene

Deliverables:

- lazy-loaded route modules
- `Suspense` boundaries
- Vite `manualChunks`
- removal of static imports that block chunk separation
- route-level skeletons

Expected gains:

- 30-45% lower main entry bundle target
- faster initial load
- less memory pressure
- smoother route transitions

## Phase 5: Measurement and Calibration

Deliverables:

- benchmark set of tokens:
  - block-zero coordinated
  - sniper-heavy
  - organic launch
  - noisy false-positive candidates
- timing instrumentation for each stage
- cluster precision review pass
- tangible release metrics

Metrics to track:

- core scan success rate
- forensic completion rate
- ordered-history usage rate
- average scan time
- repeated-scan cache hit rate
- Wallet API fallback rate
- provider 429 rate
- frontend first route load

## Expected Tangible Improvements

These are the target improvements for the next wave, not guaranteed exact numbers:

- Safe Scan hard-failure rate: reduce by 60-80%
- forensic repeat-scan latency: improve by 50-80% through durable caching
- launch reconstruction latency on Helius-supported tokens: improve by 40-70%
- first Safe Scan route load: improve by 20-35%
- main entry chunk size: reduce by 30-45%
- bundle/cluster recall on launch-heavy tokens: visibly higher because the history path becomes chronological and direct

## Risk Controls

- ship the Helius adapter behind a feature flag first
- keep the existing signature-paging path as a fallback until the new path is validated
- roll out queue persistence before removing the current in-memory fast path
- add per-stage timeout ceilings so one provider cannot hold the whole job forever
- add structured report metadata so degraded scans are honest instead of ambiguous

## Recommended Rollout Order

1. Helius adapter and ordered-history validation
2. `pg-boss` queue with stored reports
3. provider budget scheduler
4. route/code splitting
5. calibration and threshold tuning

## Why This Order

- Ordered history unlocks the biggest forensic quality gain.
- Durable jobs unlock the biggest reliability gain.
- Budget separation unlocks the biggest consistency gain.
- Code splitting unlocks the biggest frontend feel improvement.

## Sources

- Helius `getTransactionsForAddress`: https://www.helius.dev/docs/rpc/gettransactionsforaddress
- Helius plans: https://www.helius.dev/docs/billing/plans
- Helius rate limits: https://www.helius.dev/docs/billing/rate-limits
- Helius Wallet API overview: https://www.helius.dev/docs/wallet-api/overview
- pg-boss: https://github.com/timgit/pg-boss
- BullMQ rate limiting: https://docs.bullmq.io/guide/rate-limiting
- Vite build customization: https://vite.dev/guide/build
- Vite async chunk optimization: https://vite.dev/guide/features
- React `lazy`: https://react.dev/reference/react/lazy
- React `Suspense`: https://react.dev/reference/react/Suspense
- Supabase upsert: https://supabase.com/docs/reference/javascript/upsert
- Supabase query optimization: https://supabase.com/docs/guides/database/query-optimization
