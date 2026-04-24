# Helius vs Alchemy for Atlaix

Date: April 22, 2026

## Scope

This report compares:

- Helius Developer plan
- Alchemy Pay As You Go

For these Atlaix workloads:

- Safe Scan: Solana
- Safe Scan: EVM
- Wallet Tracking: Solana
- Wallet Tracking: EVM

It also answers the purchase decision:

- Best-fit stack: Helius for Solana + Alchemy for EVMs?
- Simpler stack: Alchemy for both Solana and EVMs?

## Executive Summary

If Solana Safe Scan and Solana wallet history are important product differentiators, do not go Alchemy-only.

Best overall fit:

- Helius for Solana
- Alchemy for EVMs

Best “one-vendor” simplification:

- Alchemy for both

But that simpler option comes with real Solana tradeoffs:

- weaker Solana-native wallet history tooling
- fewer Solana-specific indexed/history conveniences
- more pressure on your frontend forensic engine to reconstruct history manually

Short recommendations:

- Solana Safe Scan: Helius primary, Alchemy fallback
- Solana Wallet Tracking: Helius if you want serious history/PnL/funding analysis
- EVM Wallet Tracking: Alchemy
- EVM Safe Scan: neither provider is the main driver today

## How Atlaix Uses Providers Today

### Safe Scan

The current page calls:

- `GoPlusService.fetchTokenSecurity(...)` in [src/pages/SafeScan.tsx](C:/Users/USER/Desktop/atlaix%20main/src/pages/SafeScan.tsx:77)
- `DatabaseService.getTokenDetails(...)` in [src/pages/SafeScan.tsx](C:/Users/USER/Desktop/atlaix%20main/src/pages/SafeScan.tsx:78)
- `ForensicBundleService.analyzeToken(...)` for Solana forensic work in [src/pages/SafeScan.tsx](C:/Users/USER/Desktop/atlaix%20main/src/pages/SafeScan.tsx:126)

Important implication:

- EVM Safe Scan is mostly GoPlus + DexScreener + Uncx based
- Solana Safe Scan is the part that is heavily provider-sensitive

The Solana forensic engine currently uses:

- `getAsset`
- `getTokenSupply`
- `getTokenLargestAccounts`
- `getProgramAccounts`
- `getTokenAccounts`
- `getTokenAccountsByOwner`
- `getSignaturesForAddress`
- `getTransaction`

See:

- [src/services/ForensicBundleService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ForensicBundleService.ts:560)
- [src/services/ForensicBundleService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ForensicBundleService.ts:619)
- [src/services/ForensicBundleService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ForensicBundleService.ts:655)
- [src/services/ForensicBundleService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ForensicBundleService.ts:759)
- [src/services/ForensicBundleService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ForensicBundleService.ts:822)
- [src/services/ForensicBundleService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ForensicBundleService.ts:895)

Current interactive Safe Scan depth is still meaningful:

- token accounts: 400
- holder seed: 60
- launch buyers sampled: 8
- launch signatures target: 200
- launch wallet history: 12
- holder history: 6
- root history: 40
- related history: 18

See [src/services/ForensicBundleService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ForensicBundleService.ts:305).

### Wallet Tracking

Wallet Tracking is not currently a pure Helius-vs-Alchemy flow.

It is Moralis-first for portfolio balances, with Alchemy and Solana RPC used as secondary components:

- portfolio load starts in [src/hooks/useWalletPortfolio.ts](C:/Users/USER/Desktop/atlaix%20main/src/hooks/useWalletPortfolio.ts:98)
- Solana history preload runs in [src/hooks/useWalletPortfolio.ts](C:/Users/USER/Desktop/atlaix%20main/src/hooks/useWalletPortfolio.ts:158)
- portfolio fetches route through Moralis in [src/services/ChainRouter.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ChainRouter.ts:223)
- Solana balances currently come from Moralis in [src/services/MoralisService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/MoralisService.ts:253)
- EVM cost basis uses Alchemy Transfers + block lookup in [src/services/AlchemyService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/AlchemyService.ts:307) and [src/services/AlchemyService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/AlchemyService.ts:373)
- Solana wallet history currently pages `getSignaturesForAddress` + `getTransaction` in [src/services/SolanaProvider.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/SolanaProvider.ts:667)

Important implication:

- choosing Helius or Alchemy for Wallet Tracking is partly a product and refactor decision, not just a billing decision

## Methodology

This report combines:

- official vendor pricing and rate-limit documentation
- current Atlaix code paths
- live spot checks run on April 22, 2026

Sample Solana mint used in Safe Scan tests:

- `nHtKdt67T4DHX5FfcXuwAviHEhJM552nrXmHW7xpump`

Sample Solana wallet used in wallet-style tests:

- `86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY`

Sample EVM wallet used in wallet-style tests:

- `0x1E6E8695FAb3Eb382534915eA8d7Cc1D1994B152`

## Live Spot Checks

Median latency over 3 runs:

### Solana Safe Scan style methods

| Method | Helius | Alchemy | Winner |
|---|---:|---:|---|
| `getAsset` | 261 ms | 475 ms | Helius |
| `getTokenAccounts` | 228 ms | 312 ms | Helius |
| `getSignaturesForAddress` | 209 ms | 200 ms | Near tie, slight Alchemy edge |
| `getTransaction` | 241 ms | 204 ms | Alchemy |

Interpretation:

- Helius is better on the indexed / DAS-style Solana methods that matter for metadata and token-account discovery.
- Alchemy is competitive or slightly better on raw transaction fetches.
- This supports the current hybrid routing already present in [src/services/SolanaProvider.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/SolanaProvider.ts:110).

### Solana wallet-style methods

| Method | Helius | Alchemy | Winner |
|---|---:|---:|---|
| Wallet balances snapshot | 397 ms | 845 ms | Helius |
| Wallet history | 1383 ms | No equivalent official Solana wallet-history endpoint found | Helius |

Alchemy comparison note:

- Alchemy `Tokens By Wallet` on Solana worked and returned data.
- I did not find an official Alchemy Solana wallet-history API equivalent to Helius Wallet History or Helius `getTransactionsForAddress`.
- Alchemy’s `Transactions By Wallet (Beta)` is documented as Ethereum/Base only and deprecated.

### EVM wallet-style methods

| Method | Alchemy median |
|---|---:|
| Tokens By Wallet (Ethereum) | 323 ms |
| `alchemy_getAssetTransfers` (Ethereum) | 337 ms |

There is no official Helius EVM platform in the docs reviewed here. That is an inference from the official Helius documentation, which presents Helius as a Solana infrastructure platform and exposes Solana-specific APIs.

## Plan and Capacity Comparison

### Helius Developer

Official current docs show:

- list price: $49/month
- docs currently display a temporary discounted price of $24.50/month
- monthly credits: 10M
- RPC rate limit: 50 req/s
- DAS API rate limit: 10 req/s
- Enhanced APIs: 10 req/s
- Wallet API: included
- Wallet API rate limit: 10 req/s
- additional credits: $5 per 1M credits

Important per-request credit costs:

- standard RPC call: 1 credit
- `getProgramAccounts`: 10 credits
- DAS endpoints like `getAsset` and `getTokenAccounts`: 10 credits
- `getTransactionsForAddress`: 50 credits
- Wallet API endpoints: 100 credits
- webhook events: 1 credit

### Alchemy Pay As You Go

Official current docs show:

- no upfront commitment
- $0.45 per 1M CUs up to 300M CUs/month
- $0.40 per 1M CUs after 300M
- throughput: 10,000 CU/s
- webhooks included: 100

Important current CU costs:

- Solana `getAsset`: 80 CU, 200 throughput CU
- Solana `getTokenAccounts`: 160 CU, 200 throughput CU
- Solana `getSignaturesForAddress`: 40 CU
- Solana `getTransaction`: 40 CU
- Solana `getProgramAccounts`: 20 CU
- `assets/tokens/by-address`: 360 CU
- `/transactions/history/by-address`: 1000 CU
- `alchemy_getAssetTransfers`: 120 CU
- `eth_getBlockByNumber`: 20 CU

Translated capacity examples on Alchemy PayGo:

- `getAsset`: about 50 req/s before throughput becomes the limiter
- `getTokenAccounts`: about 50 req/s
- `getSignaturesForAddress`: about 250 req/s
- `getTransaction`: about 250 req/s
- `assets/tokens/by-address`: about 27 req/s
- `alchemy_getAssetTransfers`: about 83 req/s

Key difference:

- Helius rate limits are explicit per API family.
- Alchemy rate limits are expressed through CU/s and method weights.

## Solana Safe Scan

### What matters most technically

Your current Solana forensic engine is history-heavy and transaction-heavy.

Two code details matter a lot:

1. Launch reconstruction can scan up to 50 pages of signatures even though the launch target is 200 signatures, because it keeps paging until it hits the page cap or the address runs out of history.

See [src/services/ForensicBundleService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ForensicBundleService.ts:783).

2. The scan still decodes many full transactions and still expands into holder and sampled launch-wallet history.

See [src/services/ForensicBundleService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/ForensicBundleService.ts:2223).

This means your main bottleneck is not just provider plan size. It is also the number of requests your current engine chooses to make.

### Solana Safe Scan recommendation

Winner: Helius primary, Alchemy fallback

Why:

- Helius is stronger on the Solana-native indexed APIs that matter early in the scan.
- Helius offers Solana-specific historical and wallet APIs that can simplify later refactors.
- Alchemy is still useful as fallback, especially for raw transaction fetches.
- Your current benchmark results already support that split.

### Expected cost per Solana Safe Scan

These are reasoned estimates from the current code path, not vendor-quoted numbers.

#### Light scan

- Helius: about 100-200 credits
- Alchemy: about 3k-6k CU

#### Typical interactive scan

- Helius: about 500-900 credits
- Alchemy: about 20k-40k CU

#### Heavy scan

- Helius: about 1.5k-3k credits
- Alchemy: about 60k-120k CU

### Practical monthly examples for Solana Safe Scan

Using a typical-scan assumption of about 600 Helius credits or about 25k Alchemy CUs:

- 10,000 scans/month
  - Helius: about 6M credits, fits inside Developer plan
  - Alchemy: about 250M CU, about $112.50/month

- 100,000 scans/month
  - Helius: about 60M credits
  - cost estimate: about $49 base + about $250 overage = about $299/month
  - Alchemy: about 2.5B CU
  - cost estimate: about $1,015/month

Interpretation:

- For Solana Safe Scan, Helius is likely both the better fit and the cheaper provider at moderate-to-high scan volume.
- The bigger issue for user experience is still request count and architecture, not raw API pricing.

## Solana Wallet Tracking

This needs to be split into two sub-problems.

### A. Balance / holdings snapshot

Winner: slight edge to Helius on speed, edge to Alchemy on per-call price

Why:

- Helius Wallet Balances was faster in the spot check.
- Alchemy `Tokens By Wallet` is cheaper per request.

Approximate per-call cost:

- Helius Wallet Balances: 100 credits
- Alchemy `assets/tokens/by-address`: 360 CU

Interpretation:

- If the page only needs “show me holdings, prices, and metadata”, Alchemy is viable.
- If you want the cleaner Solana-native wallet data model and lower latency, Helius is attractive.

Important Helius downside:

- Wallet API is explicitly documented as beta.

### B. History / PnL / funding analysis

Winner: Helius by a wide margin

Why:

- Helius has:
  - Wallet History
  - Token Transfers
  - Funding Source
  - Enhanced Transactions
  - `getTransactionsForAddress`

- Alchemy does not document an equivalent mature Solana wallet-history product in the sources reviewed here.

Your current Solana wallet history path is expensive:

- 1 `getSignaturesForAddress`
- then up to 100 `getTransaction` calls per page
- up to 10,000 transactions max

See:

- [src/services/SolanaProvider.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/SolanaProvider.ts:667)
- [src/services/SolanaRpcService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/SolanaRpcService.ts:244)

If you switch Solana wallet tracking to Helius `getTransactionsForAddress` or Wallet History, you can replace “one signatures call plus many transaction calls” with one indexed request per page.

That is the strongest product argument for Helius on Solana wallet tracking.

### Solana wallet tracking recommendation

If the Solana wallet page is meant to become a serious history/PnL/intelligence feature:

- choose Helius

If the Solana wallet page is mostly a holdings snapshot and you want vendor consolidation:

- Alchemy can work

But the more your page depends on:

- transaction history
- funding source discovery
- balance-change parsing
- swap filtering
- wallet intelligence

the stronger the case for Helius.

## EVM Safe Scan

Winner: no strong Helius-vs-Alchemy decision here

Why:

- the current EVM Safe Scan path is not centered on either provider
- it mainly uses GoPlus, DexScreener, and Uncx

So:

- buying Alchemy will not suddenly transform EVM Safe Scan
- Helius is not relevant here

Recommendation:

- do not use EVM Safe Scan as the deciding factor between Helius and Alchemy

## EVM Wallet Tracking

Winner: Alchemy

Why:

- Helius is Solana-focused
- Alchemy has broad EVM network support
- Alchemy already fits your existing EVM cost-basis flow

Current code already uses Alchemy for EVM history lookups:

- `alchemy_getAssetTransfers`
- `eth_getBlockByNumber`

See [src/services/AlchemyService.ts](C:/Users/USER/Desktop/atlaix%20main/src/services/AlchemyService.ts:307).

Approximate current EVM cost basis request cost:

- `alchemy_getAssetTransfers`: 120 CU
- `eth_getBlockByNumber`: 20 CU
- total Alchemy cost per lookup: about 140 CU

That is inexpensive.

Alchemy also gives you:

- multi-chain portfolio APIs
- 30+ EVM address activity webhook coverage
- historical transfers API
- broad chain support

Recommendation:

- use Alchemy for EVM wallet tracking

## Real-Time Tracking and Webhooks

### Helius

Strengths:

- strong Solana-native webhook story
- parsed and raw transaction webhooks
- 1 credit per webhook event
- 100k addresses per webhook

Best fit:

- Solana wallet monitoring
- Solana event-driven automation
- parsed Solana transfer or swap alerts

### Alchemy

Strengths:

- 100 webhooks on PayGo
- address activity webhooks across 30+ EVM chains
- Solana address activity is documented as available, but still looks earlier-stage than Helius’s Solana-specific event tooling
- bandwidth-based pricing, with typical webhook events around 40 CU on average

Best fit:

- EVM wallet monitoring
- multi-chain alerting across many EVM networks

## Final Recommendations

### Best-fit technical stack

- Helius Developer for Solana
- Alchemy Pay As You Go for EVMs

This is the best choice if:

- Solana Safe Scan matters
- Solana wallet history/PnL matters
- EVM wallet tracking also matters

Expected outcome:

- best Solana product quality
- cleaner path to faster Solana history and wallet analysis
- best EVM coverage
- two-vendor complexity

### Simplest vendor stack

- Alchemy for both Solana and EVMs

This is acceptable if:

- you strongly prefer one vendor
- Solana wallet tracking is mostly balances, not deep history
- you are willing to accept weaker Solana-native wallet-history tooling
- you keep custom Solana parsing work in your app

Expected outcome:

- simpler procurement
- simpler billing
- good EVM coverage
- weaker Solana specialization
- more pressure on your codebase to do heavy Solana reconstruction itself

### My decision if I were buying for Atlaix

I would buy:

- Helius Developer for Solana
- Alchemy Pay As You Go for EVMs

Reason:

- that pairing matches your product shape almost perfectly
- Solana Safe Scan and Solana wallet history are where Helius has the sharper edge
- EVM wallet tracking is where Alchemy is the natural fit
- Alchemy-only is viable, but it is a compromise on the exact Solana workflows that are hardest for you today

## Sources

- Alchemy pricing: https://www.alchemy.com/pricing
- Alchemy compute unit costs: https://www.alchemy.com/docs/reference/compute-unit-costs
- Alchemy throughput: https://www.alchemy.com/docs/reference/throughput
- Alchemy portfolio APIs: https://www.alchemy.com/docs/reference/portfolio-apis
- Alchemy Tokens By Wallet: https://www.alchemy.com/docs/reference/get-tokens-by-address
- Alchemy Transactions By Wallet beta: https://www.alchemy.com/docs/data/beta-apis/beta-api-endpoints/beta-api-endpoints/get-transaction-history-by-address
- Alchemy Transfers API overview: https://www.alchemy.com/docs/reference/transfers-api-quickstart
- Alchemy Address Activity Webhook: https://www.alchemy.com/docs/reference/address-activity-webhook
- Alchemy webhook pricing support note: https://www.alchemy.com/support/how-are-webhooks-and-websockets-priced
- Helius docs home: https://www.helius.dev/docs
- Helius plans: https://www.helius.dev/docs/billing/plans
- Helius rate limits: https://www.helius.dev/docs/billing/rate-limits
- Helius credits: https://www.helius.dev/docs/billing/credits
- Helius autoscaling: https://www.helius.dev/docs/billing/autoscaling
- Helius Enhanced Transactions overview: https://www.helius.dev/docs/enhanced-transactions/overview
- Helius `getTransactionsForAddress`: https://www.helius.dev/docs/rpc/gettransactionsforaddress
- Helius Wallet API: https://www.helius.dev/docs/api-reference/wallet-api
- Helius Wallet Balances: https://www.helius.dev/docs/wallet-api/balances
- Helius Wallet History: https://www.helius.dev/docs/wallet-api/history
- Helius webhooks: https://www.helius.dev/docs/webhooks
