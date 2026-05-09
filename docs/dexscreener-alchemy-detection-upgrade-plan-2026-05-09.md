# Detection Engine Upgrade Plan Using DexScreener + Low-Cost Alchemy

Date: 2026-05-09

Scope: Recommendations for improving Atlaix Detection Engine quality while primarily using DexScreener and only a controlled, low-cost amount of Alchemy.

## Executive Summary

The current Detection Engine is useful, but it is still mostly a market-activity filter. With only DexScreener and light Alchemy, Atlaix can still become much better by changing the architecture from one-pass scoring into a two-stage intelligence pipeline:

1. Broad, cheap DexScreener discovery.
2. Strict DexScreener-based scoring and classification.
3. Selective Alchemy enrichment only for the top candidates.
4. Evidence-first UI that shows why a user should care.
5. Outcome tracking so the engine learns which signals actually worked.

The biggest changes I recommend:

- Stop treating current `score` as a complete "Alpha" score. Rename it to `Activity Score`.
- Add `Confidence Score`, based on freshness, data completeness, source quality, and whether the signal is observed or inferred.
- Split detection into lanes: Fresh Launch, Momentum, Accumulation, Distribution, Liquidity Risk, Market Stress, Paid Attention/Boosted, and Watchlist Candidate.
- Stop using inferred liquidity ratio as "Liquidity Added/Removed" unless the engine compares snapshots over time.
- Stop using `holderProxy` as "Holder Growth Spike"; it is currently mostly a transaction proxy.
- Use DexScreener token profiles, boosts, ads/orders, community takeovers, token-pairs, pair refreshes, and multi-timeframe changes more aggressively.
- Use Alchemy only for top candidate verification: recent transfers, buyer/seller wallet sample, token metadata, token balances for selected wallets, LP/pair transfer activity, and deployer/contract sanity checks on EVM.

## Current Engine Diagnosis

### What the current engine does well

Current Alpha Gauntlet logic uses:

- market cap,
- liquidity,
- volume,
- buy/sell transaction count,
- estimated buy/sell volume,
- estimated net flow,
- pair age,
- LP/market-cap ratio,
- price change,
- trigger count,
- and basic risk level.

This is a good MVP because these are cheap, fast, and available from DexScreener-style pair data.

### What the current live feed shows

Local feed check on 2026-05-09:

- 74 feed events.
- Last scheduled runner detected 3 fresh tokens.
- Event type distribution:
  - Liquidity Event: 27
  - Market Stress: 12
  - Recovery: 11
  - Unusual Activity: 11
  - Accumulation: 10
  - Distribution: 3
- Most common triggers:
  - Transaction Spike: 70
  - Abnormal Large Trades: 67
  - Volume Spike: 49
  - Holder Growth Spike: 46
  - Strong Buy Pressure: 38
  - Liquidity Removed: 26

That tells us the current rules are catching activity, but the trigger set is too broad. If almost every detected token has "Transaction Spike" and "Abnormal Large Trades," those triggers do not help users distinguish the best opportunities.

## Provider Capabilities

### DexScreener capabilities to use more fully

DexScreener's public API can provide:

- Latest token profiles.
- Latest community takeovers.
- Latest ads.
- Latest boosted tokens.
- Top active boosted tokens.
- Paid order status for token profile, community takeover, token ad, and trending-bar ad.
- Pair lookup by chain and pair address.
- Search by query.
- Pools for a token address.
- One or multiple pairs by token address, up to 30 addresses per request.

Useful fields include:

- chain,
- DEX,
- pair address,
- labels,
- base/quote token,
- price,
- transaction counts,
- volume,
- price change,
- liquidity,
- FDV,
- market cap,
- pair creation time,
- image,
- websites,
- socials,
- active boosts.

### Alchemy capabilities to use selectively

Alchemy can improve quality without becoming the main cost center:

- `alchemy_getAssetTransfers`: recent token transfers and historical transfers for addresses/contracts on Ethereum and supported L2s, including Base, Polygon, Arbitrum, and Optimism.
- Token API: token balances and metadata.
- Standard JSON-RPC: `eth_getCode`, `eth_getLogs`, `eth_call`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`.
- Solana RPC: `getSignaturesForAddress`, `getTransaction`, `getTokenLargestAccounts`, `getTokenSupply`, `getTokenAccountsByOwner`.
- Webhooks: address activity and custom webhooks, but use sparingly because subscriptions are bandwidth-priced.

Alchemy cost discipline:

- `alchemy_getTokenMetadata` is cheap.
- `alchemy_getTokenBalances` is cheap enough for selected wallets.
- `alchemy_getAssetTransfers` is more expensive, so use it only after DexScreener ranks a token highly.
- Webhooks should be reserved for top watched tokens only.

## Thoughts on Current Classification Criteria

### 1. Market eligibility is too one-size-fits-all

Current gate:

- market cap >= $500k
- liquidity >= $100k
- volume >= $250k
- holder proxy >= 500
- transactions >= 500
- age >= 3 hours
- healthy liquidity structure
- both buys and sells

This is selected well for avoiding very noisy tiny tokens, but it is too strict for early discovery and too loose for mature tokens.

Recommended change: use lanes instead of one gate.

Example lanes:

#### Fresh Launch Lane

Use for tokens aged 10 minutes to 6 hours.

Suggested gate:

- liquidity >= $25k-$75k
- volume >= $50k
- txns >= 150
- at least one of:
  - volume/liquidity >= 1.5
  - 1h price change >= 20%
  - buy/sell USD ratio >= 1.4
  - DexScreener boost/profile/social present

But show high risk by default until Alchemy confirms wallet diversity and no obvious concentration issue.

#### Emerging Momentum Lane

Use for tokens aged 6 hours to 3 days.

Suggested gate:

- liquidity >= $75k-$150k
- volume >= $150k-$300k
- txns >= 300
- volume/liquidity >= 0.8
- price change h1/h6/h24 aligned or accelerating

#### Established Momentum Lane

Use for older/larger tokens.

Suggested gate:

- liquidity >= $250k-$500k
- volume >= $500k
- market cap >= $3M
- lower sensitivity to transaction count
- stronger requirement for volume/liquidity, price trend, and repeated refresh strength

Why this matters: a $50k liquidity new token and a $30M FDV token should not be judged by the same thresholds.

### 2. Liquidity classification currently has too much priority

Current classification returns `Liquidity Event` whenever `Liquidity Added` or `Liquidity Removed` triggers exist. But those triggers are inferred from LP/market-cap ratio and volume, not actual LP add/remove transactions.

That is why Liquidity Event dominates the feed.

Recommended change:

- Rename current inferred triggers:
  - `Liquidity Added` -> `Deep Liquidity Structure`
  - `Liquidity Removed` -> `Thin Liquidity Risk`
- Only use `Liquidity Added` / `Liquidity Removed` when comparing snapshots:
  - liquidity now vs 5m ago,
  - liquidity now vs 1h ago,
  - liquidity now vs first detection,
  - or actual LP event from Alchemy.

New classification priority:

1. Market Stress if price dump + sell pressure + liquidity drop/risk.
2. Distribution if sell pressure + negative net flow + price weakness.
3. Accumulation if buy pressure + positive net flow + positive/neutral price.
4. Recovery if prior drawdown + price recovery + volume expansion.
5. Liquidity Risk if liquidity deteriorates or liquidity/FDV is dangerously thin.
6. Paid Attention if boosts/orders/social profile are present but activity is not yet proven.
7. Unusual Activity as fallback.

### 3. Holder Growth Spike is not reliable

Current holder proxy is:

`max(activeWallets24h, transactions24h * 0.65)`

This means high transaction count automatically creates "holder growth." That is not actual holder growth.

Recommended change:

- Remove `Holder Growth Spike` unless there is real holder data.
- If using only DexScreener, rename to `Active Wallet Proxy Spike`.
- If using light Alchemy, compute wallet diversity sample:
  - recent unique buyers,
  - recent unique sellers,
  - buyer/seller unique ratio,
  - fresh/repeated wallet sample if available from transfer history.

### 4. Abnormal Large Trades is too common

Current trigger:

- abs net flow >= $35k OR abs net flow >= 8% of volume.

In the live feed, 67 out of 74 events had this trigger. It is not selective enough.

Recommended change:

Use dynamic thresholds:

- For liquidity < $250k: large flow >= max($25k, 12% of liquidity, 15% of volume)
- For liquidity $250k-$1M: >= max($75k, 8% of liquidity, 10% of volume)
- For liquidity > $1M: >= max($150k, 5% of liquidity, 8% of volume)

Also split:

- `Large Inflow`
- `Large Outflow`
- `Whale Imbalance`
- `Flow Conflict`

Example:

> Price +35%, but net flow is -$180k. This is not clean recovery. It is "price up with distribution risk."

### 5. Transaction Spike is too common

70 out of 74 events had `Transaction Spike`. That means the trigger is mostly a gate duplicate.

Recommended change:

Use acceleration, not absolute count:

- txns h1 vs h6 average,
- txns h6 vs h24 baseline,
- if DexScreener provides m5/h1/h6/h24 transaction buckets, use them.

Better trigger:

`Transaction Acceleration`: h1 txns >= 2.5x trailing hourly average and h1 txns >= 100.

### 6. Buy/sell pressure should prefer USD flow, not count

Current rules use both buy/sell count and volume flow. But if buy/sell volume is inferred from count ratio, it can be misleading.

Recommended change:

Track confidence:

- High confidence: provider gives actual h24 buy/sell volume.
- Medium confidence: inferred from buy/sell count.
- Low confidence: only total volume and txns available.

UI should say:

> Buy pressure is inferred from transaction count, not verified trade value.

## Recommended New Detection Model

### Keep the current score, but rename it

Current `score` should become:

`activityScore`

It measures market activity quality, not full opportunity quality.

### Add these derived scores

#### 1. Activity Score

Based on DexScreener:

- volume/liquidity ratio,
- volume/market-cap ratio,
- tx acceleration,
- price momentum,
- buy/sell USD imbalance,
- freshness.

#### 2. Liquidity Quality Score

Based on DexScreener:

- liquidity USD,
- liquidity/FDV,
- liquidity trend from snapshots,
- pool count,
- quote asset quality,
- DEX quality,
- volume/liquidity risk.

#### 3. Attention Score

Based on DexScreener:

- token profile exists,
- active boosts,
- top boosts,
- ads,
- community takeover,
- social links,
- website presence.

This is not always bullish. Paid attention can indicate promotion, not quality.

#### 4. Confidence Score

Based on:

- pair refreshed recently,
- actual buy/sell volume available,
- enough history,
- multiple pools agree,
- Alchemy verification complete,
- source not degraded.

#### 5. Verification Score

Light Alchemy enrichment only:

- recent unique buyers/sellers,
- whale transfers,
- LP/pair token transfers,
- token metadata match,
- contract code exists on EVM,
- token supply on Solana/EVM when cheap enough,
- top holder check where available.

#### 6. Final User Label

Do not only show "High / Medium / Low." Show:

- Clean Momentum
- Risky Momentum
- Early Watch
- Distribution Risk
- Liquidity Risk
- Paid Attention
- Market Stress
- Needs Verification

## Search and Discovery Improvements

### Current search strategy

The current engine uses broad shuffled search terms such as chain names, narratives, meme names, culture terms, launch terms, and dynamic terms from existing tokens.

This is a decent fallback, but it has blind spots:

- It depends on query luck.
- It may rediscover popular old tokens too often.
- It can miss new launches that do not match the static query set.
- It does not fully use DexScreener's latest profile/boost/community/ads endpoints.

### Recommended discovery architecture

Use multiple candidate queues:

#### Queue A: Latest profiles

From DexScreener `/token-profiles/latest/v1`.

Why:

- New profile creation often happens around launch/promotion.
- Good source for early candidates.

#### Queue B: Latest boosted tokens

From `/token-boosts/latest/v1`.

Why:

- Boosted tokens are high-attention.
- Do not treat boost as bullish. Treat it as attention requiring verification.

#### Queue C: Top boosted tokens

From `/token-boosts/top/v1`.

Why:

- Captures heavily promoted tokens.
- Useful for retail-risk monitoring.

#### Queue D: Community takeovers

From `/community-takeovers/latest/v1`.

Why:

- CTO tokens can have unusual community-driven momentum.
- Also high risk. Needs labels.

#### Queue E: Ads/latest and orders

Use ads/latest and `/orders/v1/{chainId}/{tokenAddress}`.

Why:

- Paid promotion can explain sudden traffic.
- Users should know if a token is boosted/advertised.

#### Queue F: Search queries

Keep the current query system, but reduce static bloat and organize by lane:

- chain anchors,
- current meta terms,
- dynamic winners,
- user-searched tokens,
- recently detected tickers,
- social/profile tokens from DexScreener.

#### Queue G: Watchlist refresh

Use `/tokens/v1/{chainId}/{tokenAddresses}` in batches of up to 30 to refresh known candidates cheaply.

### Candidate pipeline

1. Candidate discovery from all queues.
2. Deduplicate by chain + token address.
3. Fetch token pairs/pools.
4. Score pair quality.
5. Keep the best pair per token, but store pool count and aggregate liquidity/volume.
6. Run lane-specific classification.
7. Send only top candidates to Alchemy verification.

## Low-Cost Alchemy Strategy

Do not enrich every token. Use Alchemy only after DexScreener has done cheap filtering.

### Suggested enrichment budget

Every 5 minutes:

- DexScreener scans broad market.
- Select top 10-25 candidates for Alchemy.
- Full Alchemy check only for top 5-10.
- Webhook/watch only for top 10-20 tokens and only for a TTL.

### What to use Alchemy for

#### EVM chains

For selected tokens:

1. `eth_getCode`

Purpose:

- confirm contract exists,
- detect EOA mistake,
- maybe proxy bytecode patterns later.

Cost: low.

2. `alchemy_getTokenMetadata`

Purpose:

- verify decimals/name/symbol,
- prevent wrong metadata,
- improve display confidence.

Cost: low.

3. `alchemy_getAssetTransfers`

Purpose:

- sample recent token transfers,
- identify recent unique buyers/sellers,
- classify pair-to-wallet buys and wallet-to-pair sells,
- detect burns,
- detect large transfers,
- detect repeated wallets.

Use only for high-ranked candidates because this is more expensive.

4. `alchemy_getTokenBalances`

Purpose:

- check selected wallets' token holdings,
- estimate whether recent buyers still hold,
- test top wallet/funder candidates if known.

Use sparingly.

5. `eth_getLogs`

Purpose:

- query ERC20 Transfer logs for recent blocks,
- often cheaper/more controllable than full asset transfer history if you know block window.

Use for recent-window verification.

#### Solana

For selected tokens:

1. `getTokenLargestAccounts`

Purpose:

- top holder concentration.

2. `getTokenSupply`

Purpose:

- normalize top holder percentages.

3. `getSignaturesForAddress`

Purpose:

- recent token or pair activity.

4. `getTransaction`

Purpose:

- parse selected recent swaps/transfers.

Keep Solana pages limited. The current `SOLANA_ACTIVITY_PAGES = 4` can become expensive if run too broadly. Apply only to candidates.

### Enrichment decision rule

Call Alchemy only if:

- DexScreener activity score >= 75, OR
- fresh launch with volume/liquidity >= 1.5, OR
- token is boosted/advertised and gaining volume, OR
- token has market stress/rug-risk conditions, OR
- user opens token detail, OR
- user creates alert/watch.

## Free Resources That Can Improve Quality

Strictly within DexScreener + Alchemy:

- DexScreener token profiles/latest.
- DexScreener boosts/latest and boosts/top.
- DexScreener ads/latest.
- DexScreener community takeovers/latest.
- DexScreener orders endpoint.
- DexScreener token-pairs endpoint.
- DexScreener tokens endpoint with 30-address batching.
- Alchemy standard RPC calls.
- Alchemy Token API.
- Alchemy Transfers API used selectively.
- Alchemy webhooks only for short-lived top candidates.

If you allow additional free/public resources later, the best additions would be:

- DefiLlama for chain/DEX context and macro volume benchmarks.
- Public block explorer links for verification, not ingestion.
- Token list metadata for known legitimate assets.
- Internal user feedback labels, which cost nothing and are very valuable.

But the core improvement can be done with only DexScreener and Alchemy.

## What Users Need for Better Decision-Making

Users do not only need more tokens. They need better explanations.

Add these to each detection:

### 1. Why Detected

Example:

> Detected because 1h volume accelerated, 24h volume is 2.4x liquidity, buy-side USD flow leads sell-side flow, and price recovered 18%.

### 2. Confidence

Example:

> Confidence: Medium. Buy/sell flow is inferred from pair data. Alchemy transfer verification is pending.

### 3. Counter-Signals

Example:

> Counter-signals: liquidity/FDV is only 4.2%, paid boost detected, and recent large outflow conflicts with price recovery.

### 4. What To Watch Next

Example:

> Watch for smart confirmation: buy pressure must stay above 55%, liquidity must not drop more than 10%, and whale outflow must stay below $75k over 30 minutes.

### 5. Suggested Action

Examples:

- "Safe to investigate, not entry-ready."
- "Momentum is real but risk is high."
- "Paid attention only; wait for organic confirmation."
- "Distribution risk; avoid unless thesis changes."

## Specific Recommended Rule Changes

### Replace single detection threshold with lane thresholds

Current:

`DETECTION_THRESHOLD = 65`

Recommended:

- Fresh Launch: activity >= 55, confidence >= 35, risk label required.
- Momentum: activity >= 65, confidence >= 50.
- Established: activity >= 70, confidence >= 55.
- Market Stress: risk >= 65, confidence >= 45.
- Paid Attention: attention >= 70, activity can be lower, but label as "Needs Verification."

### Rework classification priority

Current first priority:

`Liquidity Added` or `Liquidity Removed` -> Liquidity Event.

Recommended:

```ts
if (priceDump && sellPressure && liquidityDeteriorating) return 'Market Stress';
if (sellPressure && negativeUsdFlow && !strongPositiveMomentum) return 'Distribution';
if (buyPressure && positiveUsdFlow && !majorLiquidityRisk) return 'Accumulation';
if (recoveryMomentum && priorStressOrDrawdown && volumeExpansion) return 'Recovery';
if (liquidityDeteriorating || thinLiquidityRisk) return 'Liquidity Risk';
if (paidAttention && !verifiedActivity) return 'Paid Attention';
return 'Unusual Activity';
```

### Change trigger definitions

#### Volume Spike

Current:

- volume/liquidity >= 1.2 OR volume/marketCap >= 0.2 OR volume >= $1M

Recommended:

- Fresh: volume/liquidity >= 1.5
- Emerging: volume/liquidity >= 1.0 OR volume/FDV >= 0.12
- Established: h1/h6 acceleration OR volume/liquidity >= 0.75 with volume >= $1M

#### Strong Buy Pressure

Recommended:

- High confidence: buy USD / sell USD >= 1.25 and net flow > threshold.
- Medium confidence: buy count / sell count >= 1.5 and price >= flat.
- Penalize if price up but net flow negative.

#### Strong Sell Pressure

Recommended:

- sell USD / buy USD >= 1.25 and net flow < negative threshold.
- Or sell count / buy count >= 1.8 with price <= flat.

#### Liquidity Risk

Recommended:

- liquidity/FDV below lane threshold,
- liquidity dropped >10% over 15m or >20% over 1h,
- volume/liquidity >5 with falling price,
- pool count high but liquidity fragmented.

#### Paid Attention

New trigger from DexScreener:

- boost active,
- top boost,
- token ad,
- profile paid order,
- community takeover.

This should increase attention score, not automatically opportunity score.

## Architecture Upgrade

### New internal flow

```text
DexScreener Candidate Discovery
  -> Candidate Queue
  -> Pair Refresh / Pool Aggregation
  -> Lane Classification
  -> Activity Score
  -> Confidence Score
  -> Top Candidate Selection
  -> Low-Cost Alchemy Verification
  -> Final Label + Evidence
  -> Feed + Alerts + Outcome Tracking
```

### New fields to store

Add to detection snapshots:

- `activity_score`
- `confidence_score`
- `liquidity_quality_score`
- `attention_score`
- `verification_score`
- `final_label`
- `lane`
- `source_confidence`
- `is_paid_attention`
- `is_alchemy_verified`
- `dexscreener_profile`
- `boost_amount`
- `boost_total_amount`
- `has_community_takeover`
- `has_ads`
- `liquidity_delta_5m`
- `liquidity_delta_1h`
- `volume_delta_5m`
- `price_delta_5m`
- `unique_wallet_sample`
- `whale_flow_sample`
- `top_holder_concentration_sample`
- `counter_signals`
- `next_watch_conditions`

## Implementation Priority

### Phase 1: DexScreener-only quality upgrade

1. Add candidate queues for profiles, boosts, top boosts, ads, community takeovers.
2. Add paid-order enrichment.
3. Add snapshot deltas for price, volume, liquidity, txns.
4. Change liquidity triggers from static ratios to actual deltas.
5. Add lane-based classification.
6. Add confidence score.
7. Update UI evidence panel.

This alone will noticeably improve quality.

### Phase 2: Low-cost Alchemy verification

1. Select top 10-25 candidates per run.
2. For EVM: metadata + code check for all selected.
3. For top 5-10: recent transfer sample.
4. For Solana: token supply + largest accounts for top candidates.
5. Add verification score.
6. Add "verified/inferred" badges.

### Phase 3: Outcome tracking

1. Record baseline at detection.
2. Refresh price/liquidity at 5m, 15m, 1h, 6h, 24h using DexScreener batch endpoints.
3. Compute post-detection returns.
4. Tune lane thresholds from outcomes.

Outcome tracking is the cheapest massive quality improvement because it uses mostly DexScreener and your own data.

## Final Council Recommendation

Do not spend heavily on Alchemy yet. First make the DexScreener layer much smarter.

The best near-term engine is:

- DexScreener for broad discovery, market structure, paid attention, profiles/socials, pool state, batch refresh, and outcome tracking.
- Alchemy for selective verification of only the highest-value candidates and user-opened token details.

The current classification criteria are directionally good but too blunt. The biggest changes should be:

- lane-based gates,
- liquidity event redefinition,
- holder proxy removal/rename,
- dynamic large-flow thresholds,
- transaction acceleration instead of absolute transaction spike,
- confidence scoring,
- paid attention labeling,
- and evidence-first UX.

If Atlaix makes these changes, users will not just see "hot tokens." They will see:

> "This token is moving, here is why, here is what is real, here is what is inferred, here is what can go wrong, and here is what to watch next."

That is the difference between a feed and an intelligence engine.

## Sources

- DexScreener API reference: https://docs.dexscreener.com/api/reference
- Alchemy Transfers API: https://www.alchemy.com/docs/reference/alchemy-getassettransfers
- Alchemy Token API overview: https://www.alchemy.com/docs/reference/token-api-overview
- Alchemy Webhook Types: https://www.alchemy.com/docs/reference/webhook-types
- Alchemy Compute Unit Costs: https://www.alchemy.com/docs/reference/compute-unit-costs
