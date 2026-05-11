#!/usr/bin/env node
/**
 * For each (country-band × body_type), enumerate every trailer tied at max totalHV.
 * Resolution rule: prefer trailers with price > 0; among priced, pick lowest.
 * If all tied trailers have price = 0, the slot needs a walk — pick simplest variant.
 *
 * "Country band" = the set of countries where the same trailer mix is legal,
 * collapsed so we don't print 28 identical Germany-band rows.
 */
const fs = require('fs');
const p = require('path');
const game = process.argv[2] || 'ets2';
const root = p.join(__dirname, '..', 'public', 'data', game);
const defs = JSON.parse(fs.readFileSync(p.join(root, 'game-defs.json'), 'utf8'));
const manualPath = p.join(root, 'manual-prices.json');
const manual = fs.existsSync(manualPath)
  ? JSON.parse(fs.readFileSync(manualPath, 'utf8')).prices || {}
  : {};
const trailers = defs.trailers, cargo = defs.cargo;
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
// Parser-derived prices are unreliable — appear to encode chain_base only,
// not the full configured trailer cost. Treat as untrusted (priceOf returns 0)
// so the roll-up only marks slots as resolved when a real walk is on file.
// See feedback_trucker_parser_prices_unreliable memory.
const priceOf = tid => manual[tid]?.price ?? 0;
const priceSrc = tid => manual[tid]
  ? 'walked'
  : (trailers[tid]?.price > 0 ? 'parser-untrusted' : '—');

// Per (country, bt) → ranked candidates
function candidates(country, bt) {
  const cands = [];
  for (const [tid, t] of Object.entries(trailers)) {
    if (!t.ownable || t.body_type !== bt) continue;
    if (t.country_validity?.length && !t.country_validity.includes(country)) continue;
    cands.push({ tid, hv: totalHV(tid), chain: t.chain_type });
  }
  return cands.sort((a, b) => b.hv - a.hv);
}

// Country bands: group countries that produce identical winner-tied-set per body type
// Keyed by JSON of (bt → tied trailer ids sorted)
const bodyTypes = [...new Set(Object.values(trailers).filter(t => t.ownable).map(t => t.body_type))];
const perCountryFingerprint = {};
for (const country of countries) {
  const fp = {};
  for (const bt of bodyTypes) {
    const cands = candidates(country, bt);
    if (cands.length === 0) continue;
    const top = cands[0].hv;
    if (top === 0) continue;
    const tied = cands.filter(c => c.hv === top).map(c => c.tid).sort();
    fp[bt] = tied.join('|');
  }
  perCountryFingerprint[country] = JSON.stringify(fp);
}

// Group countries by fingerprint
const bandsByFp = {};
for (const [country, fp] of Object.entries(perCountryFingerprint)) {
  (bandsByFp[fp] ||= []).push(country);
}
const bands = Object.entries(bandsByFp).map(([fp, cs], i) => ({
  id: i + 1,
  countries: cs.sort(),
  fp: JSON.parse(fp),
}));

// For each band, for each body type, show the tied set
console.log(`# All winner-tied sets (${game})\n`);
console.log(`Found ${bands.length} distinct country bands.\n`);

const allMustWalk = new Map(); // tid -> { bands, bt, chain, hv }
const allCanResolve = new Map();

for (const band of bands) {
  const sample = band.countries[0];
  console.log(`\n## Band ${band.id}  (${band.countries.length} countries: ${band.countries.join(', ')})`);
  for (const bt of Object.keys(band.fp).sort()) {
    const cands = candidates(sample, bt);
    const top = cands[0].hv;
    const tied = cands.filter(c => c.hv === top);
    const priced = tied.filter(c => priceOf(c.tid) > 0);
    const minPriced = priced.length
      ? priced.reduce((a, b) => priceOf(a.tid) < priceOf(b.tid) ? a : b)
      : null;
    const status = minPriced
      ? `RESOLVED → ${minPriced.tid}  (${priceSrc(minPriced.tid)}=${priceOf(minPriced.tid)})`
      : `NEEDS WALK  (${tied.length} tied, all price=0)`;
    console.log(`\n  ${bt}  hv=${top.toFixed(0)}  [${status}]`);
    for (const c of tied) {
      const pp = priceOf(c.tid);
      const tag = c.tid === minPriced?.tid ? '★' : ' ';
      console.log(`    ${tag} ${c.tid.padEnd(48)}  chain=${c.chain.padEnd(9)}  price=${pp ? pp + ' (' + priceSrc(c.tid) + ')' : '—'}`);
    }
    if (!minPriced) {
      // Track for the must-walk roll-up
      const cheapest = tied.sort((a, b) => a.tid.localeCompare(b.tid))[0];
      const e = allMustWalk.get(cheapest.tid) || { tid: cheapest.tid, bt, chain: cheapest.chain, bands: [], tied: tied.map(t => t.tid) };
      e.bands.push(band.id);
      allMustWalk.set(cheapest.tid, e);
    } else {
      const e = allCanResolve.get(minPriced.tid) || { tid: minPriced.tid, bt, bands: [], price: priceOf(minPriced.tid), src: priceSrc(minPriced.tid) };
      e.bands.push(band.id);
      allCanResolve.set(minPriced.tid, e);
    }
  }
}

console.log(`\n\n# Roll-up: SLOTS RESOLVED BY TIEBREAKER FIX (no walk needed)`);
console.log(`Total: ${allCanResolve.size} unique winners now selectable from existing prices.\n`);
for (const e of [...allCanResolve.values()].sort((a, b) => a.tid.localeCompare(b.tid))) {
  console.log(`  ${e.tid.padEnd(48)}  bt=${e.bt.padEnd(14)}  ${e.src}=${e.price}  bands=${e.bands.join(',')}`);
}

console.log(`\n\n# Roll-up: STILL NEED A WALK`);
console.log(`Total: ${allMustWalk.size} unique trailers (cheapest representative per tied group).\n`);
for (const e of [...allMustWalk.values()].sort((a, b) => a.tid.localeCompare(b.tid))) {
  console.log(`  ${e.tid.padEnd(48)}  bt=${e.bt.padEnd(14)}  chain=${e.chain.padEnd(9)}  bands=${e.bands.join(',')}  tied_with=${e.tied.length}`);
}
