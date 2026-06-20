#!/usr/bin/env node
/**
 * Targeted backfill: localize company names in a committed
 * public/data/<game>/game-defs.json from the game's `def/company/*.sui` files.
 *
 * WHY this exists instead of a full reparse (#289):
 *   - The parser already localizes company names via buildCompanyNameMap()
 *     (scripts/parse-game-defs.ts) on a full reparse — but ATS can't be reparsed
 *     locally: the donated def dump is missing cities from unowned map DLCs, so a
 *     full reparse trips the GARAGE_CITIES drift guard and exits.
 *   - The company defs themselves ARE present (def/company/*.sui carry a literal
 *     `name:`), so the names are recoverable without touching cities. This
 *     surgical patch sets only the `name` field, the same targeted approach used
 *     for trailer axles (#250) and the original ETS2 company-name pass (#267).
 *
 * Applies buildCompanyNameMap()'s rules: a `company.permanent.<id>` unit with a
 * literal `name` (trimmed, skipping `@@token@@` localization refs). Only companies
 * present in BOTH the defs and game-defs.json are touched; the rest keep their
 * mechanical title-case (e.g. ATS airports with no base def).
 *
 * NOTE: this is a lightweight text-regex extractor, not the parser's SCS
 * tokenizer. It matches the current corpus exactly (one unit per file, no
 * comments, no escaped quotes, plain ASCII names) but would diverge on
 * pathological defs (escaped quotes, multiple units per file). On a real reparse
 * buildCompanyNameMap() is canonical; this is only the no-reparse bridge.
 *
 * Idempotent and additive — only `name` values change; no company added/removed.
 * Preserves the file's original trailing-newline style.
 *
 * Usage: node scripts/backfill-company-names.cjs [game] [defBase]
 *   game    defaults to ats
 *   defBase defaults to analysis/def-1.60
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const game = process.argv[2] || 'ats';
const defBase = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repoRoot, 'analysis', 'def-1.60');

/** Map<companyId, localizedName> from def/company/*.sui — mirrors buildCompanyNameMap(). */
function companyNamesFromDefs() {
  const dir = path.join(defBase, game, 'def', 'company');
  const names = new Map();
  if (!fs.existsSync(dir)) {
    console.error(`[${game}] no company def dir at ${dir}`);
    return names;
  }
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.sui')) continue;
    const txt = fs.readFileSync(path.join(dir, file), 'utf8');
    const idMatch = txt.match(/company\.permanent\.([^\s{]+)/);
    const nameMatch = txt.match(/^[ \t]*name:[ \t]*"([^"]*)"/m); // standalone `name:`, not sort_name
    if (!idMatch || !nameMatch) continue;
    const trimmed = nameMatch[1].trim();
    if (!trimmed || /^@@.*@@$/.test(trimmed)) continue; // skip empty / unresolved locale tokens
    names.set(idMatch[1], trimmed);
  }
  return names;
}

const jsonPath = path.join(repoRoot, 'public', 'data', game, 'game-defs.json');
const raw = fs.readFileSync(jsonPath, 'utf8');
const trailingNewline = raw.endsWith('\n') ? '\n' : '';
const data = JSON.parse(raw);

const nameById = companyNamesFromDefs();
let localized = 0;
let noDef = 0;
for (const [id, company] of Object.entries(data.companies)) {
  const name = nameById.get(id);
  if (name === undefined) { noDef++; continue; }
  if (company.name !== name) localized++;
  company.name = name;
}

fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + trailingNewline);
console.log(`[${game}] localized ${localized} company name(s); ${noDef} without a def kept title-cased → ${path.relative(repoRoot, jsonPath)}`);
