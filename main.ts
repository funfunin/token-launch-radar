// Token Radar, radar-2 (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or
// --input <file|dir>), scores every clean pre-token protocol with the model
// in lib/model.ts, writes the ranked board to /output/board.json, and copies
// this repository's dashboard/ and screenshots/ to /output. Last, it writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * The usage text for --help and -h: what the program reads, what it
 * writes, and which knobs move either. It prints to stdout and the
 * program exits 0, so `node main.ts --help` is a safe smoke test that
 * never touches a snapshot or writes an output directory.
 */
const USAGE = `Token Radar (radar-2) — rank pre-token protocols by implied launch value.

Usage:
  node main.ts [--input <snapshot.json|directory>] [--output <dir>]
  node main.ts --help

Options:
  --input <path>    Snapshot to read. A JSON file, or a directory holding
                    snapshot.json. Default: /input (the sealed snapshot
                    the grader mounts). In local runs this is usually
                    ../input/snapshot.json from the kit.
  --output <dir>    Directory to write into. Default: the value of
                    MAKEFUN_OUTPUT_DIR, or /output when that is unset.
                    Local runs usually set MAKEFUN_OUTPUT_DIR=out.
  --help, -h        Print this usage and exit 0. No files are read or
                    written.

What it writes (all inside the output directory):
  board.json        The ranked board: one row per clean pre-token
                    protocol, with its implied value, its five-factor
                    model breakdown, its risk flags and its farm plan.
  data.js           The same board in the compact form the dashboard
                    page reads, as window.RADAR.
  dashboard/        A copy of this repository's dashboard/ page.
  screenshots/      A copy of this repository's screenshots/ images.
  dossier.json      The judge's dossier, built by vendor/makefun-board.ts
                    from the dashboard and screenshots just written.

The snapshot must hold at least one protocol; an empty snapshot is
refused with exit code 2. The program needs Node 22 or later and the
standard library only — nothing is installed and nothing is fetched.
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
if (snapshot.protocols.length === 0) {
  process.stderr.write(
    `token radar: the snapshot at ${inputFile} holds no protocols at all: ` +
      `there is nothing to score, so the board would be empty. ` +
      `Pass a snapshot with at least one protocol (the sealed snapshot ` +
      `holds 758) and run again.\n`,
  );
  process.exit(2);
}
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
