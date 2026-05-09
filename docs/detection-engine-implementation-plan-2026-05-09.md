# Atlaix Detection Engine Implementation Plan

Date: 2026-05-09

Purpose: Turn the comprehensive Detection Engine category and trigger redesign into a practical engineering roadmap. This implementation is scoped to DexScreener plus snapshot history, with no detection-specific Alchemy re-verification layer. It does not depend on the current Smart Money Engine or Safe Scan page for detection quality.

Related reports:

- `docs/comprehensive-detection-categories-triggers-report-2026-05-09.md`
- `docs/dexscreener-alchemy-detection-upgrade-plan-2026-05-09.md`
- `docs/development-council-detection-engine-report-2026-05-09.md`

## 1. Executive Summary

The Detection Engine should be upgraded in controlled phases. The goal is not to rewrite everything at once. The goal is to make the engine more accurate, more honest, easier to trust, and easier to improve with evidence.

The recommended implementation sequence is:

1. Add signal honesty fields to the event model.
2. Rename misleading triggers and categories.
3. Add true time-series pair snapshots.
4. Use snapshot deltas to improve liquidity, recovery, momentum, and stress detection.
5. Add lane-specific classification.
6. Update the Detection UI to show evidence, confidence, counter-signals, and watch conditions.
7. Add outcome tracking to measure whether the engine is actually working.

The most important technical point: the repo already has `server/detection-snapshot-store.ts` and `supabase/detected_token_snapshots.sql`, but that table is currently a latest-state shared detection cache keyed by `detection_key`. It is not a full time-series pair snapshot system. We should keep it for feed sharing, but add a new historical pair snapshot table for detection deltas.

## 2. Current Codebase Reality

### Current key files

- `src/services/AlphaGauntletService.ts`
  - Current trigger and classification logic.
  - Current market eligibility gate.
  - Current score calculation.

- `src/types/index.ts`
  - `AlphaGauntletEventType`
  - `AlphaGauntletTrigger`
  - `AlphaGauntletScores`
  - `AlphaGauntletEvent`

- `src/services/DatabaseService.ts`
  - DexScreener discovery and pair transformation.
  - Server detection feed fetches.
  - Supabase sync for detection events.

- `server/detection-engine-runner.ts`
  - Scheduled runner.
  - Calls `DatabaseService.getMarketData`.
  - Calls `AlphaGauntletService.getDetectionEvents`.
  - Upserts top events to `DetectionSnapshotStore`.
  - Prewarms timeline/impactful activity.

- `server/detection-snapshot-store.ts`
  - Persists latest detection state into `detected_token_snapshots`.
  - This is useful, but it is not historical time-series storage.

- `supabase/detected_token_snapshots.sql`
  - Current latest detection snapshot table.
  - One row per detection key.

- `src/pages/Detection.tsx`
  - Main Detection Engine page.
  - Uses current event categories and trigger names.

- `src/pages/TokenDetection.tsx`
  - Token-specific Detection page.
  - Good target for evidence, confidence, and watch-condition display.

### Current limits

The current engine:

- uses one hard eligibility gate,
- generates string triggers,
- classifies into six event types,
- computes one total score,
- uses `detected_token_snapshots` as a shared latest-state table,
- does not compare real historical snapshots,
- does not expose confidence or counter-signals,
- and uses some labels that overclaim the evidence.

## 3. Target Product Behavior

Users should be able to open the Detection Engine and understand:

- why the token appeared,
- whether the signal is early or mature,
- whether it is mainly activity, risk, liquidity, or attention,
- what evidence supports the detection,
- what evidence weakens the detection,
- how fresh the data is,
- whether the engine has observed a real change or only inferred structure,
- and what condition would make the token more bullish or more dangerous.

The product should avoid implying:

- contract safety,
- smart-money participation,
- holder growth,
- or actual liquidity add/remove events

unless those things are truly verified.

## 4. Implementation Principles

1. Keep backward compatibility where possible.
   - Add new fields before removing old fields.
   - Keep `score`, `eventType`, and `triggers` during transition.

2. Build confidence before complexity.
   - A smaller number of honest categories is better than many noisy labels.

3. Separate latest-state storage from time-series storage.
   - `detected_token_snapshots` remains a feed cache.
   - A new `detection_pair_snapshots` table stores history.

4. Separate signal types.
   - Market activity is not safety.
   - Paid attention is not quality.
   - Thin liquidity is not liquidity removal.
   - Transaction count is not holder growth.

5. Use Alchemy only after DexScreener signals justify it.
   - Do not enrich every candidate.

## 5. Proposed Data Model

## 5.1 Event model additions

Update `AlphaGauntletEvent` with optional fields first:

```ts
export type DetectionLane =
    | 'Fresh Launch'
    | 'Emerging Momentum'
    | 'Established Momentum'
    | 'Market Stress'
    | 'Liquidity Risk'
    | 'Paid Attention'
    | 'Watchlist Candidate';

export type EvidenceKind = 'observed' | 'derived' | 'inferred' | 'unverified';

export interface DetectionTriggerDetail {
    id: string;
    label: string;
    kind: EvidenceKind;
    strength: number;
    explanation: string;
    metrics?: Record<string, number | string | boolean>;
}

export interface DetectionConfidence {
    score: number;
    label: 'High' | 'Medium' | 'Low';
    reasons: string[];
}

export interface DetectionWatchCondition {
    label: string;
    direction: 'bullish' | 'bearish' | 'neutral';
    metric: string;
    threshold?: number;
    explanation: string;
}
```

Then extend `AlphaGauntletEvent`:

```ts
lane?: DetectionLane;
activityScore?: number;
marketQualityScore?: number;
liquidityQualityScore?: number;
manipulationRiskScore?: number;
confidence?: DetectionConfidence;
triggerDetails?: DetectionTriggerDetail[];
whyDetected?: string[];
counterSignals?: string[];
watchConditions?: DetectionWatchCondition[];
dataFreshnessMs?: number;
```

Why optional first:

- The frontend can render old and new events during migration.
- Server and local fallback paths will not break immediately.
- Stored old events remain readable.

## 5.2 New historical pair snapshot table

Create `supabase/detection_pair_snapshots.sql`.

Suggested table:

```sql
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
```

Recommended retention:

- Keep raw snapshots for 7 to 14 days.
- Keep aggregated outcomes longer.
- Add a cleanup job later once the engine proves useful.

## 5.3 Outcome tracking table

Create later in Phase 6 or 7:

```sql
create table if not exists public.detection_outcomes (
    id bigint generated always as identity primary key,
    detection_key text not null,
    chain text not null,
    token_address text not null,
    pair_address text,
    event_type text not null,
    lane text,
    score numeric not null default 0,
    confidence_score numeric,
    detected_at timestamptz not null,
    measured_at timestamptz not null,
    horizon text not null,
    price_return_pct numeric,
    max_drawdown_pct numeric,
    liquidity_change_pct numeric,
    volume_change_pct numeric,
    still_active boolean,
    raw_metrics jsonb not null default '{}'::jsonb
);
```

Horizons:

- `5m`
- `15m`
- `1h`
- `6h`
- `24h`

## 6. Phase 0 - Preparation and Safety

Goal: make the change safe to implement.

### Backend tasks

- Add unit fixtures for current `AlphaGauntletService` behavior before changing it.
- Capture current feed distribution as a baseline.
- Add a feature flag:
  - `DETECTION_ENGINE_V2_ENABLED`
  - default `false`.
- Add a frontend compatibility helper:
  - old event fields render normally,
  - new fields render when present.

### Acceptance criteria

- Existing tests pass.
- Old detection feed still renders.
- V2 can be enabled locally without changing production behavior.

### Suggested files

- `src/services/AlphaGauntletService.test.ts`
- `src/services/detection/fixtures.ts`
- `src/config/index.ts`

## 7. Phase 1 - Signal Honesty Upgrade

Goal: fix misleading labels and add evidence fields without changing the entire engine.

### Backend tasks

1. Extend detection types in `src/types/index.ts`.
2. Add `triggerDetails`, `confidence`, `whyDetected`, `counterSignals`, and `watchConditions`.
3. Add a compatibility mapping from old trigger strings to new details.
4. Rename or qualify misleading triggers:
   - `Volume Spike` -> `Volume Expansion`
   - `Transaction Spike` -> `Trade Count Acceleration`
   - `Strong Buy Pressure` -> `Buyer Dominance`
   - `Strong Sell Pressure` -> `Seller Dominance`
   - `Liquidity Added` -> `Deep Liquidity Structure` unless real delta exists
   - `Liquidity Removed` -> `Thin Liquidity Risk` unless real delta exists
   - `Holder Growth Spike` -> `Active Trade Proxy Spike`
   - `Price Dump` -> `Price Breakdown`
   - `Price Recovery` -> `Recovery Attempt`
   - `Abnormal Large Trades` -> `Large Flow Imbalance`
5. Update summaries so they do not say "Alpha score" as if it is a full trust score.

### Frontend tasks

1. Show `Activity Score` instead of `Alpha Score`.
2. Show `Confidence` if available.
3. Show a small "Market signal only" or "Contract safety not verified" note.
4. Show `whyDetected` and `counterSignals` on token detail pages first.

### Acceptance criteria

- No UI copy says liquidity was added/removed unless the event has observed evidence.
- No UI copy says holder growth unless real wallet/holder data exists.
- Every V2 event has:
  - at least one `whyDetected` item,
  - confidence label,
  - and evidence kind per trigger.

### Testing

- Unit test trigger mapping.
- Unit test event summary copy.
- Regression test old stored events still render.

## 8. Phase 2 - True Pair Snapshot History

Goal: store historical DexScreener pair states so the engine can detect real changes.

### Backend tasks

1. Add `supabase/detection_pair_snapshots.sql`.
2. Create `server/detection-pair-snapshot-store.ts`.
3. Add methods:
   - `insertSnapshots(pairsOrCoins)`
   - `getRecentSnapshots(chain, tokenAddress, windows)`
   - `getNearestSnapshot(chain, tokenAddress, beforeTimestamp)`
   - `cleanupOldSnapshots(days)`
4. Update `server/detection-engine-runner.ts`:
   - after fetching market data, persist pair snapshots for candidate tokens,
   - then pass snapshot context into the V2 classifier.
5. Add local fallback memory cache for development if Supabase is unavailable.

### Important implementation note

Do not replace `detected_token_snapshots`. Keep it as the latest shared feed cache.

Add `detection_pair_snapshots` as the historical layer.

### Derived snapshot metrics

Compute:

- liquidity change 5m/15m/1h/6h/24h,
- price change since snapshot,
- volume acceleration,
- buy/sell acceleration,
- transaction acceleration,
- liquidity turnover trend,
- recovery from previous drawdown,
- and whether paid attention preceded or followed market activity.

### Acceptance criteria

- The system can tell the difference between:
  - thin liquidity,
  - liquidity contraction,
  - and liquidity expansion.
- Recovery requires actual previous weakness or drawdown.
- Snapshot reads do not block the feed if Supabase is unavailable.

### Testing

- Snapshot delta tests.
- Missing snapshot fallback tests.
- Liquidity expansion/contraction classification tests.

## 9. Phase 3 - Detection Lanes

Goal: stop applying one gate to every token.

### New lanes

Start with these primary lanes:

- `Fresh Launch`
- `Emerging Momentum`
- `Established Momentum`
- `Market Stress`
- `Liquidity Risk`
- `Paid Attention`
- `Watchlist Candidate`

Do not add too many primary categories yet. Use trigger details and tags for nuance.

### Backend tasks

1. Create `src/services/detection/DetectionLaneService.ts`.
2. Implement lane selection from:
   - age,
   - liquidity,
   - volume,
   - market cap,
   - transaction count,
   - paid attention source,
   - price volatility,
   - snapshot deltas.
3. Replace one `marketEligible` gate with lane-specific gates.
4. Let low-confidence fresh launches appear as watchlist candidates instead of forcing them into accumulation.

### Suggested lane gates

Fresh Launch:

- age 10 minutes to 6 hours,
- liquidity >= $25k to $75k,
- txns >= 100 to 150,
- at least one acceleration or attention signal,
- default confidence low or medium.

Emerging Momentum:

- age 6 hours to 3 days,
- liquidity >= $75k to $150k,
- volume >= $150k to $300k,
- txns >= 300,
- volume/liquidity >= 0.8.

Established Momentum:

- age older than 3 days,
- liquidity >= $250k,
- volume >= $500k,
- market cap >= $3M,
- must beat recent baseline.

Market Stress:

- price breakdown plus seller dominance or liquidity stress.

Liquidity Risk:

- thin liquidity,
- real liquidity contraction,
- extreme turnover,
- or fragmented pools.

Paid Attention:

- boost, ad, profile, order, or community takeover exists,
- but market quality is not yet strong enough.

Watchlist Candidate:

- interesting but incomplete evidence.

### Acceptance criteria

- A new token and an established token do not use the same threshold set.
- Paid attention does not automatically create a bullish signal.
- Fresh launches show uncertainty by default.

## 10. Phase 4 - Trigger Engine V2

Goal: make triggers more selective and meaningful.

### Backend tasks

1. Create `src/services/detection/TriggerEngine.ts`.
2. Replace raw string pushes with structured trigger details.
3. Add trigger strength from 0 to 100.
4. Add evidence kind:
   - `observed`: actual snapshot delta or provider field.
   - `derived`: calculated from provider fields.
   - `inferred`: reasonable but not directly proven.
   - `unverified`: needs Alchemy/Safe Scan/Smart Money later.

### Initial V2 triggers

- `Volume Expansion`
- `Trade Count Acceleration`
- `Buyer Dominance`
- `Seller Dominance`
- `Deep Liquidity Structure`
- `Thin Liquidity Risk`
- `Liquidity Expansion`
- `Liquidity Contraction`
- `Active Trade Proxy Spike`
- `Price Breakdown`
- `Recovery Attempt`
- `Large Flow Imbalance`
- `Paid Attention`
- `Volume Quality Warning`
- `Price/Flow Divergence`

### Trigger precision targets

Use the current feed baseline as a warning. No normal trigger should fire on almost every event.

Targets:

- common structural tags may appear often,
- but major triggers like `Trade Count Acceleration` and `Large Flow Imbalance` should not appear on 80 to 95 percent of detections.

### Acceptance criteria

- Trigger details include explanations.
- Triggers are unit-tested with sample tokens.
- Trigger distribution is measured after implementation.

## 11. Phase 5 - Scoring V2

Goal: separate different meanings of score.

### Backend tasks

Create `src/services/detection/DetectionScoringService.ts`.

Add:

- `activityScore`
- `marketQualityScore`
- `liquidityQualityScore`
- `manipulationRiskScore`
- `confidence.score`
- `score` as backward-compatible detection grade.

### Scoring rules

Activity Score:

- volume,
- transactions,
- acceleration,
- price movement,
- age-adjusted intensity.

Market Quality Score:

- volume quality,
- average trade size,
- buy/sell quality,
- price confirmation,
- not purely paid attention.

Liquidity Quality Score:

- liquidity amount,
- liquidity/market cap,
- liquidity trend,
- turnover,
- multi-pool quality later.

Manipulation Risk Score:

- micro-trade churn,
- whale-dominated flow,
- price/flow divergence,
- paid attention without confirmation,
- thin liquidity,
- extreme turnover.

Confidence:

- data freshness,
- available snapshot history,
- observed vs inferred evidence,
- missing field penalties,
- contradictory signal penalties.

### Acceptance criteria

- UI no longer implies a single score means "good".
- A high activity score with low confidence is visually clear.
- Confidence can cap or qualify the overall detection grade.

## 12. Phase 6 - UI Upgrade

Goal: turn the Detection Engine into a decision-support experience.

### Detection page changes

Update `src/pages/Detection.tsx`:

- Use new lane/category labels.
- Show confidence.
- Show activity score and liquidity/risk hints.
- Add filters:
  - lane,
  - confidence,
  - chain,
  - risk direction,
  - paid attention.
- Update global event titles to use V2 trigger names.

### Token Detection page changes

Update `src/pages/TokenDetection.tsx`:

- Add a compact evidence panel.
- Add `Why Detected`.
- Add `Counter Signals`.
- Add `Watch Conditions`.
- Add "Market signal only. Contract safety not verified."
- Show snapshot deltas:
  - liquidity 15m/1h,
  - price 15m/1h,
  - volume acceleration,
  - buy/sell acceleration.

### UX rule

Do not make the page feel like a giant report. Users should scan quickly:

- what happened,
- why it matters,
- confidence,
- main risk,
- next watch condition.

### Acceptance criteria

- Users can understand a detection without reading raw trigger names.
- Low-confidence events are clearly marked.
- Paid attention is not visually treated as bullish by default.

## 13. Phase 7 - Outcome Tracking

Goal: measure whether signals are good.

### Backend tasks

1. Add `detection_outcomes` table.
2. Create `server/detection-outcome-tracker.ts`.
3. When an event is detected, schedule or mark horizons:
   - 5m,
   - 15m,
   - 1h,
   - 6h,
   - 24h.
4. At each horizon, fetch current DexScreener pair data.
5. Store:
   - price return,
   - max drawdown when possible,
   - liquidity change,
   - volume change,
   - whether token is still active.

### Internal reporting

Add simple internal outputs:

- category success rate,
- trigger success rate,
- false-positive candidates,
- low-confidence events that became good,
- high-confidence events that failed.

### Acceptance criteria

- Team can answer: "Which triggers actually worked?"
- Threshold tuning becomes evidence-based.
- The engine can improve over time.

## 15. Phase 9 - Cleanup and Migration

Goal: remove old misleading language after V2 is stable.

### Tasks

- Remove old trigger strings from new code paths.
- Keep display compatibility for old stored events.
- Rename UI sections from Alpha language to Detection/Activity language where appropriate.
- Update docs and developer onboarding.
- Add migration notes.

### Acceptance criteria

- New feed uses V2 categories and fields.
- Old stored events still render safely.
- Product copy no longer overclaims.

## 16. Suggested Engineering Tickets

### Ticket 1: Add Detection V2 types

Files:

- `src/types/index.ts`

Deliverables:

- Add lane, trigger detail, confidence, watch condition, and optional V2 fields.

Acceptance:

- TypeScript build passes.
- Old event objects remain valid.

### Ticket 2: Add V2 compatibility presenter

Files:

- `src/services/detection/DetectionEventPresenter.ts`

Deliverables:

- Convert old events to display-safe labels.
- Generate fallback `whyDetected`.
- Generate fallback confidence.

Acceptance:

- Old feed does not break.
- Misleading liquidity and holder labels are softened.

### Ticket 3: Add pair snapshot migration

Files:

- `supabase/detection_pair_snapshots.sql`

Deliverables:

- Create historical snapshot table and indexes.

Acceptance:

- Migration can be applied independently.
- RLS read policy exists if frontend/server reads through Supabase.

### Ticket 4: Add pair snapshot store

Files:

- `server/detection-pair-snapshot-store.ts`

Deliverables:

- Insert snapshots.
- Fetch recent snapshots by token and pair.
- Compute nearest-window snapshots.

Acceptance:

- Unit tests cover missing history and multiple windows.

### Ticket 5: Persist snapshots from runner

Files:

- `server/detection-engine-runner.ts`
- `src/services/DatabaseService.ts`

Deliverables:

- Persist candidate pair snapshots each detection run.
- Do not block feed on snapshot failure.

Acceptance:

- Runner status remains successful even when snapshot persistence fails softly.

### Ticket 6: Add Trigger Engine V2

Files:

- `src/services/detection/TriggerEngine.ts`
- `src/services/detection/TriggerEngine.test.ts`

Deliverables:

- Structured trigger details.
- Evidence kind.
- Strength score.

Acceptance:

- Current overfiring triggers are replaced or gated.

### Ticket 7: Add Lane Service

Files:

- `src/services/detection/DetectionLaneService.ts`
- tests

Deliverables:

- Lane assignment.
- Lane-specific gates.

Acceptance:

- Fresh and established tokens classify differently.

### Ticket 8: Add Classification Engine V2

Files:

- `src/services/detection/ClassificationEngine.ts`
- `src/services/AlphaGauntletService.ts`

Deliverables:

- V2 classification uses lane, trigger details, and snapshot deltas.
- Feature flag controls activation.

Acceptance:

- V1 fallback remains available.

### Ticket 9: Add Scoring Service V2

Files:

- `src/services/detection/DetectionScoringService.ts`

Deliverables:

- Activity, market quality, liquidity quality, manipulation risk, confidence.

Acceptance:

- High activity with low confidence is represented clearly.

### Ticket 10: Upgrade Detection UI

Files:

- `src/pages/Detection.tsx`
- related components if extracted

Deliverables:

- New category/lane display.
- Confidence and evidence display.
- Updated filters.

Acceptance:

- Existing feed renders.
- V2 feed renders richer information.

### Ticket 11: Upgrade Token Detection UI

Files:

- `src/pages/TokenDetection.tsx`

Deliverables:

- Evidence panel.
- Why detected.
- Counter-signals.
- Watch conditions.
- Snapshot deltas.

Acceptance:

- User can understand the detection reason quickly.

Acceptance:

- No blanket enrichment.
- Failures degrade gracefully.

### Ticket 13: Add outcome tracker

Files:

- `supabase/detection_outcomes.sql`
- `server/detection-outcome-tracker.ts`

Deliverables:

- Horizon tracking.
- Outcome persistence.

Acceptance:

- Outcomes stored for detected events.

## 17. Recommended First Sprint

Sprint goal: make the engine more honest and prepare for real historical intelligence.

### Sprint 1 scope

1. Add V2 optional event fields.
2. Add compatibility presenter.
3. Rename misleading display labels.
4. Add confidence fallback.
5. Add pair snapshot migration.
6. Add snapshot store skeleton.
7. Add tests for trigger label honesty.

### Do not include in Sprint 1

- Full Alchemy verification.
- Full outcome tracking.
- Full UI redesign.
- Too many new categories.

### Why

This sprint creates the foundation without destabilizing the feed.

## 18. Risks and Mitigations

### Risk: Too many fields make events hard to reason about

Mitigation:

- Keep V2 fields optional first.
- Centralize presentation logic.

### Risk: Snapshot table grows too quickly

Mitigation:

- Only snapshot candidates.
- Add retention cleanup.
- Keep raw snapshots for 7 to 14 days.

### Risk: UI becomes too busy

Mitigation:

- Show summarized evidence by default.
- Put detailed metrics behind expandable sections.

### Risk: Alchemy cost increases

Mitigation:

- Add enrichment reasons.
- Cache aggressively.
- Add daily call counters.
- Keep Alchemy out of the first implementation sprint.

### Risk: Engineers implement everything at once

Mitigation:

- Use feature flag.
- Ship phase by phase.
- Test each phase against feed distribution.

## 19. Measurement Plan

Before implementation:

- Current category distribution.
- Current trigger distribution.
- Current feed count.
- Current average score by category.

After Phase 1:

- Percent of events with confidence.
- Percent of events with why/counter-signals.
- Trigger distribution after renamed/gated labels.

After Phase 2:

- Percent of events with snapshot history.
- Number of liquidity events upgraded from inferred to observed.
- Recovery events with verified prior drawdown.

After Phase 3 to 5:

- Category distribution by lane.
- Trigger overfire rate.
- Low-confidence vs high-confidence event ratio.

After Phase 8:

- 5m/15m/1h/6h/24h outcome quality.
- False positive review list.
- Best-performing trigger combinations.

## 20. Final Recommendation

Build this as an evolution, not a rewrite.

The first serious upgrade should not be Alchemy. It should be signal honesty plus true snapshot history. Once the system can prove what changed over time, the categories become much more accurate. After that, Alchemy can selectively verify the tokens that matter most.

The best engineering order is:

1. Event model expansion.
2. Honest labels and confidence.
3. Historical pair snapshots.
4. Snapshot-aware triggers.
5. Lane-based classification.
6. Better UI evidence.
7. Selective Alchemy.
8. Outcome tracking.

That order gives Atlaix a more credible Detection Engine quickly, while building toward a system that can become genuinely respected instead of noisy.
