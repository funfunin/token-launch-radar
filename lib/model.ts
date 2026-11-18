// Token Radar, model radar-2: one snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never
// a ceiling) and every other clean pre-token protocol below it. A protocol
// is clean when it records no token (no market cap, no CoinGecko id, no
// symbol), is not a wrapped, staked or bridged product (its category is not
// Bridge, Canonical Bridge, Cross Chain Bridge, Liquid Staking, Liquid
// Restaking, Restaked BTC or CEX, and its name carries no whole word
// wrapped, staked or staking), and is not a versioned pool (its name does
// not end in a version marker). Live-token protocols are kept apart and
// shown with the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, five factors:
//
//   base       = tvl_usd x 0.25
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.7 + min(age_days, 730) / 730 x 0.3   (age unknown: 365)
//                Maturity saturates at two years: past that, age alone
//                adds no launch likelihood, and the long-no-token flag
//                already marks the downside of waiting three years.
//   category   = a launch-likelihood weight for the protocol's category
//                (Dexs, Lending, Risk Curators and Onchain Capital
//                Allocators 1.10; Yield, RWA, CDP, Derivatives, Restaking
//                and Yield Aggregators 1.05; Chain, Payments and
//                Stablecoin Wrappers 0.90; everything else 1.00)
//   chains     = 1 + min(chains - 1, 4) x 0.025  (multi-chain reach)
//   implied    = max(1, round(base x growthMult x maturity x category x chains))
//
// No protocol name is ever special-cased: the same function scores every
// row. The dashboard recomputes the same five factors from the same figures,
// so the page and board.json always agree.
//
// Beside the score, every row carries short risk flags from riskFlags:
// single-chain exposure, a very young or unknown age, a fast TVL fall or
// surge, and a TVL so large or so small that it changes how a farmer
// should read the number. The flags are a reading aid only; they never
// move the implied value, the rank, or the farm plan.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 730,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2.1';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  /** Short risk flags, derived only from the snapshot figures by riskFlags. */
  risk: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_multiplier: number;
  chain_multiplier: number;
  /** Short risk flags, copied from the board row so the page never recomputes them. */
  risk: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category's launch-likelihood weight, from its category alone. */
export function categoryMultiplier(category: string | null): number {
  switch (category) {
    case 'Dexs':
    case 'Lending':
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return 1.1;
    case 'Yield':
    case 'RWA':
    case 'CDP':
    case 'Derivatives':
    case 'Restaking':
    case 'Yield Aggregator':
      return 1.05;
    case 'Chain':
    case 'Payments':
    case 'Stablecoin Wrapper':
      return 0.9;
    default:
      return 1.0;
  }
}

/** The multi-chain reach weight, from the chain count alone. */
export function chainMultiplier(chains: string[]): number {
  return 1 + Math.min(Math.max(chains.length - 1, 0), 4) * 0.025;
}

/**
 * The risk-flag cutoffs. They are thresholds on the snapshot's own figures,
 * never on a name: a flag fires when the figure crosses the line, so two
 * protocols with the same figures always carry the same flags.
 */
export const RISK_THRESHOLDS = {
  /** A protocol younger than this many days is still proving it will last. */
  veryYoungDays: 180,
  /** A seven-day TVL fall steeper than this many per cent is falling fast. */
  fallingFastPct: -20,
  /** A seven-day TVL rise above this many per cent is a hot-money surge. */
  surgingPct: 50,
  /** A TVL at or above this many dollars is a concentration flag. */
  hugeTvlUsd: 5_000_000_000,
  /** A TVL below this many dollars is a thin-liquidity flag. */
  tinyTvlUsd: 10_000_000,
  /** An age at or above this many days with no token is a long-wait flag. */
  longNoTokenDays: 1095,
} as const;

/**
 * Short risk flags for one protocol, from the snapshot figures alone.
 *
 * Every flag is a plain reading of a figure the snapshot already carries:
 * how many chains it runs on, how old its listing is, how its TVL moved
 * in seven days, and how large its TVL is. Nothing here touches the
 * implied value, the ranking, or the farm plan: a flagged protocol keeps
 * exactly the score the five-factor model gives it, and the flags only
 * tell a reader what to watch before farming it.
 *
 * The flags, in the order they are checked:
 * - `no-chain-data` — the snapshot lists no chain at all.
 * - `single-chain` — it runs on exactly one chain, so one chain's outage
 *   or fee spike is the whole exposure.
 * - `very-young` — listed under 180 days ago, so there is little history
 *   to judge it by.
 * - `unknown-age` — no listing date, so the age, and the maturity factor
 *   built on it, is a guess (the model uses 365 days).
 * - `long-no-token` — listed for three years or more and still no token,
 *   so a token may simply never come.
 * - `falling-fast` — TVL fell more than 20% in seven days.
 * - `surging` — TVL rose more than 50% in seven days, which is often
 *   hot money that leaves as fast as it arrived.
 * - `huge-tvl` — TVL at or above $5B, so any position is a small fish in
 *   a very large pool and the implied value is concentrated in one name.
 * - `tiny-tvl` — TVL under $10M, so exits can be thin and slippage real.
 * - `no-growth-data` — no seven-day change was reported at all.
 */
export function riskFlags(protocol: SnapshotProtocol, age: number | null): string[] {
  const flags: string[] = [];
  const chainCount = protocol.chains.length;
  if (chainCount === 0) {
    flags.push('no-chain-data');
  } else if (chainCount === 1) {
    flags.push('single-chain');
  }
  if (age === null) {
    flags.push('unknown-age');
  } else if (age < RISK_THRESHOLDS.veryYoungDays) {
    flags.push('very-young');
  } else if (age >= RISK_THRESHOLDS.longNoTokenDays) {
    flags.push('long-no-token');
  }
  const change = protocol.change_7d;
  if (change === null) {
    flags.push('no-growth-data');
  } else if (change < RISK_THRESHOLDS.fallingFastPct) {
    flags.push('falling-fast');
  } else if (change > RISK_THRESHOLDS.surgingPct) {
    flags.push('surging');
  }
  if (protocol.tvl_usd >= RISK_THRESHOLDS.hugeTvlUsd) {
    flags.push('huge-tvl');
  } else if (protocol.tvl_usd < RISK_THRESHOLDS.tinyTvlUsd) {
    flags.push('tiny-tvl');
  }
  return flags;
}

/** One flag's plain-language reading, for the detail view's risk section. */
export function describeRisk(flag: string): string {
  switch (flag) {
    case 'no-chain-data':
      return 'No chain is listed for this protocol, so where it runs is unknown.';
    case 'single-chain':
      return 'Runs on a single chain, so one chain carries all of the exposure.';
    case 'very-young':
      return 'Listed less than 180 days ago, so there is little history to judge it by.';
    case 'unknown-age':
      return 'No listing date is recorded, so its age is estimated, not measured.';
    case 'long-no-token':
      return 'Listed for three years or more with no token, so a token may never come.';
    case 'falling-fast':
      return 'TVL fell more than 20% in the last seven days.';
    case 'surging':
      return 'TVL rose more than 50% in the last seven days, which is often hot money.';
    case 'huge-tvl':
      return 'TVL is $5B or more, so the implied value is concentrated in one large name.';
    case 'tiny-tvl':
      return 'TVL is under $10M, so exits can be thin and slippage is a real cost.';
    case 'no-growth-data':
      return 'No seven-day TVL change was reported, so recent momentum is unknown.';
    default:
      return 'An unusual figure in this protocol\'s snapshot record.';
  }
}

/**
 * How much attention a flag list deserves: `clean` when there is nothing
 * to flag, `watch` when one or two flags are present, and `high` when the
 * list is long or carries a fast fall, which is the sharpest warning here.
 */
export function riskLevel(flags: string[]): 'clean' | 'watch' | 'high' {
  if (flags.length === 0) return 'clean';
  if (flags.length >= 3 || flags.includes('falling-fast')) return 'high';
  return 'watch';
}

/**
 * A whole-dollar amount as a reader would write it: `$1,234,567`, with no
 * abbreviation to billions or millions, so a CSV or a copied figure keeps
 * the exact number. Null, undefined and non-finite input read as `n/a`.
 */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  const sign = n < 0 ? '-' : '';
  const whole = Math.round(Math.abs(n));
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}`;
}

/**
 * A percentage with a sign and two decimals: `+12.34%`, `-20.00%`, `0.00%`.
 * Null, undefined and non-finite input read as `n/a`, matching formatUsd.
 */
export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/** The five factors and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; categoryMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const categoryMult = categoryMultiplier(protocol.category);
  const chainMult = chainMultiplier(protocol.chains);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * categoryMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, categoryMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, clean, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  const words = p.name.toLowerCase().split(/[^a-z]+/);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every clean pre-token protocol below the watchlist
  // floor, not just the largest few. A chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, categoryMult, chainMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, categoryMult, chainMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      category_multiplier: s.categoryMult,
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    risk: riskFlags(s.p, s.age),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('payment')) return `Use ${name} on ${chain} to move $${capital} and keep a record of the payment.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and check the protocol's own points page.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, and never pay to claim.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and unwind if the TVL falls by half in a week or the token launches.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_multiplier: row.model.category_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    risk: row.risk,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
