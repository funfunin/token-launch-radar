# Token Launch Radar — radar-3.0

A radar for the protocols that record no token yet: it ranks them by what
a token would be worth if their record stayed as it is, and shows a
reader how to farm each one. 178 rows on the sealed snapshot of
2026-11-14: the 40 protocols on the watchlist, plus 138 early finds
below the $50M floor.

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/funfunin/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/funfunin/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

## The model: radar-3.0

V2 (radar-2.1) scored a protocol as TVL times 0.25 times five hand-tuned
multipliers. V3 keeps V2's exact structure and multiplier definitions,
but fits the TVL scale against real comparables: the implied value is a
power law in TVL with exponent 0.45, a fitted scale constant of 3640,
and every V2 multiplier applied at quarter strength (raised to 0.25).

```
implied = round(3640 × TVL^0.45 × growth^0.25 × maturity^0.25
                × category^0.25 × chains^0.25), floored at 1
```

The multipliers are V2's, unchanged: growth is 1 + (7-day TVL change,
clamped to −60…120%) × 0.6; maturity is 0.7 + (min(age, 730) / 730) × 0.3
(unknown age counts as 365 days); category is 1.10 for Dexs, Lending,
Risk Curators and Onchain Capital Allocator, 1.05 for Yield, RWA, CDP,
Derivatives, Restaking and Yield Aggregator, 0.90 for Chain, Payments
and Stablecoin Wrapper, 1.00 otherwise; chains is 1 + min(chains − 1, 4)
× 0.025. Each board row carries the four *effective* (shrunk)
multipliers to four decimals, so its implied value equals
round(3640 × TVL^0.45 × the four shown multipliers) exactly.

**The fit.** Fitted on the 90 board-like live-token comparables in the
sealed snapshot (live token, market cap above zero, TVL above zero,
excluding Bridge, Canonical Bridge, Cross Chain Bridge, Liquid Staking,
Liquid Restaking, Restaked BTC and CEX): log market cap on log TVL.
The TVL slope from an unconstrained fit is 0.414 (standard error 0.128)
on the 90 comps and 0.522 (0.095) on all 128 live comps, so 0.45 splits
the two and sits inside both error bars. The intercept is fitted, not
tuned: a = 8.1997, the mean of (log mcap − 0.45 × log TVL − 0.25 × log
multipliers) over the 90 comps, so k = e^a = 3640. Fitting on all 128
live comps instead gives k = 3864, within 6 percent.

**Validation, out-of-sample.** Two clean protocols (single 50/50 splits,
six seeds, both directions; and five-fold cross-fitting, three seeds,
Spearman inside each test fold only). Board-like comps, n = 90: V2
MAE_log 1.731, Spearman +0.370; V3 MAE_log 1.573, Spearman +0.380.
All 128 live comps: V2 1.778 / +0.416; V3 1.593 / +0.426. Paired
bootstrap of the MAE gain: +0.204 log units on the 90 comps, 95%
interval [+0.030, +0.379], probability the gain is real 0.992. V3
beats V2 on out-of-sample calibration by about 0.19 log units (roughly
an 11% cut in mean absolute log error) and is at least tied on ranking.
By TVL bucket V3 beats V2 in every bucket; V2's signed bias runs −0.41,
+0.46, +2.81, +4.22, V3's −0.01, −0.53, +0.74, +1.31.

**Honest limit.** V3 is better calibrated than V2 and still noisy: the
residual standard deviation is 2.03 log units, so a typical implied
value is still off by a factor of about 4.6. Market cap is a noisy
target (supply, float and vesting are not in the snapshot), and live
caps are post-launch while this board predicts pre-token launches. If a
later snapshot moves the fitted slope outside 0.3 to 0.6, refit rather
than trusting these constants.

## The board

178 rows, ranked by implied value. The top 10 is the same set as V2's
in nearly the same order (only ranks 7 and 8 swap); the top 25 is the
same set. The story is calibration, not a reshuffle: the ranking is
essentially V2's, the values far more plausible (V3 implied values run
about $3.5M to $66M, against V2's $0.9M to $759M).

Risk flags, with thresholds: **falling** (7-day TVL change below −10%),
**young** (running under 180 days), **age-unknown** (no listing date
recorded), **single-chain** (TVL on one chain only). Each row carries
six concrete farm steps with what they cost and how long they take.

The dashboard also shows the 24 largest live-token protocols by market
cap, with the same V3 formula applied to each, so a reader can see
where the model tracks real caps and where it misses. Those are not
farm targets — their tokens already trade.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes
`board.json`, writes the dashboard's data beside the page as
`dashboard/data.js`, copies `dashboard/` and `screenshots/` to the
output, and writes `dossier.json` with `buildDossier` from
`vendor/makefun-board.ts`. Two runs write the same bytes. The page
renders with no network: it reads only `data.js` beside it.
