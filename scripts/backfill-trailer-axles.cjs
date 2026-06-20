#!/usr/bin/env node
/**
 * One-time backfill: inject the `axles` field into the committed
 * public/data/<game>/game-defs.json trailer entries.
 *
 * WHY this exists instead of a full reparse (#250):
 *   - parse-game-defs.ts already parses `axles` from the trailer defs and (after
 *     #250) emits it, so a future *full* reparse carries it natively.
 *   - But ATS cannot be reparsed locally: the donated ATS def dump is partial on
 *     the city side and a full reparse trips the GARAGE_CITIES drift guard
 *     (process.exit(1)). ETS2 reparses clean, ATS does not.
 *   - The trailer defs themselves ARE complete for both games (ETS2 514/514,
 *     ATS 562/562, every def carries an `axles:` line), so the axle data is
 *     fully recoverable without touching cities. This surgical patch backfills
 *     only `axles`, leaving every other field byte-identical — the same
 *     targeted-patch approach used for company names in #267.
 *
 * Source of truth: analysis/def-1.60/<game>/def/vehicle/trailer_defs/*.sii
 * Output: public/data/<game>/game-defs.json (axles inserted after `length`).
 *
 * Idempotent. Errors out without writing if any trailer lacks a def axle value,
 * so a partial dump can never silently produce zero-axle trailers.
 *
 * Usage: node scripts/backfill-trailer-axles.cjs [defBase]
 *   defBase defaults to analysis/def-1.60
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const defBase = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'analysis', 'def-1.60');

/** Parse every trailer def into a Map<trailerId, axles>. */
function axlesByTrailerId(game) {
  const dir = path.join(defBase, game, 'def', 'vehicle', 'trailer_defs');
  const map = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.sii')) continue;
    const txt = fs.readFileSync(path.join(dir, file), 'utf8');
    const idMatch = txt.match(/trailer_def\s*:\s*trailer_def\.([^\s{]+)/);
    const axMatch = txt.match(/\baxles:\s*(\d+)/);
    if (idMatch && axMatch) map.set(idMatch[1], parseInt(axMatch[1], 10));
  }
  return map;
}

/** Rebuild a trailer object with `axles` inserted immediately after `length`. */
function withAxles(trailer, axles) {
  const out = {};
  for (const [k, v] of Object.entries(trailer)) {
    if (k === 'axles') continue; // drop any stale value; re-inserted in position
    out[k] = v;
    if (k === 'length') out.axles = axles;
  }
  if (!('axles' in out)) out.axles = axles; // no `length` key (defensive)
  return out;
}

let failed = false;
for (const game of ['ets2', 'ats']) {
  const jsonPath = path.join(repoRoot, 'public', 'data', game, 'game-defs.json');
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const trailingNewline = raw.endsWith('\n') ? '\n' : ''; // preserve per-file style → purely additive diff
  const data = JSON.parse(raw);
  const axById = axlesByTrailerId(game);

  const missing = [];
  const trailers = {};
  for (const [id, t] of Object.entries(data.trailers)) {
    const axles = axById.get(id);
    if (axles === undefined) {
      missing.push(id);
      trailers[id] = t;
      continue;
    }
    trailers[id] = withAxles(t, axles);
  }

  if (missing.length > 0) {
    console.error(`[${game}] ${missing.length} trailer(s) have no def axle value — NOT writing:`);
    for (const id of missing) console.error(`  - ${id}`);
    failed = true;
    continue;
  }

  data.trailers = trailers;
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + trailingNewline);
  console.log(`[${game}] backfilled axles on ${Object.keys(trailers).length} trailers → ${path.relative(repoRoot, jsonPath)}`);
}

if (failed) process.exit(1);
