<!-- SafeScan remediation plan for risk scoring and forensic reliability. -->

# Safe Scan Remediation Plan

Date: 2026-04-23

## Goal

Upgrade Safe Scan from a functional MVP into a provider-aware, failure-tolerant, faster forensic system that:

- finishes scans more consistently
- degrades gracefully under provider pressure
- improves cluster and bundle detection quality
- reduces frontend coupling to third-party APIs
- closes the gap between the documented architecture and the actual runtime

## Verified Current State

- `npm run build` passes
- targeted service and utility tests pass
- `src/pages/WalletTracking.test.tsx` still hangs and blocks a clean full-suite run
- Safe Scan now uses a backend forensic worker, but that worker is still in-memory and not durable
- DexScreener search throttling and Supabase dedupe were added, which should reduce `429` and duplicate upsert failures

## Primary Findings

### 1. Architecture drift is real

The repository README describes Netlify, Render workers, RabbitMQ, and Redis, but the current Safe Scan path is still mostly:

- Vite frontend
- direct client-side provider orchestration
- a local Node forensic server with in-memory job state
- no durable queue
- no persistent forensic report cache outside browser local storage

This drift is creating confusion about what the platform can actually guarantee today.

### 2. Provider budgets are coupled together

`DatabaseService.ts` currently mixes:

- market feed discovery
- global token search
- DexScreener token lookup
- local browser caching
- Supabase hydration and sync
- smart-money wallet sync

When one part gets noisy, unrelated parts feel unstable. Safe Scan should not share the same request budget as background market discovery.

### 3. The forensic engine has a capability mismatch

The runtime still contains a disabled Helius historical path:

- `src/services/forensics/engine.ts`
- `fetchTransactionsForAddressViaHelius(...)` currently returns `[]`

But the report notes still claim Helius ordered history can be used when `usedHeliusHistory` is true. This makes troubleshooting harder because the implementation and the narrative can diverge.

### 4. The job worker is not production-safe yet

`server/forensics-server.ts` is a good stabilization step, but it still uses:

- in-memory job storage
- in-memory dedupe
- in-memory completed-report cache

That means:

- a process restart loses job state
- there is no retry queue
- there is no cancellation
- there is no concurrency governor across jobs

### 5. Safe Scan still has too much orchestration in the page layer

`src/pages/SafeScan.tsx` handles:

- input lifecycle
- provider fan-out
- market-data merging
- forensic kickoff
- hard timeout behavior
- UI fallback messaging

This should move to a feature controller or backend orchestration layer so the page is mostly a presentation shell.

### 6. Wallet Tracking is still leaking side effects into tests

The Wallet Tracking area still has enough background activity to hang the test suite. The most likely causes are:

- effects that trigger persistence work during render/profile hydration
- async writes to storage or Supabase from `SavedWalletService.updateWalletStats`
- repeated portfolio/PnL effects with background fetches

Until that is fixed, the project does not have a trustworthy green baseline for the whole app.

### 7. Bundle size is too large

The production build currently emits a large main bundle and Vite warns that some dynamic imports are ineffective because the same modules are also statically imported elsewhere.

That hurts:

- first paint
- route performance
- the feeling of scan responsiveness

### 8. Documentation and security guidance need cleanup

The README still references infrastructure that is not currently active and includes a `VITE_SUPABASE_SERVICE_KEY` example. Even if the runtime is not using it, that is unsafe guidance for a frontend repository.

## Target Architecture

Safe Scan should move to this shape:

1. Frontend UI
   - route/page components
   - query state and rendering only
   - no direct third-party orchestration except through app backend endpoints

2. API/BFF layer
   - token details endpoint
   - security scan endpoint
   - forensic job endpoints
   - provider-specific throttling, caching, retries, and normalization

3. Forensic worker
   - durable queued jobs
   - persistent job state
   - persistent report cache
   - bounded concurrency
   - resumable retries

4. Data stores
   - browser cache only for presentation shortcuts
   - database cache for token details and forensic reports
   - Redis or equivalent for queue state and provider cooldowns

5. Observability
   - per-provider latency
   - rate-limit counters
   - error taxonomy
   - job-stage timing

## Phased Fix Plan

## Phase 0: Baseline and Safety

Deliver in 1-2 days.

- Correct the forensic notes so the report never claims Helius ordered history unless that path actually ran.
- Add structured error codes for:
  - provider rate limit
  - provider timeout
  - invalid address expansion
  - worker timeout
  - partial degraded result
- Remove service-role-key guidance from the README and replace it with backend-only secret guidance.
- Add a feature flag for expensive enrichments so new failures can be isolated quickly.

Exit criteria:

- one consistent error contract across Safe Scan
- no misleading report notes
- updated operator docs

## Phase 1: Request Budget Separation

Deliver in 2-4 days.

- Split `DatabaseService` into:
  - `MarketDiscoveryService`
  - `TokenDetailsService`
  - `MarketCacheService`
  - `SupabaseSyncService`
- Keep Safe Scan on token-specific lookup paths only.
- Keep Dashboard discovery on a separate queue and cache.
- Add per-provider budgets:
  - DexScreener search budget
  - DexScreener token lookup budget
  - Helius RPC budget
  - Helius Wallet API budget
  - GoPlus budget
  - Moralis budget
- Promote current in-memory cooldown logic into a reusable provider scheduler.

Exit criteria:

- Safe Scan works even while Dashboard discovery is active
- DexScreener discovery rate limits do not spill into scan UX

## Phase 2: Helius-First Forensic Correctness

Deliver in 3-5 days.

- Re-enable `getTransactionsForAddress` properly using the documented positional `params` tuple.
- Build a dedicated Helius adapter for:
  - `getTransactionsForAddress`
  - Wallet API `identity`
  - Wallet API `funded-by`
  - Wallet API `history`
  - Wallet API `transfers`
- Normalize all Helius responses at the adapter boundary.
- Add a strict fallback tree:
  - ordered Helius history
  - signature paging + decoded transactions
  - partial cluster scan with lower confidence
- Add scan-stage output so the UI knows whether it received:
  - full forensic coverage
  - reduced historical coverage
  - reduced enrichment coverage

Exit criteria:

- no malformed Helius requests
- deterministic fallback behavior
- confidence reflects the actual data path used

## Phase 3: Durable Backend Execution

Deliver in 4-7 days.

- Replace the in-memory forensic job server with a durable job runner.
- Persist:
  - job status
  - stage progress
  - cached reports
  - last successful scan metadata
- Add concurrency caps by job type and provider budget.
- Add resumable retries for transient failures.
- Add cancellation and stale-job cleanup.

Recommended storage split:

- Postgres for job state and reports
- Redis for queue + cooldown + transient state

Exit criteria:

- restart-safe forensic jobs
- repeated scans reuse cached work
- provider bursts do not crash or starve the worker

## Phase 4: Page and Hook Refactor

Deliver in 3-5 days.

- Refactor `SafeScan.tsx` into:
  - scan controller hook
  - report assembler
  - pure presentation components
- Refactor `useWalletPortfolio` to make background PnL enrichment cancellable and test-safe.
- Stop service writes from happening as hidden side effects during render/profile hydration.
- Add route-level code splitting for:
  - Safe Scan
  - Wallet Tracking
  - Smart Money
  - Token Details

Exit criteria:

- smaller main bundle
- fewer background side effects during navigation
- Wallet Tracking tests no longer hang

## Phase 5: Forensic Quality Upgrade

Deliver in 5-10 days.

- Separate evidence tiers into deterministic vs inferred vs weak.
- Store bundle candidates and cluster candidates separately from final clusters.
- Track coverage metrics:
  - holder coverage
  - transaction coverage
  - history coverage
  - wallet enrichment coverage
- Add cluster stability scoring across threshold changes.
- Add “independent holder” sampling rules so the graph remains readable without hiding non-clustered wallets.
- Add calibration fixtures for:
  - block-zero launches
  - sniper-heavy launches
  - organic launches
  - false-positive stress cases

Exit criteria:

- stronger cluster explanations
- fewer false positives
- clearer confidence signals

## Testing Plan

### Immediate

- keep `build` green
- keep current service tests green
- fix the hanging Wallet Tracking test
- add a mocked integration test for the Safe Scan page that covers:
  - successful scan
  - degraded partial forensic result
  - provider rate-limit fallback
  - backend job timeout

### Next

- add adapter tests for Helius custom RPC payload shapes
- add queue tests for retry and cooldown behavior
- add Supabase sync tests for duplicate payload collapse
- add snapshot tests for forensic graph node/edge emission

### Before calling the system stable

- run a labeled token set with expected outcomes
- record timing for:
  - token details only
  - security scan
  - forensic scan partial
  - forensic scan full
- define scan SLOs and alert thresholds

## Performance Targets

- token details visible in under 1.5s from warm cache
- base Safe Scan result in under 3s on healthy providers
- partial forensic result in under 8s
- full forensic result typically under 30s, with progress states if longer
- provider rate limits should degrade depth, not break the scan

## What To Fix First

If we want the biggest improvement fastest, the order should be:

1. separate request budgets by feature
2. fix Helius ordered-history integration correctly
3. make the forensic worker durable
4. remove hidden side effects from Wallet Tracking
5. split the monolith services and page orchestration

## External References

- Helius rate limits: https://www.helius.dev/docs/billing/rate-limits
- Helius `getTransactionsForAddress`: https://www.helius.dev/docs/api-reference/rpc/http/gettransactionsforaddress
- Helius Wallet API overview: https://www.helius.dev/docs/wallet-api/overview
- DexScreener API reference: https://docs.dexscreener.com/api/reference
- Supabase upsert docs: https://supabase.com/docs/reference/javascript/upsert
- Supabase query optimization and composite indexes: https://supabase.com/docs/guides/database/query-optimization
