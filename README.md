<!-- Project overview and repository guide for the Atlaix platform. -->

# Atlaix Intelligence Platform

Atlaix is an AI-assisted crypto intelligence platform for discovering, qualifying, and investigating high-signal market activity. The product combines live market data, on-chain activity, wallet intelligence, liquidity analysis, and risk signals into structured feeds that help users decide which tokens deserve attention.

The platform is currently in functional MVP development. The priority is to make the core intelligence surfaces reliable, explainable, and useful before expanding into deeper AI synthesis and narrative correlation.

## Core Modules

### Alpha Gauntlet

Alpha Gauntlet v1 is the market activity qualification layer for the platform. It filters tokens by market structure, detects meaningful activity triggers, classifies the event, and assigns an Alpha score.

Current v1 outputs power:

- Overview Alpha Feed for the strongest qualified events.
- Detection Engine Feed for broader qualified events.
- Token detail timelines for event-level context.

Alpha Gauntlet v1 focuses on market and on-chain activity only. Smart Money scoring, narrative scoring, advanced SafeScan correlation, and AI synthesis are planned as later scoring layers.

### Detection Engine

The Detection Engine helps users investigate qualified token events. It surfaces Alpha Gauntlet events with supporting context such as event type, severity, triggers, score, volume pressure, liquidity behavior, and chain filters.

### Smart Money Scanner

The Smart Money Scanner identifies and evaluates wallet activity patterns. It is designed as a deeper intelligence layer that tracks wallet cohorts, trading behavior, wallet quality, capital movement, and portfolio-level signals.

### SafeScan

SafeScan provides token risk and forensic analysis. It focuses on holder structure, bundle behavior, liquidity risk, contract/security indicators, and graph-style relationship analysis.

### Token Intelligence

Token detail pages combine price charts, token metadata, market structure, transaction activity, safety indicators, and Alpha Gauntlet timeline events into a single investigation view.

### Smart Alerts

Smart Alerts are planned alerting workflows for monitored tokens, wallets, market events, and risk conditions.

## Repository Structure

| Path | Description |
| --- | --- |
| `src/` | Main React and TypeScript application source. |
| `src/pages/` | Route-level screens such as Overview, Detection, SafeScan, Smart Money, wallet tracking, and token details. |
| `src/components/` | Reusable UI and feature components used across pages. |
| `src/components/layout/` | Application shell, navigation, and layout structure. |
| `src/components/safe-scan/` | SafeScan visual and forensic graph components. |
| `src/components/token/` | Token chart, overview cards, sidebar, and transaction display components. |
| `src/components/wallet/` | Wallet tracking cards, modals, chain selection, and holdings UI. |
| `src/services/` | Business logic, provider clients, scoring engines, scanners, and data adapters. |
| `src/services/AlphaGauntletService.ts` | Alpha Gauntlet v1 market qualification, trigger detection, classification, and scoring engine. |
| `src/services/DatabaseService.ts` | Market data discovery, Supabase persistence, DexScreener reads, and token detail helpers. |
| `src/services/SafeScanService.ts` | SafeScan orchestration and token risk analysis service. |
| `src/services/SmartMoneyScannerService.ts` | Smart Money scanning workflow and wallet candidate evaluation. |
| `src/services/forensics/` | Lower-level forensic intelligence helpers for bundle and holder analysis. |
| `src/hooks/` | Shared React hooks, including wallet portfolio loading. |
| `src/types/` | Shared TypeScript types for market data, wallets, Alpha Gauntlet events, and enriched token data. |
| `src/utils/` | Formatting, chain metadata, wallet helpers, and shared utilities. |
| `server/` | Local Node/TypeScript backend utilities for forensic scans and scanner discovery workflows. |
| `supabase/` | SQL schema files for Smart Money scanner storage and wallet intelligence tables. |
| `docs/` | Planning notes, provider comparisons, SafeScan remediation notes, and architecture references. |
| `public/` | Static deployment assets and redirect rules. |
| `index.html` | Vite HTML entry point. |
| `vite.config.ts` | Vite configuration, local proxies, chunking, and build setup. |
| `netlify.toml` | Netlify routing and deployment configuration. |
| `package.json` | Scripts, runtime dependencies, dev dependencies, and project metadata. |
| `.env.example` | Template for required local environment variables. |

## Tech Stack

- TypeScript
- React
- Vite
- Supabase
- Node.js / TSX local worker runtime
- Vitest and Testing Library
- DexScreener, Moralis, Alchemy, Helius, GoPlus, RugCheck, and supporting provider APIs

## Local Development

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Add the required provider keys and public Supabase browser config values.

Run the full local development stack:

```bash
npm run dev
```

Run only the Vite frontend:

```bash
npm run dev:web
```

Run only the local forensic backend:

```bash
npm run dev:forensics
```

Build for production:

```bash
npm run build
```

Run tests:

```bash
npm test
```

## Environment Variables

Use `.env.example` as the source of truth for required local values. Browser-exposed values must use the `VITE_` prefix. Secret provider keys should stay server-side whenever possible.

Common local values include:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MORALIS_KEY`
- `VITE_ALCHEMY_KEY`
- `VITE_HELIUS_KEY`
- `VITE_GOPLUS_KEY`
- `VITE_GOPLUS_SECRET`

## Development Standards

- Use clear, professional commit messages.
- Keep feature work scoped to the relevant module.
- Prefer typed service logic over ad hoc UI-only calculations.
- Validate meaningful changes with `npm run build` and targeted tests when available.
- Do not commit real secrets or local log output.
- Keep README and documentation current when major modules or workflows change.

## Suggested GitHub About Text

Repository description:

```text
AI-powered crypto intelligence platform for token detection, market activity scoring, wallet intelligence, and risk analysis.
```

Suggested topics:

```text
crypto, defi, token-analysis, wallet-intelligence, risk-scoring, react, vite, supabase, typescript
```

## Status

Atlaix is in active MVP development. The current focus is strengthening Alpha Gauntlet v1, Detection Engine workflows, SafeScan analysis, and Smart Money scanner reliability.

## License

This project is proprietary and confidential. Unauthorized copying, distribution, or use of this repository is prohibited.
