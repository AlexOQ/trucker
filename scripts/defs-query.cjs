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
 *   node scripts/defs-query.cjs <subcommand> <id> [--game ets2|ats]
 *
 *   cargo <id>                  cargo record
 *   companies-for-cargo <id>    companies whose cargo_out includes <id>
 *   city <id>                   city record
 *   city-companies <id>         companies present in a city ({companyId:count} map)
 *
 * Output is JSON on stdout. Unknown ids / args exit non-zero with a one-line
 * message on stderr — no stack traces.
 */
const fs = require('fs');
const p = require('path');

const GAMES = ['ets2', 'ats'];
const SUBCOMMANDS = ['cargo', 'companies-for-cargo', 'city', 'city-companies'];

function usage() {
  return [
    'Usage: node scripts/defs-query.cjs <subcommand> <id> [--game ets2|ats]',
    '',
    'Subcommands:',
    '  cargo <id>                cargo record',
    '  companies-for-cargo <id>  companies whose cargo_out includes <id>',
    '  city <id>                 city record',
    '  city-companies <id>       companies present in a city',
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
  return { game, subcommand: positional[0], id: positional[1] };
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
};

function main() {
  const { game, subcommand, id } = parseArgs(process.argv.slice(2));
  if (!subcommand) die(`missing subcommand\n${usage()}`);
  if (!SUBCOMMANDS.includes(subcommand)) die(`unknown subcommand '${subcommand}'\n${usage()}`);
  if (!id) die(`'${subcommand}' requires an <id>\n${usage()}`);
  COMMANDS[subcommand](loadDefs(game), id);
}

main();
