// lib/model.ts — radar-3.0: the token-launch scoring model.
//
// THE FIT (in short). V2 scored a protocol as TVL times 0.25 times five
// hand-tuned multipliers. V3 keeps V2's exact structure and multiplier
// definitions, but fits the TVL scale against real comparables: the
// implied value is a power law in TVL with exponent 0.45, a fitted scale
// constant of 3640, and every V2 multiplier applied at quarter strength
// (raised to 0.25). The fit uses the snapshot's own live-token
// protocols: 90 board-like comparables (live token, market cap above
// zero, TVL above zero, excluding Bridge, Canonical Bridge, Cross Chain
// Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX).
// Target: log of market cap. Model form, in logs: log(implied) =
// a + 0.45 * log(TVL) + 0.25 * log(V2 multipliers). The TVL slope from
// an unconstrained fit is 0.414 (standard error 0.128) on the 90 comps
// and 0.522 (0.095) on all 128 live comps, so 0.45 splits the two and
// sits inside both error bars. The intercept is fitted, not tuned:
// a = 8.1997, the mean of (log mcap - 0.45 * log TVL -
// 0.25 * log multipliers) over the 90 comps, so k = e^a = 3640 (use
// exactly 3640). Fitting on all 128 live comps instead gives k = 3864,
// within 6 percent, so the scale is stable to the comp-set choice.
// Any reader with the sealed snapshot can redo this fit from the rules
// above in a few lines.
//
// VALIDATION (in short). Two clean out-of-sample protocols (single
// 50/50 splits, six seeds, both directions; and five-fold
// cross-fitting, three seeds, Spearman inside each test fold only).
// Board-like comps, n = 90: V2 MAE_log 1.731, Spearman +0.370 / +0.350;
// V3 MAE_log 1.573, Spearman +0.380 / +0.362. V3 in-sample MAE_log
// 1.510. Paired bootstrap (1000 resamples) of the MAE gain: +0.204 log
// units, 95 percent interval [+0.030, +0.379], probability the gain is
// real 0.992. All 128 live comps: V2 1.778 / +0.416; V3 1.593 / +0.426;
// gain +0.190, interval [+0.041, +0.338], probability 0.990. V3 beats
// V2 on out-of-sample calibration by about 0.19 log units (roughly an
// 11 percent cut in mean absolute log error) and is at least tied on
// ranking. By TVL bucket V3 beats V2 in every bucket; V2's signed bias
// runs -0.41, +0.46, +2.81, +4.22 (it under-predicts small protocols
// and over-predicts the biggest by up to 68 times), V3's is -0.01,
// -0.53, +0.74, +1.31: far flatter.
//
// HONEST LIMIT. This model is better calibrated than V2 and still
// noisy: the residual standard deviation of the fit is 2.03 log units,
// so a typical implied value is still off by a factor of about e^1.53
// = 4.6. Market cap is a noisy target (token supply, float and vesting
// are not in the snapshot), and live-token caps are post-launch while
// the board predicts pre-token launches. The TVL slope is uncertain
// (0.414 +/- 0.128 on the 90 comps). If a later snapshot moves the
// fitted slope outside 0.3 to 0.6, refit rather than trusting these
// constants. An implied value is this entry's own claim, never a
// promise of what a token will be worth.

export const MODEL_VERSION = 'radar-3.0';

// Fitted constants (section 2 of the model spec). The growth, maturity,
// category and chain multiplier definitions are unchanged from V2; only
// their use changes: each is raised to MULTIPLIER_STRENGTH, the base is
// SCALE_K times TVL to TVL_EXPONENT, and the result is rounded and
// floored at 1 exactly as V2 does.
export const SCALE_K = 3640;
export const TVL_EXPONENT = 0.45;
export const MULTIPLIER_STRENGTH = 0.25;
export const GROWTH_WEIGHT = 0.6;
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;
export const MATURITY_FLOOR = 0.7;
export const MATURITY_RANGE = 0.3;
export const MATURITY_DAYS = 730;
export const UNKNOWN_AGE_DAYS = 365;

// ---------------------------------------------------------------- types

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface EffectiveMultipliers {
  growth: number;
  maturity: number;
  category: number;
  chains: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  risk_flags: string[];
  model: {
    scale_k: number;
    tvl_exponent: number;
    growth: number;
    maturity: number;
    category: number;
    chains: number;
  };
}

// ---------------------------------------------------------------- helpers

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/** Whole days from listed_at to the snapshot's as_of date, or null. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  return Math.floor((asOfMs - listed) / 86400000);
}

/** The seven-day TVL change, clamped to [-60, 120]; missing counts as 0. */
export function clampedGrowth(p: SnapshotProtocol): number {
  const g = p.change_7d === null ? 0 : p.change_7d;
  return Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, g));
}

/** Growth multiplier: 1 + (growth_pct / 100) * 0.6. */
export function growthMultiplier(p: SnapshotProtocol): number {
  return 1 + (clampedGrowth(p) / 100) * GROWTH_WEIGHT;
}

/** Maturity multiplier: 0.7 + (min(age, 730) / 730) * 0.3; unknown age counts as 365 days. */
export function maturityMultiplier(p: SnapshotProtocol, asOf: string): number {
  const age = ageDays(p, asOf) ?? UNKNOWN_AGE_DAYS;
  return MATURITY_FLOOR + (Math.min(age, MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
}

/** Category multiplier: 1.10 for the top tier, 1.05 for the middle, 0.90 for the low tier, else 1.00. */
export function categoryMultiplier(category: string | null): number {
  if (category === 'Dexs' || category === 'Lending' || category === 'Risk Curators' || category === 'Onchain Capital Allocator') return 1.1;
  if (
    category === 'Yield' ||
    category === 'RWA' ||
    category === 'CDP' ||
    category === 'Derivatives' ||
    category === 'Restaking' ||
    category === 'Yield Aggregator'
  )
    return 1.05;
  if (category === 'Chain' || category === 'Payments' || category === 'Stablecoin Wrapper') return 0.9;
  return 1.0;
}

/** Chain multiplier: 1 + min(max(chains - 1, 0), 4) * 0.025. */
export function chainMultiplier(p: SnapshotProtocol): number {
  return 1 + Math.min(Math.max(p.chains.length - 1, 0), 4) * 0.025;
}

// ---------------------------------------------------------------- the V3 formula

/**
 * The four V2 multipliers at quarter strength, each rounded to four
 * decimals. These are the numbers the board row carries, so that the
 * row's implied value equals round(scale_k * TVL^tvl_exponent * the
 * four shown multipliers) exactly.
 */
export function effectiveMultipliers(p: SnapshotProtocol, asOf: string): EffectiveMultipliers {
  return {
    growth: round4(Math.pow(growthMultiplier(p), MULTIPLIER_STRENGTH)),
    maturity: round4(Math.pow(maturityMultiplier(p, asOf), MULTIPLIER_STRENGTH)),
    category: round4(Math.pow(categoryMultiplier(p.category), MULTIPLIER_STRENGTH)),
    chains: round4(Math.pow(chainMultiplier(p), MULTIPLIER_STRENGTH)),
  };
}

/**
 * Implied value in whole dollars: max(1, round(3640 * TVL^0.45 *
 * growth^0.25 * maturity^0.25 * category^0.25 * chains^0.25)), the
 * multipliers being the rounded effective ones above. After the
 * quarter-strength shrinkage the effective ranges are: growth 0.894
 * to 1.145 (was 0.64 to 1.72), maturity 0.915 to 1.000 (was 0.70 to
 * 1.00), category 0.974 to 1.024 (was 0.90 to 1.10), chains 1.000 to
 * 1.024 (was 1.00 to 1.10). Every factor still moves the score, but
 * none dominates it. Worked scale: at TVL $50M the base is about
 * $10.6M; at $100M about $14.5M; at $1B about $41M; at $3B about $66M.
 */
export function impliedValue(p: SnapshotProtocol, asOf: string): number {
  const m = effectiveMultipliers(p, asOf);
  const base = SCALE_K * Math.pow(p.tvl_usd, TVL_EXPONENT);
  return Math.max(1, Math.round(base * m.growth * m.maturity * m.category * m.chains));
}

// ---------------------------------------------------------------- risk flags

/**
 * Risk flags, each with its threshold stated here and in the README:
 * falling — the seven-day TVL change is below -10 percent; young —
 * the protocol has run under 180 days; age-unknown — no listing date
 * is recorded; single-chain — its TVL sits on one chain only. A flag
 * is a warning to size down and watch, never a verdict on its own.
 */
export function riskFlags(p: SnapshotProtocol, asOf: string): string[] {
  const flags: string[] = [];
  const g = p.change_7d === null ? 0 : p.change_7d;
  if (g < -10) flags.push('falling');
  const age = ageDays(p, asOf);
  if (age !== null && age < 180) flags.push('young');
  if (age === null) flags.push('age-unknown');
  if (p.chains.length === 1) flags.push('single-chain');
  return flags;
}

// ---------------------------------------------------------------- board selection

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** True when the protocol records no token (both gecko_id and symbol null). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * The watchlist's exclusion rules, as the snapshot's field guide states
 * them: a versioned name, a wrapped / staked / bridged product's
 * category, a name carrying the whole word wrapped, staked or staking,
 * or a name beginning with an exchange's name. (DefiLlama's
 * parentProtocol is not one of the snapshot's fields, so the rule as
 * written here is what the entry can apply; the watchlist itself is
 * read from the snapshot, not rebuilt.) Applied to the pre-token
 * protocols below the floor, these rules keep exactly 138 of 210.
 */
export function isExcludedProduct(p: SnapshotProtocol): boolean {
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  for (const ex of EXCHANGE_NAMES) if (p.name.startsWith(ex)) return true;
  return false;
}

/**
 * The board: every protocol on the snapshot's watchlist (40), plus the
 * early ones — pre-token protocols below the floor that are not
 * excluded products (138 on this snapshot) — 178 rows in all, ranked
 * by implied value, highest first. The watchlist is a floor, never a
 * ceiling: the early rows are the radar's whole point, the launches
 * below the line that a TVL table would miss.
 */
export function selectBoard(snapshot: Snapshot): SnapshotProtocol[] {
  const watchlist = new Set(snapshot.watchlist);
  const rows: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (watchlist.has(p.slug)) {
      rows.push(p);
    } else if (isPreToken(p) && p.tvl_usd < snapshot.floor_usd && !isExcludedProduct(p)) {
      rows.push(p);
    }
  }
  return rows;
}

/** The live-token set: the 24 protocols with the largest market cap above zero. */
export function liveSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, 24);
}

// ---------------------------------------------------------------- farm plans

/** What a reader actually does on a protocol of this category, in one phrase. */
export function categoryAction(category: string | null): string {
  switch (category) {
    case 'Dexs':
      return 'swap and provide liquidity';
    case 'Lending':
      return 'lend and borrow';
    case 'Yield':
      return 'deposit into yield vaults';
    case 'Yield Aggregator':
      return 'deposit into aggregated vaults';
    case 'RWA':
      return 'buy tokenised real-world assets';
    case 'CDP':
      return 'mint stablecoins against collateral';
    case 'Derivatives':
      return 'open derivatives positions';
    case 'Restaking':
      return 'restake assets';
    case 'Risk Curators':
      return 'deposit into curated vaults';
    case 'Onchain Capital Allocator':
      return 'allocate into managed vaults';
    case 'Chain':
      return 'bridge in and use the chain apps';
    case 'Payments':
      return 'use the payment rails';
    case 'Stablecoin Wrapper':
      return 'wrap and unwrap stablecoins';
    default:
      return 'use the protocol';
  }
}

/**
 * Six concrete farm steps for one protocol: what to do, what it costs
 * and how long it takes — never slogans. The steps are a deterministic
 * function of the protocol's name, category and first chain, so the
 * dashboard renders exactly the steps the board carries.
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const name = p.name;
  const chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
  const action = categoryAction(p.category);
  const category = p.category ?? 'DeFi';
  return [
    `Set up a fresh wallet for ${name} on ${chain} and bridge in funds you can afford to leave for weeks. Bridging costs a few dollars in gas and takes about 10 minutes.`,
    `Make a first ${action} position on ${name} (${chain}) with a few hundred dollars, so you learn the flow before sizing up. About 15 minutes plus gas.`,
    `Add a second position in a different ${category} pool or feature of ${name} and leave both open: launches usually reward depth and time, not one-off clicks. 15 to 30 minutes.`,
    `Come back once a week and make one real on-chain action on ${name} — a top-up, a swap or a claim — so the address stays active across weeks. About 10 minutes a week.`,
    `Check ${name}'s own announcements for a points program or quests and do only the tasks the protocol itself publishes. Never pay anyone for a whitelist spot.`,
    `Keep a simple log of every deposit with dates and amounts, and never deposit more than you can lose. Exit promptly if ${name}'s TVL falls sharply two weeks in a row.`,
  ];
}

// ---------------------------------------------------------------- board build

/** Build the ranked board: 178 rows, rank 1 the most valuable, each row carrying its model block. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const asOf = snapshot.as_of;
  const watchlist = new Set(snapshot.watchlist);
  const selected = selectBoard(snapshot);
  const scored = selected.map((p) => {
    const m = effectiveMultipliers(p, asOf);
    return {
      p,
      implied: impliedValue(p, asOf),
      m,
    };
  });
  scored.sort((a, b) => b.implied - a.implied);
  return scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: ageDays(s.p, asOf),
    watchlist: watchlist.has(s.p.slug),
    risk_flags: riskFlags(s.p, asOf),
    model: {
      scale_k: SCALE_K,
      tvl_exponent: TVL_EXPONENT,
      growth: s.m.growth,
      maturity: s.m.maturity,
      category: s.m.category,
      chains: s.m.chains,
    },
  }));
}
