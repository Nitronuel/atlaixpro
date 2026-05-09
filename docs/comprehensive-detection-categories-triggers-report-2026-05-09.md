# Atlaix Detection Engine Category and Trigger Redesign Report

Date: 2026-05-09

Scope: Comprehensive Development Council report for improving the Atlaix Detection Engine classification categories, triggers, search criteria, scoring, and user-facing intelligence while using primarily DexScreener and only selective low-cost Alchemy. This report intentionally does not depend on the current Smart Money Engine page or Safe Scan page, because those areas are not yet strong enough to act as core detection inputs.

## 1. Executive Summary

The current Detection Engine is not useless. It is a good early market-activity detector. The problem is that it currently looks more confident than it really is. It combines broad DexScreener market signals into categories such as `Accumulation`, `Distribution`, `Liquidity Event`, `Market Stress`, `Recovery`, and `Unusual Activity`, but several triggers are inferred too aggressively and some labels imply stronger evidence than the system actually has.

The most important finding is that the engine should stop acting like one universal score and become a multi-lane detection system:

1. DexScreener discovery finds candidates cheaply.
2. DexScreener classification assigns activity categories and evidence.
3. Low-cost Alchemy verification is used only for top candidates and user-opened details.
4. The UI shows why the token was detected, how confident the engine is, and what can go wrong.
5. Outcome tracking measures whether the engine's signals worked after 5 minutes, 15 minutes, 1 hour, 6 hours, and 24 hours.

The current classification criteria need meaningful changes:

- Rename the current main `score` to `Activity Score`. It is not a complete alpha, safety, or trust score.
- Add `Confidence Score` based on data freshness, source quality, data completeness, and whether evidence is observed or inferred.
- Add `Market Quality Score` to separate real liquidity and trade quality from raw hype.
- Add `Manipulation Risk` using only market-data evidence until Safe Scan and Smart Money are ready.
- Replace the single hard market eligibility gate with lane-specific gates for Fresh Launch, Emerging Momentum, Established Momentum, Liquidity Risk, Market Stress, Paid Attention, and Watchlist Candidate.
- Stop using `Liquidity Added` and `Liquidity Removed` unless liquidity is compared across snapshots or verified with Alchemy logs. Current static liquidity ratios should be renamed to `Deep Liquidity Structure` and `Thin Liquidity Risk`.
- Stop using `Holder Growth Spike` from the current holder proxy. It is mostly a transaction proxy, not real holder growth.
- Make triggers more selective. In the local feed snapshot, `Transaction Spike` fired on 70 of 74 events and `Abnormal Large Trades` fired on 67 of 74 events. That means those triggers are too common to guide decisions.

The product goal should be: users should understand why a token appeared, what evidence supports it, what evidence contradicts it, and whether the signal is early, mature, risky, or uncertain.

## 2. Current System Assessment

### What the current engine does well

The current engine already uses a practical set of cheap pair-level inputs:

- market cap,
- liquidity,
- 24h volume,
- buy and sell transaction counts,
- estimated buy and sell volume,
- estimated net flow,
- pair age,
- liquidity-to-market-cap ratio,
- volume-to-liquidity ratio,
- price change,
- trigger count,
- and a simple severity score.

This is a reasonable MVP foundation because DexScreener data is fast and cheap. The engine can discover active tokens, produce a feed, and explain some surface-level market behavior.

### What is weak today

The weaknesses are mostly signal-quality and naming problems:

- The current score mixes market size, liquidity, activity, and event strength into one number. Users may interpret it as "good token" or "alpha", but it is mostly activity intensity.
- Some labels sound like observed facts even when they are inferred. Example: `Liquidity Removed` can fire from a low liquidity-to-market-cap ratio plus high volume, even if the engine did not observe LP withdrawal.
- Some triggers overfire. When most detected tokens share the same trigger, the trigger is no longer a meaningful differentiator.
- `Holder Growth Spike` is not actual holder growth because it can be created from `transactions24h * 0.65`.
- Current category priority makes `Liquidity Event` dominate because liquidity triggers are evaluated first.
- The engine does not yet track whether detections led to useful outcomes.

### Current live feed snapshot

Local feed check on 2026-05-09:

- Total events: 74
- Event type distribution:
  - `Liquidity Event`: 27
  - `Market Stress`: 12
  - `Unusual Activity`: 11
  - `Recovery`: 11
  - `Accumulation`: 10
  - `Distribution`: 3
- Trigger distribution:
  - `Transaction Spike`: 70
  - `Abnormal Large Trades`: 67
  - `Volume Spike`: 49
  - `Holder Growth Spike`: 46
  - `Strong Buy Pressure`: 38
  - `Liquidity Removed`: 26
  - `Price Recovery`: 22
  - `Strong Sell Pressure`: 16
  - `Price Dump`: 15
  - `Liquidity Added`: 1

Interpretation: the engine is good at finding busy tokens, but the trigger distribution is too compressed. A great detection engine should tell users what is unusual about this specific token. Today, too many detections look similar.

## 3. Provider Constraint and Design Principle

### DexScreener should be the broad discovery layer

DexScreener's API supports useful discovery and pair context:

- latest token profiles,
- latest community takeovers,
- latest ads,
- latest boosted tokens,
- top active boosted tokens,
- paid order status,
- pair lookup,
- search,
- token pools,
- token-to-pair lookup for up to 30 token addresses per request.

The engine should use these endpoints to build a broad candidate universe and refresh active candidates frequently. DexScreener should power most of the feed because it is cheap and fast.

### Alchemy should be the selective verification layer

Alchemy should be used carefully. According to Alchemy's compute unit docs, some calls are cheap enough for selective enrichment, while others should be used sparingly:

- `alchemy_getTokenMetadata`: low cost.
- `alchemy_getTokenBalances`: low cost.
- `eth_getCode`: low cost.
- `eth_getLogs`: moderate cost.
- `alchemy_getAssetTransfers`: more expensive than simple token metadata or balances.
- Solana `getTokenLargestAccounts`, `getTokenSupply`, `getTokenAccountsByOwner`, `getSignaturesForAddress`, and `getTransaction` can help, but should be sampled and cached.

Recommendation: do not use Alchemy for every token in the feed. Use it for:

- top 5 percent of candidates by DexScreener score,
- tokens the user opens,
- tokens that cross a high-impact threshold,
- tokens in watchlists,
- and tokens with contradictory evidence.

### Do not depend on Safe Scan or Smart Money yet

Because Smart Money and Safe Scan are not ready enough, detection should not depend on them. The Detection Engine can still expose placeholder fields later, but the first improved version should use:

- DexScreener market and attention data,
- historical DexScreener snapshots stored by Atlaix,
- selected Alchemy transfer, balance, metadata, and log checks,
- and internal outcome tracking.

This distinction matters. Atlaix can say "market and liquidity risk" today. It should not imply "contract is safe" or "smart money is accumulating" until those systems are genuinely reliable.

## 4. Real User Needs Analysis

### Retail users need clarity and protection

Retail users ask:

- Why did this token appear?
- Is this early or already overextended?
- Is the activity real or possibly fake?
- Is liquidity strong enough to exit?
- What is the main risk?
- What should I watch next?

Retail users need plain explanations and visible uncertainty. A label like `Accumulation` without confidence, counter-signals, and liquidity risk can mislead them.

### Pro traders need timing and evidence

Pro traders ask:

- Is this signal early enough to matter?
- Is volume accelerating across timeframes?
- Is buy pressure real in USD terms?
- Is the pool deep enough for execution?
- Is this paid attention, organic momentum, or wash-like activity?
- What changed in the last 5 to 15 minutes?

Pro traders do not just need a high score. They need speed, freshness, and evidence.

### Engineers need measurable definitions

Engineers need triggers that are:

- computed from available fields,
- testable with fixtures,
- explainable in the UI,
- versioned,
- measurable against later outcomes,
- and not dependent on vague "alpha" language.

## 5. Market and Competitor Research

The strongest market lesson is that raw volume is not enough. Market manipulation research repeatedly points to the relationship between volume, trade count, liquidity, wallet diversity, and repeated counterparties.

Chainalysis' 2025 market manipulation research discusses suspected wash trading and pump-and-dump behavior and emphasizes that on-chain patterns can reveal suspicious activity, but heuristics are not definitive. The takeaway for Atlaix: do not claim certainty from one market signal. Use layered confidence.

The OECD report on DeFi liquidity concentration notes that volume and trade count relationships matter. Large volume with small trade count can indicate whales or concentrated activity. Small volume with abnormally high trade count can suggest micro-trade manipulation. Healthy markets usually show both meaningful volume and enough diversified trade count.

This directly applies to the Detection Engine:

- `Volume Spike` alone is weak.
- `Transaction Spike` alone is weak.
- Volume divided by transaction count, liquidity depth, and recent price response should be evaluated together.
- The engine should surface "volume quality", not just volume quantity.

DexScreener also provides attention data such as boosts, ads, token profiles, and paid order status. That is strategically useful, but it should be treated as attention evidence, not quality evidence. A token can be boosted and dangerous. A token can be unboosted and excellent. Boosts should improve discovery and explain attention, not automatically raise trust.

## 6. Architecture Review

### Current architecture problem

The current engine mostly works like this:

1. Gather market data.
2. Apply one eligibility gate.
3. Generate triggers.
4. Classify category.
5. Compute one total score.
6. Sort feed.

This is simple, but it makes every token compete in the same lane. A 3-hour token, a 3-day token, and a 3-month token should not use the same thresholds.

### Recommended architecture

Build a detection pipeline with separate modules:

1. `CandidateDiscoveryService`
   - Pulls from DexScreener search, token profiles, boosts, ads, orders, community takeovers, and existing watchlist tokens.

2. `PairSnapshotService`
   - Stores DexScreener snapshots every run for candidates.
   - Keeps 5m, 15m, 1h, 6h, and 24h comparison windows.

3. `DetectionLaneService`
   - Assigns lane based on age, liquidity, volume, market cap, attention source, and volatility.

4. `TriggerEngine`
   - Computes observed and inferred triggers.
   - Marks each trigger with evidence type: `observed`, `derived`, `inferred`, or `unverified`.

5. `ClassificationEngine`
   - Produces primary category, secondary tags, confidence, and counter-signals.

6. `OutcomeTracker`
   - Tracks detection outcomes at 5m, 15m, 1h, 6h, 24h.
   - Calibrates thresholds over time.

8. `EvidencePresenter`
   - Builds user-facing "why detected", "what supports this", "what weakens this", and "what to watch next" blocks.

## 7. Infrastructure Review

### DexScreener request strategy

Use request tiers:

- Tier 1, every cycle:
  - latest token profiles,
  - latest boosts,
  - top boosts,
  - ads/latest,
  - community takeovers,
  - hot search queries.

- Tier 2, every cycle for candidates:
  - token-pairs lookup,
  - token batch lookup up to API limits,
  - pair lookup for already tracked pairs.

- Tier 3, lower frequency:
  - paid orders for tokens that have attention,
  - older watchlist refresh,
  - stale candidate rechecks.

### Cache and snapshot requirements

The engine needs internal history. DexScreener gives the current state, but better detection needs change over time. Store:

- pair address,
- token address,
- chain,
- timestamp,
- priceUsd,
- liquidityUsd,
- fdv,
- marketCap,
- volume windows,
- txns windows,
- buys and sells by window,
- priceChange windows,
- boosts,
- profile/social fields,
- detection lane,
- computed trigger outputs.

Minimum retention:

- high-priority candidates: 24 to 72 hours,
- feed tokens: 7 to 14 days,
- aggregated outcomes: keep indefinitely.

### Alchemy cost control

Use a strict budget:

- Only enrich the top ranked candidates and opened token pages.
- Cache enrichment by `chain:tokenAddress` for at least 10 to 30 minutes.
- Run deeper verification only when the signal is high value or contradictory.
- Record the reason for enrichment, such as `top_candidate`, `user_opened`, `liquidity_conflict`, or `high_severity`.

## 8. Signal and Intelligence Review

## 8.1 Category Assessment and Recommendations

### Current category: Accumulation

Current meaning: strong buy pressure plus volume spike or high buy/sell ratio.

What is good:

- Buy pressure is a useful detection signal.
- It is understandable to users.
- It can identify tokens entering attention cycles.

What is weak:

- Buy count ratio can be gamed by many small buys.
- USD flow matters more than count alone.
- If price is already extremely up, it may be late momentum, not accumulation.
- If net flow is positive but liquidity is thin, users may not be able to exit safely.

Recommended replacement:

Primary category: `Accumulation`

Use only when at least 3 of 5 are true:

- buy/sell count ratio >= 1.25,
- estimated buy volume/sell volume ratio >= 1.15,
- net flow positive and >= max($25k, 5 percent of 24h volume),
- price is positive or stable across h1/h6/h24,
- volume/liquidity ratio is healthy but not absurd.

Downgrade if:

- liquidity/marketCap is too thin,
- price is up sharply but net flow is weak,
- sell pressure is increasing in shorter windows,
- paid attention is present without organic activity,
- or Alchemy sample shows low wallet diversity.

Example:

Token A has $800k volume, $250k liquidity, 1.6 buy/sell count ratio, +$90k estimated net flow, h1 +8 percent, h24 +22 percent. This can be `Accumulation` with medium confidence. If the same token has only $40k liquidity and 80 percent of activity came from a few wallets, classify it as `Accumulation Attempt` or `Momentum With Concentration Risk`, not clean accumulation.

### Current category: Distribution

Current meaning: strong sell pressure, negative net flow, or price weakness.

What is good:

- Users need to know when exits may be happening.
- Sell pressure plus price weakness is meaningful.

What is weak:

- Some sell pressure is healthy profit taking.
- A token can show more sell count but higher buy USD volume.
- Distribution should care about liquidity deterioration and price failure.

Recommended replacement:

Primary category: `Distribution`

Use when at least 3 of 5 are true:

- sell/buy count ratio >= 1.25,
- estimated sell volume/buy volume ratio >= 1.15,
- net flow negative and abs(netFlow) >= max($25k, 5 percent of volume),
- price is weak across h1/h6 or h24,
- liquidity is flat or falling while sell pressure rises.

Severity should increase if:

- h1 is down while h24 is still up,
- liquidity is thin relative to market cap,
- volume is high but price fails to rise,
- or repeated snapshots show sell pressure accelerating.

Example:

Token B is h24 +40 percent but h1 -9 percent, sell volume ratio 1.4, net flow -$180k, liquidity down 18 percent from 1 hour ago. This should be `Distribution` or `Market Stress`, not `Recovery`.

### Current category: Market Stress

Current meaning: price dump plus sell pressure or weak liquidity.

What is good:

- This is a valuable protective category.
- Users need fast warnings when price, sell flow, and liquidity align badly.

What is weak:

- A simple price dump alone can be normal volatility.
- The engine should distinguish panic, liquidity failure, and ordinary pullback.

Recommended replacement:

Primary category: `Market Stress`

Subtypes:

- `Selloff`: price down plus sell dominance.
- `Liquidity Stress`: liquidity down or liquidity too thin for volume.
- `Volatility Shock`: large price movement with unclear flow direction.
- `Failed Recovery`: price bounced but selling returned.

Use when:

- h1 <= -8 percent or h24 <= -15 percent,
- and at least one of sell dominance, liquidity risk, negative net flow, or volume/liquidity stress is present.

Example:

Token C h1 -12 percent, h24 -25 percent, sell/buy ratio 1.5, liquidity/marketCap 0.05. This is high-priority `Market Stress`. Do not bury it as generic `Unusual Activity`.

### Current category: Recovery

Current meaning: price recovery plus volume spike.

What is good:

- Recovery signals can be useful when a token reverses from stress.

What is weak:

- Current recovery does not require proof of a previous drawdown.
- A token that is simply pumping can be mislabeled as recovery.
- A token with price recovery but negative flow may be exit liquidity, not recovery.

Recommended replacement:

Primary category: `Recovery`

Use only when:

- prior drawdown exists in stored snapshots or h24/h6 context,
- h1 or h6 turns positive,
- volume expands,
- sell pressure decreases,
- and liquidity is stable or improving.

Subtypes:

- `Clean Recovery`: buy pressure and liquidity support the bounce.
- `Weak Recovery`: price bounce exists, but flow or liquidity is not convincing.
- `Exit Bounce`: price up while net flow is negative or sell pressure remains strong.

Example:

Token D was h24 -22 percent, now h1 +7 percent, volume/liquidity 0.9, buy/sell ratio 1.4, liquidity stable. This is `Recovery`. If net flow is -$120k, label it `Exit Bounce Risk`.

### Current category: Liquidity Event

Current meaning: liquidity added or removed triggers.

What is good:

- Liquidity is central to whether users can enter and exit.
- Liquidity changes are critical for rugs, migrations, and pool health.

What is weak:

- The current trigger is not actually observing liquidity additions/removals.
- Static liquidity/market-cap ratio should not be called an event.
- Liquidity classification currently dominates the feed.

Recommended replacement:

Remove `Liquidity Event` as a broad primary category unless there is observed change.

Use these instead:

- `Liquidity Expansion`: liquidity increased materially across snapshots or LP add event is observed.
- `Liquidity Contraction`: liquidity decreased materially across snapshots or LP remove event is observed.
- `Thin Liquidity Risk`: liquidity is too low relative to market cap or volume.
- `Liquidity Quality Warning`: liquidity exists, but volume/liquidity turnover is extreme or multi-pool quality is weak.

Rules:

- `Liquidity Expansion`: liquidityUsd now >= 1.25x liquidityUsd 1h ago and absolute increase >= $25k.
- `Liquidity Contraction`: liquidityUsd now <= 0.75x liquidityUsd 1h ago and absolute decrease >= $25k.
- `Thin Liquidity Risk`: liquidity/marketCap <= 0.08 or liquidity < lane minimum.
- `Turnover Stress`: volume24h/liquidity >= 5 for mature tokens, or >= 8 for fresh launches.

Example:

Token E has $5M market cap and $120k liquidity. Do not say `Liquidity Removed` unless liquidity actually dropped. Say `Thin Liquidity Risk`.

### Current category: Unusual Activity

Current meaning: fallback category when no stronger classification wins.

What is good:

- A fallback is useful.

What is weak:

- It is too vague.
- Users do not know whether it means opportunity, danger, or incomplete data.

Recommended replacement:

Keep `Unusual Activity`, but add sublabels:

- `Unusual Activity - Volume/Price Divergence`
- `Unusual Activity - High Churn`
- `Unusual Activity - Paid Attention`
- `Unusual Activity - Low Confidence`
- `Unusual Activity - Needs Verification`

Example:

Token F has high volume and transaction count, but price is flat and buy/sell is balanced. This should be `High Churn`, not generic unusual activity.

## 8.2 New Recommended Categories

### Fresh Launch

Purpose: detect early tokens without forcing them through mature-token thresholds.

Use when:

- pair age is 10 minutes to 6 hours,
- liquidity >= $25k to $75k depending on chain,
- 5m/1h activity is accelerating,
- and there is at least one meaningful attention or flow signal.

Always show:

- `High Uncertainty`,
- liquidity depth,
- holder/wallet diversity unknown unless Alchemy verified,
- and "not contract-safety verified" unless Safe Scan later supports it.

### Emerging Momentum

Purpose: identify tokens gaining traction after launch noise.

Use when:

- age is 6 hours to 3 days,
- volume, transactions, and price are aligned,
- liquidity meets lane minimum,
- and activity is not purely paid attention.

### Established Momentum

Purpose: avoid overfitting mature tokens to fresh-token thresholds.

Use when:

- token is older than 3 days,
- liquidity and market cap are meaningfully higher,
- and volume/price activity is strong relative to the token's own recent baseline.

### Paid Attention

Purpose: use DexScreener boosts, ads, profiles, and orders properly.

Use when:

- token appears in latest boosts, top boosts, latest ads, token profile, community takeover, or paid orders.

Important: paid attention is a discovery signal, not a quality signal.

User-facing copy:

"This token is receiving DexScreener attention, but market quality must confirm it."

### Watchlist Candidate

Purpose: avoid false urgency.

Use when:

- token has interesting early signals but not enough evidence for a stronger category.

This is useful because not every detection needs to scream. Some should say "watch this, not act now."

## 9. Trigger-by-Trigger Assessment

### Trigger: Volume Spike

Current rule:

- volume/liquidity >= 1.2, or volume/marketCap >= 0.2, or volume >= $1M.

Problem:

- This fires too often.
- It ignores token age and baseline.
- A volume spike can be organic, paid, wash-like, or panic-driven.

Recommended trigger:

Rename to `Volume Expansion`.

Use lane-aware thresholds:

- Fresh Launch: volume1h/liquidity >= 0.7 or volume24h/liquidity >= 2.0.
- Emerging Momentum: volume24h/liquidity >= 1.0 and h1/h6 activity aligned.
- Established Momentum: volume must beat the token's own previous baseline if Atlaix has snapshots.

Add subtrigger:

- `Low Quality Volume` when transaction count is very high but average trade size is tiny.
- `Whale Volume` when volume is high but trade count is low.

### Trigger: Transaction Spike

Current rule:

- transactions24h >= 2000 or transactions24h/holderProxy >= 2.

Problem:

- It fired on 70 of 74 events.
- Absolute transaction thresholds punish mature tokens and overstate busy meme tokens.

Recommended trigger:

Rename to `Trade Count Acceleration`.

Use:

- short-window acceleration when DexScreener provides m5/h1 transaction windows,
- stored snapshot deltas when current API fields are not enough,
- and lane-aware thresholds.

Suggested logic:

- Fresh Launch: txns1h >= 100 and buys+sells rising compared with previous snapshot.
- Emerging Momentum: txns24h >= 500 and h1 share of 24h txns is unusually high.
- Established Momentum: txns must be high relative to the token's own prior baseline.

### Trigger: Strong Buy Pressure

Current rule:

- buy/sell count ratio and net flow combinations.

Problem:

- Count ratio can be gamed.
- Buy pressure should be USD-weighted when possible.

Recommended trigger:

Rename to `Buyer Dominance`.

Use:

- buy count ratio,
- estimated buy USD/sell USD ratio,
- positive net flow,
- price confirmation,
- and liquidity quality.

Suggested:

- buyerDominanceScore = weighted average of buyCountRatio, buyVolumeRatio, netFlowPercentOfVolume, and price confirmation.
- Trigger only if score >= 70.

### Trigger: Strong Sell Pressure

Current rule:

- sell count ratio and net flow combinations.

Recommended trigger:

Rename to `Seller Dominance`.

Use:

- sell count ratio,
- estimated sell USD/buy USD ratio,
- negative net flow,
- price weakness,
- and liquidity weakness.

Important distinction:

- If price is flat but seller dominance is rising, label `Distribution Risk`.
- If price is collapsing, label `Market Stress`.

### Trigger: Liquidity Added

Current problem:

- Static liquidity ratio is not actual added liquidity.

Recommended trigger:

Use `Liquidity Added` only if:

- current liquidity increased vs stored previous snapshot,
- absolute increase >= $25k,
- relative increase >= 20 to 30 percent depending on lane,
- or Alchemy LP event/log confirms addition.

Otherwise use `Deep Liquidity Structure`.

### Trigger: Liquidity Removed

Current problem:

- Static thin liquidity is not actual removed liquidity.

Recommended trigger:

Use `Liquidity Removed` only if:

- liquidity decreased materially vs stored snapshot,
- absolute decrease >= $25k,
- relative decrease >= 20 to 30 percent,
- or Alchemy LP event/log confirms removal.

Otherwise use `Thin Liquidity Risk`.

### Trigger: Holder Growth Spike

Current problem:

- The current holder proxy is not holder growth.

Recommendation:

Remove or rename.

DexScreener-only name:

- `Active Trade Proxy Spike`.

Alchemy-enriched name:

- `Wallet Diversity Expansion`.

Alchemy sample:

- recent unique buyer wallets,
- recent unique seller wallets,
- top 5 wallet share of sampled transfers,
- repeat-wallet ratio,
- possible fresh-wallet ratio.

Do not claim holder growth without real holder or transfer-holder evidence.

### Trigger: Price Dump

Current rule:

- h24 <= -12 percent or h1 <= -8 percent.

Recommendation:

Rename to `Price Breakdown`.

Use with context:

- h1 <= -8 percent is urgent.
- h24 <= -15 percent is important but may be stale.
- severity increases when seller dominance or liquidity contraction is present.

### Trigger: Price Recovery

Current rule:

- h1 >= 5 percent or h24 >= 12 percent, h24 > -10 percent, and volume/liquidity >= 0.5.

Problem:

- Does not require actual prior stress.

Recommendation:

Rename to `Recovery Attempt`.

Use only if:

- prior drawdown exists,
- h1/h6 turns positive,
- volume expands,
- seller dominance declines,
- liquidity is stable.

If price rises without previous drawdown, classify as `Momentum`, not recovery.

### Trigger: Abnormal Large Trades

Current rule:

- abs net flow >= $35k or abs net flow >= 8 percent of volume.

Problem:

- It fired on 67 of 74 events.
- It is too broad.

Recommended triggers:

- `Large Inflow`
- `Large Outflow`
- `Whale-Dominated Flow`
- `Flow Divergence`

Dynamic thresholds:

- liquidity < $250k: large flow >= max($25k, 12 percent liquidity, 15 percent volume)
- liquidity $250k to $1M: large flow >= max($75k, 8 percent liquidity, 10 percent volume)
- liquidity > $1M: large flow >= max($150k, 5 percent liquidity, 8 percent volume)

Flow divergence examples:

- Price up while net flow negative: possible exit liquidity.
- Price down while net flow positive: possible absorption or delayed price response.

## 10. New Triggers to Add

### Attention Trigger

Sources:

- DexScreener token boosts latest/top,
- ads/latest,
- token profiles,
- community takeovers,
- paid orders.

Labels:

- `Boosted Attention`
- `Paid Ad Attention`
- `Profiled Token`
- `Community Takeover`
- `Trending Order`

Use for discovery and explanation, not trust.

### Volume Quality Trigger

Purpose: distinguish healthy activity from suspicious churn.

Inputs:

- volume,
- transaction count,
- average trade size,
- liquidity,
- price movement.

Labels:

- `Healthy Volume`: meaningful volume, sufficient trade count, price confirms.
- `Micro-Trade Churn`: many trades, small average size, weak price movement.
- `Whale-Dominated Volume`: high volume, low trade count.
- `Inefficient Volume`: high volume but little price movement or poor liquidity.

### Liquidity Turnover Trigger

Purpose: detect execution risk.

Formula:

- turnover = volume24h / liquidityUsd.

Interpretation:

- 0.2 to 2: often healthier range depending on age.
- 2 to 5: high activity, monitor.
- 5+: stress or churn risk, especially for mature tokens.
- 8+: extreme for most tokens, high caution.

### Multi-Pool Quality Trigger

Purpose: avoid relying on one poor pool when token has multiple pools.

Inputs:

- DexScreener token-pairs endpoint.

Labels:

- `Primary Pool Dominant`: one pool has most liquidity and volume.
- `Fragmented Liquidity`: liquidity spread across many shallow pools.
- `Better Pool Exists`: selected pair is not the best execution pool.
- `Cross-DEX Confirmation`: multiple pools show consistent activity.

### Data Confidence Trigger

Purpose: make uncertainty visible.

Inputs:

- data freshness,
- missing fields,
- whether trigger is observed or inferred,
- whether Atlaix has snapshots,
- whether Alchemy verification ran.

Labels:

- `High Confidence`
- `Medium Confidence`
- `Low Confidence`
- `Needs Verification`

### Price/Flow Divergence Trigger

Purpose: catch misleading moves.

Labels:

- `Price Up, Flow Negative`: possible distribution into rally.
- `Price Down, Flow Positive`: possible absorption or hidden support.
- `Price Flat, Volume High`: churn, wash-like behavior, or market maker activity.

### Fresh Launch Velocity Trigger

Purpose: detect early launches without pretending they are mature.

Inputs:

- pair age,
- liquidity,
- h1 txns,
- h1 volume,
- h1 price change,
- boost/profile presence.

Labels:

- `Fast Launch`
- `Explosive Launch`
- `Risky Fast Launch`

## 11. Search and Discovery Criteria

### Current issue

The current discovery approach relies heavily on search queries and retained pairs. It can miss newly boosted, profiled, advertised, or community-takeover tokens that are not covered by static query terms.

### Recommended candidate queues

Create multiple queues:

1. `Boost Queue`
   - latest boosts,
   - top boosts.

2. `Profile Queue`
   - latest token profiles,
   - community takeovers.

3. `Paid Attention Queue`
   - latest ads,
   - paid order status.

4. `Search Queue`
   - curated query anchors by chain, narrative, ecosystem, and meme cycle.

5. `Refresh Queue`
   - previously detected tokens,
   - user-opened tokens,
   - watchlist tokens.

6. `Outcome Queue`
   - tokens detected earlier that need 5m, 15m, 1h, 6h, and 24h measurement.

### Recommended search criteria

Use search queries less as the main source and more as one source. Add:

- chain-specific hot pairs,
- token profile and boost ingestion,
- paid attention ingestion,
- token-pairs refresh for known addresses,
- and snapshot comparison.

The engine should not only ask "what matches our query?" It should ask "what changed recently across attention, liquidity, volume, price, and trading behavior?"

## 12. Classification Framework

### Replace one category with primary category plus tags

Recommended output model:

```ts
type DetectionCategory =
  | 'Fresh Launch'
  | 'Emerging Momentum'
  | 'Established Momentum'
  | 'Accumulation'
  | 'Distribution'
  | 'Recovery'
  | 'Market Stress'
  | 'Liquidity Risk'
  | 'Paid Attention'
  | 'Watchlist Candidate'
  | 'Unusual Activity';

type EvidenceKind = 'observed' | 'derived' | 'inferred' | 'unverified';

type DetectionTrigger = {
  id: string;
  label: string;
  kind: EvidenceKind;
  strength: number;
  explanation: string;
  supportingMetrics: Record<string, number | string | boolean>;
};

type DetectionScores = {
  activity: number;
  marketQuality: number;
  liquidityQuality: number;
  manipulationRisk: number;
  confidence: number;
  total: number;
};
```

### Recommended classification priority

1. `Market Stress`: price breakdown plus sell/liquidity stress.
2. `Liquidity Risk`: real liquidity contraction or severe thin-liquidity risk.
3. `Distribution`: sell dominance and negative flow without full market stress.
4. `Accumulation`: buyer dominance, positive flow, and healthy price confirmation.
5. `Recovery`: prior stress followed by confirmed bounce.
6. `Fresh Launch`: early high-velocity token, high uncertainty.
7. `Emerging Momentum`: aligned activity after launch.
8. `Established Momentum`: mature token with meaningful renewed activity.
9. `Paid Attention`: boost/ad/profile present but market confirmation incomplete.
10. `Watchlist Candidate`: interesting but not enough evidence.
11. `Unusual Activity`: fallback with sublabel.

### Why this is better

This avoids the current problem where liquidity labels dominate the feed. It also separates:

- danger signals,
- opportunity signals,
- attention signals,
- and uncertain signals.

## 13. Scoring Redesign

### Current score problem

The current total score is too easy to misunderstand. It should not be presented as "Alpha" unless it includes safety, wallet quality, signal quality, and outcome calibration.

### Recommended scores

#### Activity Score

Measures how much market activity exists.

Inputs:

- volume,
- transaction count,
- acceleration,
- pair age,
- price movement.

#### Market Quality Score

Measures whether activity looks useful.

Inputs:

- average trade size,
- volume/txns balance,
- volume/liquidity turnover,
- buy/sell balance,
- price confirmation.

#### Liquidity Quality Score

Measures execution and exit quality.

Inputs:

- liquidityUsd,
- liquidity/marketCap,
- liquidity trend from snapshots,
- multi-pool liquidity quality,
- liquidity turnover.

#### Manipulation Risk Score

Market-data-only risk until Safe Scan and Smart Money are ready.

Inputs:

- micro-trade churn,
- whale-dominated volume,
- price/flow divergence,
- paid attention without organic confirmation,
- thin liquidity,
- extreme volume/liquidity turnover,
- Alchemy wallet concentration sample when available.

#### Confidence Score

Measures reliability of the signal.

Inputs:

- data freshness,
- completeness,
- snapshot history availability,
- observed vs inferred triggers,
- Alchemy verification status,
- contradictory evidence count.

#### Total Detection Grade

Do not make this a simple average. Use:

- activity and market quality for opportunity categories,
- liquidity risk and manipulation risk for warning categories,
- confidence as a cap.

Example:

If confidence is 45, total grade should not show as 92. Confidence should cap or visibly qualify the grade.

## 14. Recommended Lane Thresholds

### Fresh Launch Lane

Age:

- 10 minutes to 6 hours.

Suggested DexScreener gate:

- liquidity >= $25k to $75k,
- volume1h or volume24h meaningful relative to age,
- txns1h >= 100 or txns24h >= 150,
- at least one of:
  - volume/liquidity >= 1.5,
  - h1 price change >= 20 percent,
  - buyer dominance,
  - boost/profile/ad present.

Default confidence:

- low to medium until snapshots or Alchemy verification improve it.

### Emerging Momentum Lane

Age:

- 6 hours to 3 days.

Suggested gate:

- liquidity >= $75k to $150k,
- volume24h >= $150k to $300k,
- txns24h >= 300,
- volume/liquidity >= 0.8,
- h1/h6/h24 trend not contradictory.

### Established Momentum Lane

Age:

- older than 3 days.

Suggested gate:

- liquidity >= $250k,
- volume24h >= $500k,
- marketCap >= $3M,
- activity must beat recent baseline,
- stronger requirement for price and volume alignment.

### Liquidity Risk Lane

Use when:

- liquidity/marketCap <= 0.08,
- liquidity decreased materially,
- volume/liquidity is extreme,
- pool fragmentation is high,
- or liquidity is too low for current trading activity.

### Market Stress Lane

Use when:

- h1 <= -8 percent or h24 <= -15 percent,
- and sell pressure, liquidity stress, or negative flow is present.

## 15. UI and User Decision Improvements

The Detection page should stop showing only category, score, and triggers. Each detection should show:

### Why Detected

Plain language:

"Detected because 1h volume accelerated, buyer dominance increased, and liquidity stayed stable."

### Confidence

Example:

"Medium confidence: DexScreener data is fresh and Atlaix has 3 snapshots, but wallet diversity is not verified."

### Counter-Signals

Example:

"Counter-signal: price is up 34 percent while estimated net flow is negative."

### What To Watch

Example:

"Watch liquidity over the next 15 minutes. If liquidity drops below $180k while sell pressure rises, this becomes Market Stress."

### Evidence Table

Show:

- liquidity,
- volume,
- volume/liquidity,
- buy/sell ratio,
- estimated net flow,
- price h1/h6/h24,
- age,
- boost/profile/ad status,
- confidence,
- data freshness.

### Do not overclaim

Use clear labels:

- "Market signal"
- "Liquidity signal"
- "Attention signal"
- "Unverified wallet signal"
- "Not a contract safety verdict"

This protects user trust.

## 16. Security and Manipulation Review

### How scammers and manipulators can fool current rules

1. Inflate transaction count with many small trades.
2. Create high volume in thin liquidity.
3. Pay for DexScreener attention to look legitimate.
4. Push price up while insiders distribute.
5. Add enough liquidity to pass a static threshold, then remove it later.
6. Split activity across pools.
7. Use fresh wallets to simulate holder growth.
8. Create a short recovery bounce after a dump to attract exit liquidity.

### Defensive improvements

- Mark paid attention separately.
- Use volume quality, not volume alone.
- Use liquidity trend, not static liquidity alone.
- Use price/flow divergence.
- Use lane-specific thresholds.
- Add confidence and counter-signals.
- Use Alchemy only to verify suspicious or high-value candidates.

## 17. Risks and Blind Spots

### Without Safe Scan

The engine cannot confidently identify honeypots, malicious permissions, mint risks, freeze risks, or contract-level traps. It should not claim contract safety.

### Without Smart Money

The engine cannot confidently say elite wallets are buying or selling. It can only say market activity suggests accumulation or distribution.

### With DexScreener only

The engine has limited wallet-level truth. It can infer activity quality, but it cannot fully prove wallet diversity, insider clustering, or deployer behavior.

### With selective Alchemy

The engine can improve verification, but it must manage cost and avoid overloading the system.

## 18. Expert Debate Summary

### Product Strategy Lead

The Detection Engine should be positioned as a market intelligence feed, not a magic alpha feed. Trust will increase if Atlaix explains uncertainty better than competitors.

### Web3 Systems Architect

The biggest technical upgrade is storing snapshots. Without snapshots, the engine cannot distinguish static structure from real change.

### Data Signal Scientist

The current trigger distribution proves the thresholds are not selective enough. Each trigger needs precision targets and post-detection outcome measurement.

### Security Engineer

Do not use Safe Scan-like safety language until contract analysis is reliable. Use "market risk" and "liquidity risk" instead.

### UI/UX Designer

The feed should make decisions easier. A user should see the reason, confidence, counter-signal, and next watch condition without opening five pages.

### Contrarian Reviewer

The danger is building many impressive labels that are still guesses. The engine should prefer fewer, better, evidence-backed labels. If a signal is inferred, say it is inferred.

## 19. Priority Recommendations

### Priority 1: Rename and restructure current signals

- Rename `score` to `Activity Score`.
- Add confidence.
- Add evidence kind for each trigger.
- Rename inferred liquidity and holder triggers.

Impact: high.

Effort: low to medium.

### Priority 2: Add snapshot-based liquidity and momentum deltas

- Store DexScreener snapshots.
- Compare 5m, 15m, 1h, 6h, 24h.
- Use deltas for liquidity added/removed, volume acceleration, and recovery.

Impact: very high.

Effort: medium.

### Priority 3: Replace one hard gate with detection lanes

- Fresh Launch.
- Emerging Momentum.
- Established Momentum.
- Market Stress.
- Liquidity Risk.
- Paid Attention.
- Watchlist Candidate.

Impact: very high.

Effort: medium.

### Priority 4: Add volume quality and manipulation-risk heuristics

- Micro-trade churn.
- Whale-dominated flow.
- Price/flow divergence.
- Extreme turnover.
- Paid attention without market confirmation.

Impact: high.

Effort: medium.

### Priority 5: Add selective Alchemy verification

- Only for top candidates, user-opened tokens, high severity, and contradictory cases.
- Verify wallet diversity, token metadata, contract existence, LP/log activity where practical.

Impact: high.

Effort: medium to high.

### Priority 6: Add outcome tracking

- Measure post-detection price return, drawdown, liquidity change, and category success.
- Use outcomes to tune thresholds.

Impact: very high.

Effort: medium.

## 20. Quick Wins

1. Rename `Token Actions` style actions already improved in UI should remain clear as `Quick Actions`; for the detection feed, use the same principle: action names should match what actually happens.
2. Rename `Liquidity Added` to `Deep Liquidity Structure` unless snapshot delta exists.
3. Rename `Liquidity Removed` to `Thin Liquidity Risk` unless snapshot delta exists.
4. Rename `Holder Growth Spike` to `Active Trade Proxy Spike`.
5. Rename `Abnormal Large Trades` to `Large Flow Imbalance` and raise thresholds.
6. Add `confidence` to every event.
7. Add `whyDetected` and `counterSignals` arrays.
8. Lower category priority for liquidity structure so it does not dominate the feed.
9. Add `Paid Attention` tag from DexScreener boosts, ads, profiles, orders, and community takeover data.
10. Add "Not contract-safety verified" copy wherever detection might be mistaken for Safe Scan.

## 21. Long-Term Improvements

1. Build outcome-calibrated scoring.
2. Add chain-specific threshold profiles.
3. Build token cohort baselines by age and liquidity tier.
4. Use Alchemy transfer samples to estimate wallet diversity and concentration.
5. Add pool-quality analysis across token-pairs.
6. Add category performance dashboards for internal tuning.
7. Add user feedback signals: useful, noisy, missed, false alarm.
8. Later, when ready, integrate Safe Scan and Smart Money as separate verified layers.

## 22. Implementation Plan

### Phase 1: Signal honesty and UI trust

Engineering tasks:

- Update event type and trigger names.
- Add `confidence`, `evidenceKind`, `whyDetected`, `counterSignals`, and `watchConditions`.
- Update category priority.
- Update UI labels to avoid overclaiming.

Acceptance criteria:

- No event says `Liquidity Added` or `Liquidity Removed` without snapshot or Alchemy evidence.
- No event says `Holder Growth Spike` without real holder/wallet evidence.
- Every event shows why it appeared and what weakens the signal.

### Phase 2: Snapshot engine

Engineering tasks:

- Create `pair_snapshots` storage.
- Store DexScreener snapshots per run.
- Compute deltas for liquidity, price, volume, txns, buy/sell flow.
- Use deltas in triggers.

Acceptance criteria:

- Engine can distinguish thin liquidity from actual liquidity removal.
- Recovery requires prior drawdown.
- Volume expansion can compare current vs previous baseline.

### Phase 3: Detection lanes

Engineering tasks:

- Add lane assignment.
- Implement lane-specific gates and thresholds.
- Add lane to UI.

Acceptance criteria:

- Fresh tokens are evaluated differently from mature tokens.
- Mature-token alerts require stronger baseline-relative evidence.
- Paid attention is a tag or lane, not automatic quality.

### Phase 4: Selective Alchemy verification

Engineering tasks:

- Add budgeted enrichment queue.
- Add token metadata and contract existence checks.
- Add sampled transfer/wallet diversity checks.
- Add Solana supply/largest-account sample when supported and affordable.
- Cache results.

Acceptance criteria:

- Alchemy calls are only made for selected reasons.
- Enrichment results show freshness and confidence.
- Costs can be monitored per day.

### Phase 5: Outcome tracking and calibration

Engineering tasks:

- Store detection outcomes at 5m, 15m, 1h, 6h, 24h.
- Track return, max drawdown, liquidity change, category, triggers, confidence.
- Build internal report by category and trigger.

Acceptance criteria:

- Team can see which categories produce useful outcomes.
- No threshold changes are made blindly.
- Trigger precision can be improved over time.

## 23. Codex-Ready Execution Instructions

### Task 1: Add honest event model fields

Update detection event types to include:

- `lane`,
- `confidence`,
- `triggerDetails`,
- `whyDetected`,
- `counterSignals`,
- `watchConditions`,
- `dataFreshness`.

### Task 2: Rename misleading triggers

Map old to new:

- `Volume Spike` -> `Volume Expansion`
- `Transaction Spike` -> `Trade Count Acceleration`
- `Strong Buy Pressure` -> `Buyer Dominance`
- `Strong Sell Pressure` -> `Seller Dominance`
- `Liquidity Added` -> `Deep Liquidity Structure` unless observed delta exists
- `Liquidity Removed` -> `Thin Liquidity Risk` unless observed delta exists
- `Holder Growth Spike` -> `Active Trade Proxy Spike`
- `Price Dump` -> `Price Breakdown`
- `Price Recovery` -> `Recovery Attempt`
- `Abnormal Large Trades` -> `Large Flow Imbalance`

### Task 3: Add snapshot storage

Create storage for pair snapshots and write snapshots every detection run.

Fields:

- chain,
- pairAddress,
- tokenAddress,
- timestamp,
- priceUsd,
- liquidityUsd,
- marketCap,
- fdv,
- volume windows,
- txns windows,
- buys and sells,
- boosts,
- profile/ad/order flags.

### Task 4: Implement lane-specific detection

Create lane functions:

- `classifyFreshLaunchLane`
- `classifyEmergingMomentumLane`
- `classifyEstablishedMomentumLane`
- `classifyMarketStressLane`
- `classifyLiquidityRiskLane`
- `classifyPaidAttentionLane`

### Task 5: Implement new scoring

Replace one total score display with:

- Activity Score,
- Market Quality Score,
- Liquidity Quality Score,
- Manipulation Risk,
- Confidence,
- Detection Grade.

### Task 6: Implement selective Alchemy verifier

Only run for:

- top candidates,
- user-opened detections,
- high severity,
- contradictory signals,
- watchlist tokens.

Add budget logs.

### Task 7: Update UI

For each detection card or token page, show:

- primary category,
- lane,
- confidence,
- why detected,
- counter-signals,
- top metrics,
- watch conditions,
- and "not contract-safety verified" when Safe Scan was not used.

## 24. Final Recommendation

The engine can become much more respected without expensive data providers, but it must become more honest and more evidence-driven. The biggest upgrade is not adding more categories. The biggest upgrade is making every category prove itself with:

- the right lane,
- the right trigger thresholds,
- observed vs inferred evidence,
- confidence,
- counter-signals,
- liquidity quality,
- manipulation risk,
- and outcome tracking.

If Atlaix does this well, users will not see the Detection Engine as another noisy token feed. They will see it as a decision-support system that says:

"Here is what changed, here is why it matters, here is what could be wrong, and here is what to watch next."

That is the path to a detection engine people trust.

## 25. Sources Used

- DexScreener API reference: https://docs.dexscreener.com/api/reference
- Alchemy compute unit costs: https://www.alchemy.com/docs/reference/compute-unit-costs
- Alchemy Transfers API: https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers
- Chainalysis market manipulation research, 2025: https://www.chainalysis.com/blog/crypto-market-manipulation-wash-trading-pump-and-dump-2025/
- OECD, Concentration of DeFi's liquidity, 2024: https://www.oecd.org/content/dam/oecd/en/publications/reports/2024/04/concentration-of-defi-s-liquidity_5df1e8f9/4ed08440-en.pdf
- Prior Atlaix report: `docs/dexscreener-alchemy-detection-upgrade-plan-2026-05-09.md`
