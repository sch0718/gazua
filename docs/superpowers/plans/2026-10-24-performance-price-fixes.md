# Account performance price fixes

> Execute inline with test-driven-development and verification-before-completion. Review the final diff with requesting-code-review before pushing PR #33.

**Goal:** Preserve actual sale proceeds across corporate actions and disclose every estimated historical factor.

**Architecture:** Fetch original daily prices for every symbol with historical fills. Keep the load date on each StockSeries so current-day trades use factor 1 without comparing changing closes. For historical prices, derive common rounding bounds from all adjusted OHLC prices instead of a fixed percentage; prefer a simple ratio only when supported by at least two observed price pairs and no fewer pairs than the closing ratio. Missing historical bars are explicitly estimated. Price-derived split factors always show a rounding-error notice because rounded OHLC cannot uniquely identify every corporate action.

**Tech stack:** TypeScript, Svelte 5, Vitest, Playwright, pnpm.

## Constraints

- Keep order-cache cancellation, profile isolation, and key-lock behavior intact.
- Preserve the existing documented per-day estimate when historical original prices cannot be obtained.
- Do not change proxy allowlists, trading operations, or credentials.

## 1. Price factors

Files: src/lib/perf/portfolio.ts, src/lib/perf/types.ts, src/lib/perf/portfolio.test.ts.

- [x] Add tests for two 5% bonus issues (400 to 441 shares), an integer-rounded 2:1 split (103 to 52), current-day closes moving from 100 to 105, and an explicit current-day factor of 1 even when original bars are absent.
- [x] Run `corepack pnpm test src/lib/perf/portfolio.test.ts` and observe failures in actual proceeds or factors.
- [x] Replace the percentage tolerance with adjusted-price quantization bounds; add optional `asOf` date to StockSeries and use it consistently in timeline and reconciliation factors.
- [x] Run the portfolio, reconcile, and view tests.

## 2. Original-price coverage

Files: src/lib/ui/perf/perfController.svelte.ts, src/lib/ui/perf/perfController.test.ts.

- [x] Add controller regressions for an intraday-range-hidden 10% bonus, partial original-price coverage, original-price failure, current-day price movement, and current-day-only trades.
- [x] Run `corepack pnpm test src/lib/ui/perf/perfController.test.ts` and observe the old code fail.
- [x] Fetch original bars for historical fills through yesterday, set each series' asOf to the captured load date, and mark symbols with uncovered historical fill dates as estimated.
- [x] Update the obsolete selective-fetch test to assert accurate calculations and coverage.
- [x] Run controller and performance-route tests, then update spec 2.6 and live-check guidance.

## 3. Verification and delivery

- [x] Run `corepack pnpm test`, `corepack pnpm check`, and `corepack pnpm check:e2e`.
- [x] Run performance Playwright tests across the configured browser projects and proxy tests.
- [x] Review the final diff and fix validated findings.
- Delivery: commit only the intended files and push HEAD to claude/trusting-clarke-rqpsgu without force.
- Delivery: verify the PR head and report the commit, tests, and remaining live-account validation.

Validation: 2,593 unit/component tests, 197 script tests, 29 proxy tests, and 12 performance e2e tests passed. Type checks passed. Independent final review found no additional actionable issues beyond the documented price-rounding approximation.
