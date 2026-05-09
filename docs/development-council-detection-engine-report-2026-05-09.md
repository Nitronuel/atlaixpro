# Development Council Report: Detection Engine Effectiveness and Upgrade Plan

Date: 2026-05-09

Scope: Atlaix Detection Engine, Alpha Gauntlet scoring, market discovery, token detection details, event persistence, real-time monitoring, UX explainability, security/manipulation resistance, and roadmap toward a best-in-class Web3 token intelligence engine.

## 1. Executive Summary

The Detection Engine is a strong MVP foundation, but it is not yet a defensible best-in-class token intelligence engine. Today it is primarily a rule-based market activity qualifier over DexScreener-style pair data. It can surface active tokens with volume, liquidity, transaction count, buy/sell pressure, price movement, and derived net flow. That is useful for discovery, but it is not enough to win against serious tools or to build deep user trust.

The biggest gap is that the current engine mostly answers:

> "Which tokens look active right now based on 24h market/pair metrics?"

The best version of Atlaix should answer:

> "Is this token opportunity real, early, safe enough, manipulated, smart-money-supported, or likely to fail, and what exactly should the user do next?"

The current scoring system is effective at filtering out tiny/inactive tokens, but weak at detecting coordinated manipulation, insider accumulation, launch bundling, fake organic activity, stealth distribution, wallet quality, creator/deployer risk, holder concentration, wash trading, and true predictive edge. It also lacks outcome measurement, so the platform cannot yet prove whether a score of 85 actually performs better than a score of 65.

Top recommendation: evolve Detection Engine from "Alpha score feed" into a multi-layer intelligence system:

1. Market activity layer: keep Alpha Gauntlet, but calibrate it.
2. On-chain behavior layer: wallet cohorts, top traders, smart-money flows, holder changes.
3. Safety/manipulation layer: deployer history, holder concentration, bundle/cluster risk, honeypot/tax/permission checks.
4. Explainability layer: show why the token was admitted, what changed, why it matters, and what could be wrong.
5. Outcome layer: measure post-detection performance and tune thresholds from real results.

If you build those layers, Atlaix can become more than another token feed. It can become a decision engine users trust.

## 2. Current System Assessment

### What Works

The Detection Engine has several good foundations:

- It has clear event categories: Accumulation, Distribution, Recovery, Liquidity Event, Unusual Activity, and Market Stress.
- It already separates discovery from event qualification.
- It persists server-side detection snapshots and provides a shared feed.
- It warms token timelines and watches top detected tokens.
- It has tests around key Alpha Gauntlet classification edge cases.
- It excludes broad infrastructure tokens through shared filters.
- It keeps detection events stable by preserving first detected timestamps.

Important code anchors:

- Thresholds are defined in `src/services/AlphaGauntletService.ts` at lines 5-6.
- Market eligibility is checked in `src/services/AlphaGauntletService.ts` at lines 113-123.
- Trigger rules are in `src/services/AlphaGauntletService.ts` at lines 129-138.
- Weighted scoring is in `src/services/AlphaGauntletService.ts` at lines 169-176.
- Discovery thresholds and broad query intake are in `src/services/DatabaseService.ts` at lines 76-119 and 465-522.
- The scheduled runner is in `server/detection-engine-runner.ts` at lines 143-200.
- Snapshot persistence is in `supabase/detected_token_snapshots.sql`.

### What Is Weak

The current engine is not yet measuring the most important Web3 token intelligence dimensions:

- Who is buying?
- Who is selling?
- Are buyers profitable or just random wallets?
- Are holders independent or linked?
- Did the deployer or creator wallet rug before?
- Is volume organic or wash-like?
- Was launch supply bundled?
- Is liquidity locked, migratable, or controlled?
- Did top holders quietly distribute after the alert?
- Did the signal lead to good outcomes after 5m, 1h, 6h, 24h?

The system also has a trust issue: the UI shows a score, severity, and event category, but the user cannot easily see enough evidence to understand whether the signal is alpha, noise, or danger.

## 3. Real User Needs Analysis

Atlaix should serve at least three user personas.

### Retail User

The retail user asks:

- "Is this token safe enough to investigate?"
- "Why is it trending?"
- "Am I late?"
- "What is the easiest red flag to understand?"
- "Should I run Safe Scan?"

Today, the Detection Engine gives activity but not enough plain-language judgment. For retail users, "score 87, Liquidity Event" is not enough.

Better example:

> "Why detected: volume is 3.2x liquidity, buy volume is 61%, and liquidity changed sharply. Caution: top 10 wallets control 38%, creator wallet has 2 previous failed launches, and 42% of early buyers are linked. Treat as high-risk momentum, not clean accumulation."

### Pro Trader

The pro trader asks:

- "Is this signal early?"
- "Who is behind the move?"
- "Are profitable wallets entering?"
- "Can I act before the move is gone?"
- "What invalidates this setup?"

Today, the engine has no wallet PnL, cohort labeling, top-trader inflow, or post-alert performance. That makes it less useful than smart-money-focused products.

Better example:

> "Pro signal: 7 qualified wallets with 30d realized PnL above $25k entered within 12 minutes, average entry market cap $4.2M, no top-wallet selling yet. Invalidation: smart-money net flow turns negative or top 20 concentration drops by more than 4% in 30 minutes."

### Token Investigator

The investigator asks:

- "How can this be manipulated?"
- "Are wallets connected?"
- "Did the deployer fund related wallets?"
- "Is this an insider launch?"

Today, Detection and SafeScan are separate. The Detection Engine should pull enough forensic signal into the feed so bad tokens are not promoted as attractive opportunities.

## 4. Market & Competitor Research

### Macro Context

Crypto is becoming more mainstream, and stablecoins are now a major on-chain rail. a16z's 2025 State of Crypto report says stablecoins handled $46 trillion in total transaction volume over the prior year and $9 trillion on an adjusted basis. That matters because crypto analytics products increasingly need to distinguish real economic flow from artificial activity, bots, and spam.

Security and scam activity is also worsening. Chainalysis reported on January 13, 2026 that an estimated $17B was stolen through crypto scams and fraud in 2025, with impersonation scams growing massively and AI-enabled scams becoming more effective. TRM Labs' 2026 Crypto Crime Report reported record illicit crypto flows in 2025. This means token detection cannot just be about price and volume. Trust, manipulation detection, and evidence quality are now core product value.

### Competitor Direction

Competitors are not only showing price/volume feeds:

- Bubblemaps emphasizes wallet clusters, token distribution, historical distribution, and hidden wallet connections.
- GMGN-style tools emphasize smart money, snipers, insiders, wallet tracking, and real-time trade alerts.
- DEXTools' DEXTScore shows that users expect a reliability score made from multiple separate dimensions, not only market activity.
- Dune and Bitquery show the direction of the data market: users and builders expect multi-chain, queryable, historical, and real-time data access.

Atlaix's advantage should not be "we show active tokens." Many tools do that. The advantage should be:

> "Atlaix explains whether activity is meaningful, trustworthy, early, manipulated, or actionable."

## 5. Architecture Review

### Current Architecture

Current flow:

1. `DatabaseService.getMarketData()` discovers and refreshes pair data.
2. `AlphaGauntletService.getDetectionEvents()` qualifies tokens.
3. The server runner runs every 5 minutes by default.
4. Top events are persisted to detection snapshots and synced to older detection events.
5. The UI fetches `/api/detection/feed`.
6. Token detail resolves live token info, derived timeline activities, webhook/recent chain activity, and quick actions.

This is sensible for an MVP, but it has several scaling and quality problems.

### Main Architecture Weaknesses

1. Discovery is query-driven, not event-driven.

`TARGET_QUERIES` is broad and useful, but it is still a rotating search strategy. That creates blind spots. Fast launches can happen and disappear before a query batch hits them.

2. Scoring is not outcome-calibrated.

The score is a weighted sum of market structure, liquidity health, activity, and event strength. This is explainable, but there is no evidence that 85 means "better" than 72 in forward returns or safety.

3. Freshness is mixed.

The live status showed 74 events in the feed, while the last scheduled detection run found 4 detected tokens. That means stored snapshots can dominate the user experience. Stored events are useful, but the UI needs to separate "freshly detected" from "still in watchlist/history."

4. Data quality is too dependent on pair-level aggregates.

Buy/sell counts, 24h volume, and FDV/liquidity are useful but can be gamed. Scammers can generate volume, rotate wallets, spoof organic activity, and manipulate buy/sell ratios.

5. Persistence policies are too open for production.

The SQL currently allows anonymous clients to insert and update detection snapshot/event tables. That is dangerous for a public product because users or attackers could poison the feed if the anon key is exposed.

## 6. Infrastructure Review

### Strengths

- Server runner exists and exposes status.
- Runs are bounded by interval, top limit, and prewarm concurrency.
- Detection feed has a shared server endpoint.
- Token activity has durable cache.
- Provider failures degrade rather than fully crash the UI.

### Gaps

1. No provider freshness score.

The DB has `last_provider_status`, but the current model does not expose a per-token freshness/confidence health indicator in the feed.

2. No queue for detection jobs.

The runner is an interval loop. As the system grows, detection should become queue-driven:

- discovery jobs,
- token refresh jobs,
- enrichment jobs,
- SafeScan jobs,
- wallet cohort jobs,
- alert evaluation jobs.

3. No historical signal store.

Snapshots overwrite the current state, but best-in-class detection needs historical state:

- score changes over time,
- trigger changes,
- holder concentration changes,
- smart-money flow changes,
- liquidity changes,
- post-detection returns.

4. No measurement/observability dashboard.

You need an internal "Detection Quality" dashboard:

- detections per chain,
- fresh vs stale detections,
- provider error rate,
- average detection age,
- post-detection price return,
- false-positive labels,
- rug/failure rate,
- user clicks by signal type,
- SafeScan risk distribution.

## 7. Signal & Intelligence Review

### Current Signals

Current trigger rules include:

- Volume Spike
- Transaction Spike
- Strong Buy Pressure
- Strong Sell Pressure
- Liquidity Added
- Liquidity Removed
- Holder Growth Spike
- Price Dump
- Price Recovery
- Abnormal Large Trades

These are useful first-pass signals.

### Signal Problems

1. "Holder Growth Spike" is weak.

The engine uses `holderProxy` from active wallets or transaction count. This is not actual holder growth. A token can have many transactions from a small group of wallets.

Better:

- actual holder count delta,
- new unique holders,
- retained holders after 30m/1h/6h,
- top-holder concentration change,
- percentage of holders with prior trading history.

2. Net flow is estimated.

When provider buy/sell volume is unavailable, buy volume is inferred from buy count ratio. That can mislead users because 10 small buys and 1 huge sell can appear buy-heavy.

Better:

- use actual DEX trades,
- compute USD buy/sell by trade side,
- identify large-wallet net flow,
- identify smart-wallet net flow separately from retail flow.

3. "Liquidity Added/Removed" is currently ratio-based.

The current trigger uses LP/market-cap and volume rather than actual LP add/remove events. That can classify a token as a liquidity event without proof that liquidity changed.

Better:

- detect actual LP mint/burn/add/remove transactions,
- identify liquidity owner,
- detect lock/burn status,
- detect migratable pools,
- detect sudden LP concentration changes.

4. Score lacks confidence.

Score and confidence should be separate.

Example:

- Alpha Score: 84
- Confidence: 41
- Reason: "Market activity is strong, but holder data and deployer history are missing."

Without confidence, the product can overstate weak data.

### Proposed Signal Stack

#### Layer A: Market Activity Score

Keep the existing score, but rename internally to `market_activity_score`.

Inputs:

- volume/liquidity ratio,
- buy/sell USD ratio,
- transaction velocity,
- price momentum,
- liquidity depth,
- age,
- spread/slippage if available.

#### Layer B: Wallet Quality Score

New score:

- smart-money inflow,
- profitable trader count,
- sniper count,
- insider-like wallet count,
- fresh wallet ratio,
- repeat deployer buyer ratio,
- top trader realized PnL,
- wallet retention after entry.

Example:

> Token A has $1M volume and score 86, but 78% of buyers are fresh wallets with no history and 12 wallets share the same funder. Wallet Quality Score: 22. This should not be promoted as clean accumulation.

#### Layer C: Distribution Risk Score

New score:

- top 10 holder percentage,
- top cluster percentage,
- deployer/team holdings,
- LP owner control,
- token supply minted to related wallets,
- hidden linked wallets,
- concentration trend.

Example:

> Top 10 holders control only 18%, which looks okay, but linked cluster analysis shows 31 wallets funded by the same source controlling 46%. Distribution Risk: Critical.

#### Layer D: Contract/Safety Score

New score:

- honeypot/tax status,
- proxy/upgrade risk,
- ownership renounced or not,
- mint/freeze/blacklist/pause permissions,
- verified code,
- transfer restrictions,
- LP lock/burn,
- creator history.

For EVM, align checks to OWASP Smart Contract Top 10 areas such as access control, business logic, oracle manipulation, flash-loan risks, input validation, unchecked external calls, arithmetic, reentrancy, and upgradeability.

#### Layer E: Manipulation Risk Score

New score:

- wash-like trade cycles,
- repeated same-size trades,
- volume from related wallets,
- buy/sell self-churn,
- short holding times,
- bot/sniper dominance,
- fake holder growth,
- suspicious bridge/funder patterns.

#### Layer F: Opportunity Score

This is the final user-facing ranking:

```
opportunity_score =
  market_activity_score * 0.25
  + wallet_quality_score * 0.25
  + early_momentum_score * 0.15
  + liquidity_quality_score * 0.10
  + smart_money_score * 0.15
  - manipulation_risk_penalty * 0.20
  - safety_risk_penalty * 0.30
```

Do not expose this exact formula forever. Treat it as a starting point, then tune from outcomes.

## 8. UX/UI Review

### Current UX Problem

The Detection page is clean, but too thin. It shows token, score, severity, and category. The detail page shows metrics and timeline, but the chart is unavailable and the timeline contains derived events mixed with real activity.

Users need proof, not just labels.

### Better Feed Card Example

Current:

> SKYAI | Score 88 | High | Liquidity Event

Better:

> SKYAI
> Opportunity 74 | Confidence 62 | Risk High
> Why now: volume 4.1x liquidity, 63% buy USD, 9 smart wallets entered in 18m.
> Caution: LP/MC ratio dropped, 22% top cluster, creator has 3 prior launches.
> Next action: Open evidence / Run Safe Scan / Create Alert.

### Detail Page Improvements

Add these sections:

1. Detection Thesis

Plain-language summary:

> "This token was admitted because market activity accelerated faster than liquidity. The signal is not clean accumulation because sell pressure and liquidity risk are also present."

2. Evidence Table

Show each trigger with:

- metric,
- threshold,
- current value,
- interpretation,
- confidence.

Example:

| Trigger | Current | Threshold | Meaning | Confidence |
| --- | ---: | ---: | --- | --- |
| Volume Spike | volume/liquidity 2.8x | >1.2x | pool is turning over rapidly | High |
| Buy Pressure | buy USD 61% | >54% | buyers lead flow | Medium |
| Holder Growth | 820 new holders | >300 | real distribution expanding | Low if inferred |

3. Risk Counter-Signals

Every bullish detection should show bearish risks.

Example:

> Counter-signals: top holder concentration rising, deployer wallet still controls liquidity, smart money has not entered, price up 40% but net flow is negative.

4. Timeline Separation

Separate:

- "Detection-derived events"
- "Real on-chain events"
- "Webhook/stream events"

Right now, derived timeline events use `source: 'recent-scan'`, which can make synthetic events look like observed chain events.

5. Chart Requirement

The "Chart not available" panel is a trust killer. Either integrate a chart or remove the chart promise. A detection engine without a price/liquidity chart feels incomplete.

Minimum viable chart:

- price line,
- volume bars,
- detection marker,
- liquidity line,
- buy/sell imbalance overlay.

## 9. Security & Manipulation Review

### How Scammers Can Bypass Today's Engine

1. Fake volume and transaction spikes.

They can run many buy/sell trades across wallets to hit Volume Spike and Transaction Spike.

Defense:

- detect related wallets,
- detect repeated trade sizing,
- detect circular flow,
- discount volume from linked wallets,
- require unique funded-wallet diversity.

2. Fake buy pressure.

They can create many small buys while a few large wallets distribute.

Defense:

- weight buy/sell by USD, not count,
- show whale net flow separately,
- show top holder delta.

3. Fake holder growth.

They can split supply across many fresh wallets.

Defense:

- score fresh-wallet ratio,
- cluster by common funder,
- detect same-block/same-source distribution,
- compare holder count vs independent holder count.

4. Liquidity theater.

They can add enough liquidity to pass thresholds while keeping LP control or making liquidity removable.

Defense:

- detect LP lock/burn,
- identify LP owner,
- track actual LP add/remove events,
- penalize unlockable or creator-controlled liquidity.

5. Delayed rug after clean entry.

They can make early data look safe, then rug later.

Defense:

- continuous post-detection risk monitoring,
- alert when top clusters sell,
- alert when LP removed,
- alert when ownership/permissions change,
- alert when smart money exits.

## 10. Risks & Blind Spots

Current high-risk blind spots:

- Snapshot table RLS allows anon inserts/updates.
- Detection category can over-prioritize "Liquidity Event" because liquidity triggers are inferred from ratios.
- Stored snapshots can make stale events look current.
- No true positive/false positive measurement.
- No post-detection return tracking.
- No explicit provider confidence/freshness on the UI.
- No wallet cohort intelligence in Detection feed.
- No deployer/creator history in Detection feed.
- No holder cluster or supply distribution risk in Detection feed.
- No chart despite chart placeholder.
- No clear distinction between derived activity and observed on-chain events.

## 11. Expert Debate Summary

### Product Strategy Lead

The product should not compete as a generic DEX dashboard. The winning position is "explainable Web3 intelligence for whether a token signal is real, early, safe, and actionable."

### Web3 Systems Architect

DexScreener is useful, but it should become one input, not the backbone. The engine needs indexed DEX trades, holder deltas, top-holder changes, LP events, and wallet cohort streams.

### Data Signal Scientist

The current score is transparent but uncalibrated. Add confidence and outcome labels before adding complex AI. Track every detection's future performance and safety outcome.

### Scam & Rug Research Specialist

The engine is vulnerable to fake volume, bundled supply, linked wallets, and liquidity theater. Add adversarial features before calling high-score events "high quality."

### Senior UI/UX Designer

The UI needs evidence. Users trust clear proof, uncertainty, and counter-signals more than a single big score.

### Contrarian Reviewer

Do not add 50 new signals and call it intelligence. If signals are not measured, explainable, and visible in the UI, they will become decorative complexity. The first upgrade should be evidence quality and outcome measurement.

## 12. Priority Recommendations

### P0: Fix Trust and Data Integrity

1. Lock Supabase write policies.

Move writes to server/service role only. Public clients should not insert/update detection tables.

Success metric: no client-side detection write path can mutate global feed tables.

2. Add detection freshness and source labels.

Every event should show:

- first detected,
- last refreshed,
- data source,
- provider health,
- confidence.

Success metric: users can tell whether a signal is fresh, stale, degraded, or inferred.

3. Separate synthetic vs observed events.

Do not label derived timeline activity as recent scan. Use source labels:

- `derived-detection`
- `observed-chain`
- `webhook`
- `provider-snapshot`

Success metric: users understand what actually happened on-chain.

### P1: Build Signal Quality Foundation

4. Add outcome tracking.

For every detection, store:

- price at detection,
- liquidity at detection,
- market cap at detection,
- 5m/15m/1h/6h/24h returns,
- max drawdown,
- max upside,
- rug/safety failure flag,
- smart-money exit flag.

Success metric: score calibration report can answer "which signals worked?"

5. Split score into Activity, Risk, Confidence, and Opportunity.

Do not ask one number to mean everything.

Success metric: a high-activity risky token does not look the same as a high-confidence opportunity.

6. Add evidence cards.

Show trigger thresholds and values.

Success metric: users can explain why a token was admitted without reading code.

### P2: Add On-Chain Intelligence

7. Add wallet cohort enrichment.

For detected tokens, compute:

- top buyers by USD,
- top sellers by USD,
- profitable wallet count,
- fresh wallet ratio,
- sniper ratio,
- known smart wallet inflow,
- whale net flow,
- holder retention.

Success metric: pro traders can see who is driving the signal.

8. Add holder/cluster risk.

Compute:

- top 10 holders,
- top 50 holders,
- top linked cluster,
- common funder groups,
- deployer/team holdings,
- holder distribution delta.

Success metric: fake decentralization is flagged before users trust volume.

9. Add deployer/creator history.

Track creator wallet:

- prior launches,
- prior rugs/failures,
- average token lifespan,
- repeated LP removal,
- funding source,
- links to current holders.

Success metric: repeat rug/deployer patterns are caught.

### P3: Real-Time and Product Differentiation

10. Move toward event-driven ingestion.

Use streaming/indexed providers for:

- DEX trades,
- LP events,
- wallet trades,
- new pair launches,
- holder updates.

Bitquery's docs describe real-time wallet trade streams across Solana, Ethereum, BSC, Base, and Arbitrum. That is the class of data architecture Atlaix needs for serious real-time intelligence.

11. Build a Detection Copilot summary.

Generate a concise intelligence brief:

> "Strong activity, weak trust. Good for watchlist, not entry. Needs SafeScan confirmation."

Success metric: higher click-through to meaningful next actions and lower confusion.

12. Add alerts based on thesis invalidation.

Examples:

- smart money entered then exited,
- LP removed,
- top cluster sold,
- buy pressure flipped to sell pressure,
- safety risk changed,
- volume proved wash-like.

## 13. Quick Wins

These can ship quickly:

1. Add a "Fresh / Stale / Degraded" badge to Detection cards.
2. Rename current score to "Activity Score" in UI.
3. Add separate "Confidence" placeholder using data completeness.
4. Add "Why detected" trigger explanation panel.
5. Add "Counter-signals" panel.
6. Add chart integration or remove chart placeholder until ready.
7. Add source labels to timeline events.
8. Add server-only writes for detection tables.
9. Add post-detection price snapshots.
10. Add "Run Safe Scan" auto-start from detected token detail, already implemented.

## 14. Long-Term Improvements

1. Build an event-sourced detection database.

Tables:

- `detected_tokens`
- `detection_events`
- `detection_signal_components`
- `detection_outcomes`
- `token_holder_snapshots`
- `wallet_cohort_observations`
- `token_risk_snapshots`
- `liquidity_events`
- `deployer_profiles`

2. Add model calibration.

Start with rules, then learn weights from outcomes.

Do not jump straight to black-box ML. First collect labels:

- good signal,
- late signal,
- rug,
- wash-traded,
- false positive,
- safe but inactive,
- smart-money-led,
- insider-led.

3. Build chain-specific adapters.

Solana, EVM, BSC/Base, and launchpad ecosystems behave differently. Do not force one threshold set across all chains.

4. Add adversarial simulation tests.

Create test fixtures for:

- fake volume,
- many fresh wallets,
- bundled launch,
- top-holder dump,
- LP removal,
- smart-money entry,
- smart-money exit,
- high volume but honeypot,
- price pump with negative whale net flow.

## 15. Implementation Plan

### Phase 1: Trust Layer, 1-2 weeks

- Lock detection table writes to server/service role.
- Add `source_kind`, `confidence`, `data_freshness`, `provider_status`, `last_observed_at`.
- Rename UI score to Activity Score.
- Add "Why detected" and "Counter-signals."
- Add chart or remove chart placeholder.
- Add separate timeline source labels.

### Phase 2: Outcome Tracking, 1-2 weeks

- Create `detection_outcomes` table.
- On detection, store baseline price/liquidity/market cap.
- Schedule outcome snapshots at 5m, 15m, 1h, 6h, 24h.
- Add internal outcome report.
- Tune thresholds based on observed results.

### Phase 3: Safety and Manipulation Layer, 2-4 weeks

- Integrate SafeScan summary into Detection feed.
- Add holder concentration.
- Add LP owner/lock/burn status.
- Add creator/deployer profile.
- Add manipulation flags.

### Phase 4: Wallet Intelligence Layer, 3-6 weeks

- Add wallet cohort enrichment.
- Add smart-money inflow/outflow.
- Add top traders by token.
- Add profitable wallet count.
- Add fresh-wallet and sniper ratios.

### Phase 5: Best-in-Class Intelligence, ongoing

- Event-driven ingestion.
- Cluster detection.
- Chain-specific thresholds.
- Personalized alerts.
- AI-generated intelligence summaries grounded in evidence.
- Public "Detection Accuracy" transparency metrics.

## 16. Codex-Ready Execution Instructions

### Task 1: Add Detection Source and Confidence Model

Implement:

- `DetectionConfidenceService`
- `sourceKind` on timeline events
- `confidence` field on `AlphaGauntletEvent`
- UI badge: Fresh, Stale, Degraded, Inferred

Acceptance criteria:

- Detection cards show Activity Score and Confidence separately.
- Derived timeline events no longer appear as observed chain activity.
- Missing holder/wallet/provider data lowers confidence.

### Task 2: Add Outcome Tracking

Implement:

- SQL table `detection_outcomes`
- server runner job to snapshot outcomes
- API endpoint `/api/detection/outcomes`
- internal outcome summary in Detection page or hidden admin view

Acceptance criteria:

- Every new detection stores baseline price/liquidity.
- Outcome snapshots are recorded at multiple horizons.
- Report shows average 1h/24h return by trigger and event type.

### Task 3: Add Evidence Panel

Implement:

- `DetectionEvidencePanel`
- show trigger, current value, threshold, explanation, confidence
- show counter-signals

Acceptance criteria:

- Token detail clearly explains why token was admitted.
- Users can see which metrics are inferred vs observed.

### Task 4: Harden Supabase Policies

Implement:

- remove anon insert/update policies from detection tables
- server-only upsert path
- test that client cannot mutate global feed

Acceptance criteria:

- Public browser key can read but cannot write detection events.
- Server runner still syncs snapshots successfully.

### Task 5: Add Wallet Cohort Enrichment

Implement:

- top buyers/sellers by USD
- fresh wallet ratio
- smart wallet inflow
- whale net flow
- sniper ratio where possible

Acceptance criteria:

- Detection detail shows "Who is behind the move?"
- Feed can rank clean accumulation above fake noisy volume.

## Source Notes

- Chainalysis, "Record $17 Billion Estimated Stolen in Crypto Scams and Fraud in 2025..." January 13, 2026: https://www.chainalysis.com/blog/crypto-scams-2026/
- TRM Labs, "2026 Crypto Crime Report," January 28, 2026: https://www.trmlabs.com/ko/reports-and-whitepapers/2026-crypto-crime-report
- DEX Screener API reference: https://docs.dexscreener.com/api/reference
- Bitquery Traders API: https://docs.bitquery.io/docs/trading/crypto-trades-api/traders-api/
- Bubblemaps V2: https://bubblemaps.io/v2
- OWASP Smart Contract Top 10 2026: https://owasp.org/www-project-smart-contract-top-10/
- a16z State of Crypto 2025: https://a16zcrypto.com/posts/article/state-of-crypto-report-2025/
- Dune platform metrics: https://dune.com/metrics
