// main.ts — token launch radar, model radar-3.0.
//
// Reads the sealed snapshot (default /input/snapshot.json, or --input),
// writes the ranked board to /output/board.json, writes the dashboard's
// data beside the page as /output/dashboard/data.js, copies dashboard/
// and screenshots/ to /output, and writes /output/dossier.json with
// buildDossier from vendor/makefun-board.ts. Node 22, standard library
// only; nothing is installed before it runs. The output directory is
// /output, or $MAKEFUN_OUTPUT_DIR. Both runs write the same bytes: no
// timestamps, no randomness anywhere in the outputs.
//
// Local run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//   --input /path/to/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, impliedValue, liveSet, MODEL_VERSION, type Snapshot } from './lib/model.ts';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

const inputPath = argValue('--input') ?? '/input/snapshot.json';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snapshot = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const rows = buildBoard(snapshot);
const live = liveSet(snapshot);

// ---------------------------------------------------------------- board.json

const boardDoc = {
  model: MODEL_VERSION,
  snapshot_as_of: snapshot.as_of,
  snapshot_source: snapshot.source,
  rows,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify(boardDoc, null, 2)}\n`, 'utf8');

// ---------------------------------------------------------------- dashboard data

// One compact array per row: slug, name, category, chain count, first
// chain, TVL, 7-day change, age in days (null when unknown), implied
// value, the four effective multipliers, risk flags as letters
// (f falling, y young, u age-unknown, s single-chain), watchlist 1/0.
// The page recomputes the V3 formula from these same figures, so the
// the page agree exactly; the farm steps are generated on the page
// from the same templates the board uses.
const flagLetters: Record<string, string> = { falling: 'f', young: 'y', 'age-unknown': 'u', 'single-chain': 's' };
const dashRows = rows.map((r) => [
  r.slug,
  r.name,
  r.category,
  r.chains.length,
  r.chains.length > 0 ? r.chains[0] : null,
  r.tvl_usd,
  r.change_7d,
  r.age_days,
  r.implied_value_usd,
  r.model.growth,
  r.model.maturity,
  r.model.category,
  r.model.chains,
  r.risk_flags.map((f) => flagLetters[f] ?? '?').join(''),
  r.watchlist ? 1 : 0,
]);
// Live-token comparables: slug, name, TVL, market cap, the V3 implied
// value the same formula gives — the calibration the page shows.
const dashLive = live.map((p) => [p.slug, p.name, p.tvl_usd, p.mcap_usd, impliedValue(p, snapshot.as_of)]);
const dataDoc = {
  model: MODEL_VERSION,
  as_of: snapshot.as_of,
  source: snapshot.source,
  rows: dashRows,
  live: dashLive,
};
const dashOut = join(outDir, 'dashboard');
mkdirSync(dashOut, { recursive: true });
for (const f of readdirSync(join(REPO_ROOT, 'dashboard'))) {
  copyFileSync(join(REPO_ROOT, 'dashboard', f), join(dashOut, f));
}
writeFileSync(join(dashOut, 'data.js'), `window.RADAR = ${JSON.stringify(dataDoc)};\n`, 'utf8');

// ---------------------------------------------------------------- screenshots + dossier

const shotsOut = join(outDir, 'screenshots');
mkdirSync(shotsOut, { recursive: true });
const shotsDir = join(REPO_ROOT, 'screenshots');
if (existsSync(shotsDir)) {
  for (const f of readdirSync(shotsDir)) {
    if (!f.startsWith('.')) copyFileSync(join(shotsDir, f), join(shotsOut, f));
  }
}

const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
writeFileSync(join(outDir, 'dossier.json'), dossier);

console.log(`radar-3.0: ${rows.length} rows (watchlist ${rows.filter((r) => r.watchlist).length}, early ${rows.filter((r) => !r.watchlist).length})`);
console.log(`implied range $${rows[rows.length - 1]!.implied_value_usd.toLocaleString('en-US')} - $${rows[0]!.implied_value_usd.toLocaleString('en-US')}`);
console.log(`top 3: ${rows.slice(0, 3).map((r) => r.slug).join(', ')}`);
console.log(`live comparables: ${live.length}`);
console.log(`dossier: ${dossier.length} bytes`);
