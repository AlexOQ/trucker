#!/usr/bin/env node
const fs = require('fs');
const p = require('path');
const game = process.argv[2] || 'ets2';
const root = p.join(__dirname, '..', 'public', 'data', game);
const defs = JSON.parse(fs.readFileSync(p.join(root, 'game-defs.json'), 'utf8'));
const manualPath = p.join(root, 'manual-prices.json');
const manual = fs.existsSync(manualPath)
  ? JSON.parse(fs.readFileSync(manualPath, 'utf8')).prices || {}
  : {};

const trailers = defs.trailers;
const cargo = defs.cargo;
const cargoTrailers = defs.cargo_trailers;
const cargoTrailerUnits = defs.cargo_trailer_units;
const countries = Object.keys(defs.countries);

const trailerCargo = new Map();
for (const [cid, tids] of Object.entries(cargoTrailers)) {
  const c = cargo[cid];
  if (!c || c.excluded) continue;
  for (const tid of tids) {
    if (!trailerCargo.has(tid)) trailerCargo.set(tid, new Set());
    trailerCargo.get(tid).add(cid);
  }
}
const bonus = c => 1 + (c.fragile ? 0.3 : 0) + (c.high_value ? 0.3 : 0);
const totalHV = tid => {
  const cs = trailerCargo.get(tid);
  if (!cs) return 0;
  let h = 0;
  for (const cid of cs) {
    const c = cargo[cid];
    if (!c || c.excluded) continue;
    const u = (cargoTrailerUnits[cid] && cargoTrailerUnits[cid][tid]) || 1;
    h += c.value * bonus(c) * u;
  }
  return h;
};

// winnerByCountryBT[country][bt] = tid
const wins = {}; // tid -> { bt, hv, countries: Set, chain }
for (const country of countries) {
  const best = new Map();
  for (const [tid, t] of Object.entries(trailers)) {
    if (!t.ownable) continue;
    if (t.country_validity && t.country_validity.length > 0
      && !t.country_validity.includes(country)) continue;
    const bt = t.body_type;
    const hv = totalHV(tid);
    const cur = best.get(bt);
    if (!cur || hv > cur.hv) best.set(bt, { tid, hv });
  }
  for (const [bt, { tid, hv }] of best) {
    if (!wins[tid]) wins[tid] = { bt, hv, countries: new Set(), chain: trailers[tid].chain_type };
    wins[tid].countries.add(country);
  }
}

// Group by body_type, then by trailer (sorted by countries desc)
const byBT = {};
for (const [tid, w] of Object.entries(wins)) {
  if (!byBT[w.bt]) byBT[w.bt] = [];
  byBT[w.bt].push({ tid, ...w });
}
const bodyTypes = Object.keys(byBT).sort();

const ALL = countries.length;
function fmtCountries(set) {
  if (set.size === ALL) return `ALL (${ALL})`;
  const list = [...set].sort();
  return `${set.size}: ${list.join(',')}`;
}
function priceStatus(tid) {
  if (manual[tid]) return `walked=${manual[tid].price}`;
  const p = trailers[tid].price || 0;
  if (p > 0) return `parser=${p}`;
  return '— MISSING —';
}

console.log(`# Winning trailers per body_type (${game})`);
console.log(`# 36 countries total; "ALL" = wins in every country it's compatible with.\n`);

// Sort body types by max HV (most lucrative first)
bodyTypes.sort((a, b) => {
  const ah = Math.max(...byBT[a].map(x => x.hv));
  const bh = Math.max(...byBT[b].map(x => x.hv));
  return bh - ah;
});

for (const bt of bodyTypes) {
  const rows = byBT[bt].sort((a, b) => b.countries.size - a.countries.size);
  console.log(`\n## ${bt}`);
  for (const r of rows) {
    console.log(`  ${r.tid}`);
    console.log(`    chain=${r.chain}  hv=${r.hv.toFixed(0)}  ${priceStatus(r.tid)}`);
    console.log(`    countries: ${fmtCountries(r.countries)}`);
  }
}

// Brand summary
console.log(`\n\n# Brand summary (winners only)`);
const brands = {};
for (const [tid] of Object.entries(wins)) {
  const b = tid.split('.')[0];
  brands[b] = brands[b] || { count: 0, walked: 0, parser: 0, missing: 0 };
  brands[b].count++;
  if (manual[tid]) brands[b].walked++;
  else if ((trailers[tid].price || 0) > 0) brands[b].parser++;
  else brands[b].missing++;
}
const sorted = Object.entries(brands).sort((a, b) => b[1].count - a[1].count);
for (const [b, s] of sorted) {
  console.log(`  ${b.padEnd(14)} winners=${String(s.count).padStart(2)}  walked=${s.walked}  parser-priced=${s.parser}  MISSING=${s.missing}`);
}
