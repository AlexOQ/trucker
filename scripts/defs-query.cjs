#!/usr/bin/env node
/**
 * Query helper over public/data/<game>/game-defs.json.
 *
 * The cargo / companies / city_companies / cities sections are all id-keyed
 * maps, NOT arrays — iterating them as arrays yields the keys (strings), which
 * is the `'str' has no attribute 'get'` class of bug this tool exists to kill.
 * Everything here accesses them as maps (obj[id] / Object.entries) only.
 *
 * Usage:
 *   node scripts/defs-query.cjs <subcommand> <arg> [--game ets2|ats]
 *
 *   cargo <id>                     cargo record
 *   companies-for-cargo <id>       companies whose cargo_out includes <id>
 *   city <id>                      city record
 *   city-companies <id>            companies present in a city ({companyId:count} map)
 *   cargo-search <substr|/regex/>  cargo records whose id or name matches
 *   dlc [section]                  DLC registry (whole, or one section)
 *
 * Output is JSON on stdout. Unknown ids / args exit non-zero with a one-line
 * message on stderr — no stack traces. `cargo-search` is a SEARCH, so zero
 * matches is an empty result (exit 0), not an error.
 */
const fs = require('fs');
const p = require('path');

const GAMES = ['ets2', 'ats'];
const SUBCOMMANDS = ['cargo', 'companies-for-cargo', 'city', 'city-companies', 'cargo-search', 'dlc'];
// Commands whose positional arg is optional (everything else requires one).
const OPTIONAL_ARG = new Set(['dlc']);

function usage() {
  return [
    'Usage: node scripts/defs-query.cjs <subcommand> <arg> [--game ets2|ats]',
    '',
    'Subcommands:',
    '  cargo <id>                     cargo record',
    '  companies-for-cargo <id>       companies whose cargo_out includes <id>',
    '  city <id>                      city record',
    '  city-companies <id>            companies present in a city',
    '  cargo-search <substr|/regex/>  cargo records whose id or name matches',
    '  dlc [section]                  DLC registry (whole, or one section)',
    '',
    `--game defaults to ${GAMES[0]} (one of: ${GAMES.join(', ')})`,
  ].join('\n');
}

function die(msg) {
  process.stderr.write(`defs-query: ${msg}\n`);
  process.exit(1);
}

// Parse args: one --game flag (with value, anywhere) + positional subcommand/id.
function parseArgs(argv) {
  let game = GAMES[0];
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--game') {
      game = argv[++i];
      if (game === undefined) die('--game requires a value (ets2|ats)');
    } else if (a.startsWith('--game=')) {
      game = a.slice('--game='.length);
    } else if (a === '-h' || a === '--help') {
      process.stdout.write(usage() + '\n');
      process.exit(0);
    } else {
      positional.push(a);
    }
  }
  if (!GAMES.includes(game)) die(`unknown game '${game}' (expected one of: ${GAMES.join(', ')})`);
  return { game, subcommand: positional[0], arg: positional[1] };
}

// A cargo-search query is either /regex/flags (JS-literal form — flags honored
// exactly as written, so `/med|equip/i` is case-insensitive like the ad-hoc
// one-liner it replaces) or a bare substring (always case-insensitive contains).
// Returns a predicate over a single string. An unparseable regex dies cleanly.
function buildMatcher(query) {
  const m = /^\/(.*)\/([a-z]*)$/.exec(query);
  if (m) {
    let rx;
    try {
      rx = new RegExp(m[1], m[2]);
    } catch (e) {
      die(`invalid regex ${query}: ${e.message}`);
    }
    return (s) => rx.test(s);
  }
  const needle = query.toLowerCase();
  return (s) => s.toLowerCase().includes(needle);
}

function loadDefs(game) {
  const file = p.join(__dirname, '..', 'public', 'data', game, 'game-defs.json');
  if (!fs.existsSync(file)) die(`no game-defs.json for game '${game}' at ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    die(`failed to parse ${file}: ${e.message}`);
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// Own-property check, not bracket truthiness. `defs.cargo['toString']` (and
// other Object.prototype names — constructor, valueOf, hasOwnProperty,
// __proto__, …) would otherwise resolve to an inherited member, reporting a
// bogus hit for a prototype-name id: exit 0 instead of the unknown-id error
// the #279 contract requires. Object.hasOwn keys the check to real data only.
function has(map, id) {
  return Object.hasOwn(map, id);
}

const COMMANDS = {
  cargo(defs, id) {
    if (!has(defs.cargo, id)) die(`unknown cargo id '${id}'`);
    emit({ id, ...defs.cargo[id] });
  },

  'companies-for-cargo'(defs, id) {
    if (!has(defs.cargo, id)) die(`unknown cargo id '${id}'`);
    const companies = Object.entries(defs.companies)
      .filter(([, c]) => Array.isArray(c.cargo_out) && c.cargo_out.includes(id))
      .map(([cid, c]) => ({ id: cid, name: c.name }));
    emit({ cargo: id, count: companies.length, companies });
  },

  city(defs, id) {
    if (!has(defs.cities, id)) die(`unknown city id '${id}'`);
    emit({ id, ...defs.cities[id] });
  },

  'city-companies'(defs, id) {
    if (!has(defs.city_companies, id)) die(`unknown city id '${id}' (no city_companies entry)`);
    const companies = Object.entries(defs.city_companies[id]).map(([cid, count]) => ({
      id: cid,
      name: has(defs.companies, cid) ? defs.companies[cid].name : null,
      count,
    }));
    emit({ city: id, count: companies.length, companies });
  },

  // Search over the cargo map by id OR name — the id record's `name` is a
  // distinct token (e.g. id `mat_handler` / name `material_handler`), so both
  // are matched. A miss returns count 0, not an error (it's a search).
  'cargo-search'(defs, query) {
    const matches = buildMatcher(query);
    const hits = Object.entries(defs.cargo)
      .filter(([id, c]) => matches(id) || matches(c.name || ''))
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => a.id.localeCompare(b.id));
    emit({ query, count: hits.length, matches: hits });
  },

  // DLC registry dump: bare `dlc` emits the whole registry; `dlc <section>`
  // narrows to one keyed section (trailer_dlcs, cargo_dlc_map, garage_cities, …).
  dlc(defs, section) {
    if (!has(defs, 'dlc')) die('no dlc section in this game-defs.json');
    if (!section) {
      emit(defs.dlc);
      return;
    }
    if (!has(defs.dlc, section)) {
      die(`unknown dlc section '${section}' (available: ${Object.keys(defs.dlc).join(', ')})`);
    }
    emit(defs.dlc[section]);
  },
};

function main() {
  const { game, subcommand, arg } = parseArgs(process.argv.slice(2));
  if (!subcommand) die(`missing subcommand\n${usage()}`);
  if (!SUBCOMMANDS.includes(subcommand)) die(`unknown subcommand '${subcommand}'\n${usage()}`);
  if (!arg && !OPTIONAL_ARG.has(subcommand)) die(`'${subcommand}' requires an argument\n${usage()}`);
  COMMANDS[subcommand](loadDefs(game), arg);
}

main();
