/**
 * Side-by-side comparison of H1, H2, H3 scoring hypotheses.
 * Run: npx tsx scripts/test-scoring2.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const dataDir = resolve(import.meta.dirname, '../public/data');
const gameDefs = JSON.parse(readFileSync(resolve(dataDir, 'game-defs.json'), 'utf-8'));
const observations = JSON.parse(readFileSync(resolve(dataDir, 'observations.json'), 'utf-8'));

// Math
function binomialCoeff(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) result = result * (n - i) / (i + 1);
  return result;
}

function pAtLeast(m: number, n: number, p: number): number {
  let sum = 0;
  for (let k = m; k <= n; k++) {
    sum += binomialCoeff(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
  }
  return sum;
}

function expectedServed(m: number, n: number, p: number): number {
  let ev = 0;
  for (let k = 0; k <= n; k++) {
    const prob = binomialCoeff(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
    ev += Math.min(k, m) * prob;
  }
  return ev;
}

// Zone/country helpers
const CHAIN_TYPE_ZONE: Record<string, string> = {
  single: 'standard', double: 'doubles', b_double: 'doubles', hct: 'hct',
};

function getValidZonesForCountry(country: string): Set<string> {
  const zones = new Set(['standard']);
  if (!country) return zones;
  for (const [, t] of Object.entries(gameDefs.trailers) as [string, any][]) {
    if (!t.ownable) continue;
    if (!t.country_validity || t.country_validity.length === 0) continue;
    if (!t.country_validity.includes(country)) continue;
    const zone = CHAIN_TYPE_ZONE[t.chain_type];
    if (zone) zones.add(zone);
  }
  return zones;
}

// Build city data
interface CityInfo {
  id: string;
  name: string;
  country: string;
  depotCount: number;
  bodyTypes: Array<{ bt: string; probability: number; avgValue: number; pool: number }>;
  totalPool: number;
  rawObservedJobs: number;
  pooledObservedJobs: number;
}

function buildCityData(): CityInfo[] {
  const cities: CityInfo[] = [];
  const cityComps = observations.city_companies || {};

  for (const [cityId, comps] of Object.entries(cityComps) as [string, any][]) {
    const cityDef = gameDefs.cities?.[cityId];
    if (!cityDef) continue;
    const country = cityDef.country || '';
    const validZones = getValidZonesForCountry(country);

    let depotCount = 0;
    for (const d of Object.values(comps) as number[]) depotCount += d;

    const btFreq: Record<string, number> = {};
    const btValueAcc: Record<string, { total: number; count: number }> = {};
    let totalPool = 0;

    for (const [comp, depots] of Object.entries(comps) as [string, number][]) {
      const compJobs = observations.company_job_count?.[comp];
      if (!compJobs) continue;
      const compZoneFreq = observations.company_zone_body_type_frequency?.[comp];
      const compZones: Record<string, Record<string, number>> =
        compZoneFreq && Object.keys(compZoneFreq).length > 0
          ? compZoneFreq
          : { standard: observations.company_body_type_frequency?.[comp] || {} };
      const compAvgValues = observations.company_body_type_avg_value?.[comp] || {};

      for (const [zone, freq] of Object.entries(compZones)) {
        if (!validZones.has(zone)) continue;
        for (const [bt, count] of Object.entries(freq) as [string, number][]) {
          const weighted = count * depots;
          const key = zone === 'standard' ? bt : `${bt}:${zone}`;
          btFreq[key] = (btFreq[key] || 0) + weighted;
          totalPool += weighted;
          const val = compAvgValues[bt] ?? observations.body_type_avg_value?.[bt] ?? 1.0;
          if (!btValueAcc[key]) btValueAcc[key] = { total: 0, count: 0 };
          btValueAcc[key].total += val * weighted;
          btValueAcc[key].count += weighted;
        }
      }
    }

    if (totalPool === 0) continue;

    const bodyTypes = Object.entries(btFreq).map(([bt, count]) => ({
      bt, probability: count / totalPool,
      avgValue: btValueAcc[bt]?.count > 0 ? btValueAcc[bt].total / btValueAcc[bt].count : 1.0,
      pool: count,
    })).sort((a, b) => (b.probability * b.avgValue) - (a.probability * a.avgValue));

    let pooledObs = 0;
    for (const comp of Object.keys(comps)) pooledObs += observations.company_job_count?.[comp] ?? 0;

    cities.push({
      id: cityId, name: cityDef.name || cityId, country, depotCount,
      bodyTypes, totalPool, rawObservedJobs: observations.city_job_count?.[cityId] ?? 0,
      pooledObservedJobs: pooledObs,
    });
  }
  return cities;
}

// Scoring
const DRIVER_COUNT = 5;
const MAX_SLOTS = 10;
const CONFIDENCE_K = 20;

function greedyAlloc(bodyTypes: CityInfo['bodyTypes']): string[] {
  const result: string[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    let bestBT = '';
    let bestMarginal = 0;
    for (const s of bodyTypes) {
      const current = result.filter(b => b === s.bt).length;
      const nextCopy = current + 1;
      if (nextCopy > DRIVER_COUNT) continue;
      const marginal = s.avgValue * pAtLeast(nextCopy, DRIVER_COUNT, s.probability);
      if (marginal > bestMarginal) { bestMarginal = marginal; bestBT = s.bt; }
    }
    if (!bestBT || bestMarginal <= 0) break;
    result.push(bestBT);
  }
  return result;
}

function calcIncome(bodyTypes: CityInfo['bodyTypes'], trailers: string[]): number {
  const copies = new Map<string, number>();
  for (const bt of trailers) copies.set(bt, (copies.get(bt) || 0) + 1);
  let total = 0;
  for (const s of bodyTypes) {
    const m = copies.get(s.bt) || 0;
    if (m === 0) continue;
    total += expectedServed(m, DRIVER_COUNT, s.probability) * s.avgValue;
  }
  return total;
}

// Hypotheses
type HFn = (city: CityInfo, rawIncome: number) => number;

const H1: HFn = (city, rawIncome) => {
  const conf = city.rawObservedJobs / (city.rawObservedJobs + CONFIDENCE_K);
  return rawIncome * conf;
};

const H2: HFn = (city, rawIncome) => {
  const jobSupply = city.depotCount * 2;
  const effDrivers = Math.min(DRIVER_COUNT, jobSupply);
  const trailers = greedyAllocN(city.bodyTypes, effDrivers);
  const scaledIncome = calcIncomeN(city.bodyTypes, trailers, effDrivers);
  const conf = city.pooledObservedJobs / (city.pooledObservedJobs + CONFIDENCE_K);
  return scaledIncome * conf;
};

const H3: HFn = (city, rawIncome) => {
  const pooledConf = city.pooledObservedJobs / (city.pooledObservedJobs + CONFIDENCE_K);
  const depotConf = city.depotCount / (city.depotCount + 5);
  return rawIncome * Math.sqrt(pooledConf * depotConf);
};

// H2 needs variable driver count versions
function greedyAllocN(bodyTypes: CityInfo['bodyTypes'], drivers: number): string[] {
  const result: string[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    let bestBT = '';
    let bestMarginal = 0;
    for (const s of bodyTypes) {
      const current = result.filter(b => b === s.bt).length;
      const nextCopy = current + 1;
      if (nextCopy > drivers) continue;
      const marginal = s.avgValue * pAtLeast(nextCopy, drivers, s.probability);
      if (marginal > bestMarginal) { bestMarginal = marginal; bestBT = s.bt; }
    }
    if (!bestBT || bestMarginal <= 0) break;
    result.push(bestBT);
  }
  return result;
}

function calcIncomeN(bodyTypes: CityInfo['bodyTypes'], trailers: string[], drivers: number): number {
  const copies = new Map<string, number>();
  for (const bt of trailers) copies.set(bt, (copies.get(bt) || 0) + 1);
  let total = 0;
  for (const s of bodyTypes) {
    const m = copies.get(s.bt) || 0;
    if (m === 0) continue;
    total += expectedServed(m, drivers, s.probability) * s.avgValue;
  }
  return total;
}

// Also try H3 with different depot k values
const H3_k3: HFn = (city, rawIncome) => {
  const pooledConf = city.pooledObservedJobs / (city.pooledObservedJobs + CONFIDENCE_K);
  const depotConf = city.depotCount / (city.depotCount + 3);
  return rawIncome * Math.sqrt(pooledConf * depotConf);
};

const H3_k8: HFn = (city, rawIncome) => {
  const pooledConf = city.pooledObservedJobs / (city.pooledObservedJobs + CONFIDENCE_K);
  const depotConf = city.depotCount / (city.depotCount + 8);
  return rawIncome * Math.sqrt(pooledConf * depotConf);
};

// Run
const cities = buildCityData();

// Compute raw income for each city
const cityScores = cities.map(city => {
  const trailers = greedyAlloc(city.bodyTypes);
  const rawIncome = calcIncome(city.bodyTypes, trailers);
  return { city, rawIncome };
});

const hypotheses: Array<{ name: string; fn: HFn }> = [
  { name: 'H1:RawObs', fn: H1 },
  { name: 'H2:DepDrv', fn: H2 },
  { name: 'H3:Blend5', fn: H3 },
  { name: 'H3:Blend3', fn: H3_k3 },
  { name: 'H3:Blend8', fn: H3_k8 },
];

// Build ranked lists per hypothesis
const ranked: Record<string, Array<{ city: CityInfo; score: number; rank: number }>> = {};
for (const h of hypotheses) {
  const list = cityScores.map(({ city, rawIncome }) => ({
    city, score: h.fn(city, rawIncome), rank: 0,
  }));
  list.sort((a, b) => b.score - a.score);
  list.forEach((r, i) => r.rank = i + 1);
  ranked[h.name] = list;
}

// Build lookup: city -> rank per hypothesis
const rankLookup: Record<string, Record<string, { rank: number; score: number }>> = {};
for (const [hName, list] of Object.entries(ranked)) {
  for (const r of list) {
    if (!rankLookup[r.city.id]) rankLookup[r.city.id] = {};
    rankLookup[r.city.id][hName] = { rank: r.rank, score: r.score };
  }
}

// Print side-by-side top 30 for the main 3 hypotheses
console.log(`${'='.repeat(120)}`);
console.log('Side-by-side: Top 30 per hypothesis (H1=raw obs, H2=depot-scaled drivers, H3=blended k=5)');
console.log('='.repeat(120));

const hNames = ['H1:RawObs', 'H2:DepDrv', 'H3:Blend5'];
const header = '  # ' + hNames.map(h => `${h.padEnd(35)}`).join('  ');
console.log(header);
console.log('-'.repeat(120));

for (let i = 0; i < 30; i++) {
  const cols = hNames.map(h => {
    const r = ranked[h][i];
    if (!r) return ''.padEnd(35);
    const dep = `[${r.city.depotCount}d]`;
    return `${r.city.name.slice(0, 16).padEnd(16)} ${dep.padEnd(5)} €${r.score.toFixed(1).padStart(6)}`;
  });
  console.log(`${(i + 1).toString().padStart(3)} ${cols.join('  ')}`);
}

// Rank stability analysis — show cities that move the most between H1 and H3
console.log(`\n${'='.repeat(100)}`);
console.log('Rank movement: H1 (raw obs) → H3 (blended k=5) — biggest movers');
console.log('='.repeat(100));

const movements: Array<{ city: CityInfo; h1Rank: number; h3Rank: number; delta: number }> = [];
for (const city of cities) {
  const h1 = rankLookup[city.id]?.['H1:RawObs'];
  const h3 = rankLookup[city.id]?.['H3:Blend5'];
  if (h1 && h3) {
    movements.push({ city, h1Rank: h1.rank, h3Rank: h3.rank, delta: h1.rank - h3.rank });
  }
}

movements.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

console.log(`${'City'.padEnd(20)} ${'Country'.padEnd(12)} ${'Dep'.padStart(3)} ${'H1'.padStart(4)} → ${'H3'.padStart(4)}  ${'Δ'.padStart(5)}`);
console.log('-'.repeat(60));
for (const m of movements.slice(0, 25)) {
  const arrow = m.delta > 0 ? '↑' : m.delta < 0 ? '↓' : '=';
  console.log(
    `${m.city.name.slice(0, 20).padEnd(20)} ${m.city.country.padEnd(12)} ${m.city.depotCount.toString().padStart(3)} ` +
    `${m.h1Rank.toString().padStart(4)} → ${m.h3Rank.toString().padStart(4)}  ${arrow}${Math.abs(m.delta).toString().padStart(4)}`
  );
}

// H3 k-value sensitivity
console.log(`\n${'='.repeat(100)}`);
console.log('H3 depot-k sensitivity: top 15 at k=3, k=5, k=8');
console.log('='.repeat(100));

const kNames = ['H3:Blend3', 'H3:Blend5', 'H3:Blend8'];
const kHeader = '  # ' + kNames.map(h => `${h.padEnd(35)}`).join('  ');
console.log(kHeader);
console.log('-'.repeat(120));

for (let i = 0; i < 15; i++) {
  const cols = kNames.map(h => {
    const r = ranked[h][i];
    if (!r) return ''.padEnd(35);
    const dep = `[${r.city.depotCount}d]`;
    return `${r.city.name.slice(0, 16).padEnd(16)} ${dep.padEnd(5)} €${r.score.toFixed(1).padStart(6)}`;
  });
  console.log(`${(i + 1).toString().padStart(3)} ${cols.join('  ')}`);
}

// Depot distribution stats per hypothesis
console.log(`\n${'='.repeat(80)}`);
console.log('Depot count distribution in top 20');
console.log('='.repeat(80));

for (const h of ['H1:RawObs', 'H2:DepDrv', 'H3:Blend3', 'H3:Blend5', 'H3:Blend8']) {
  const top20 = ranked[h].slice(0, 20);
  const depots = top20.map(r => r.city.depotCount);
  const buckets = { '1-2': 0, '3-5': 0, '6-8': 0, '9+': 0 };
  for (const d of depots) {
    if (d <= 2) buckets['1-2']++;
    else if (d <= 5) buckets['3-5']++;
    else if (d <= 8) buckets['6-8']++;
    else buckets['9+']++;
  }
  const avg = depots.reduce((a, b) => a + b, 0) / depots.length;
  const med = [...depots].sort((a, b) => a - b)[10];
  console.log(`${h.padEnd(12)} avg=${avg.toFixed(1)} med=${med}  1-2:${buckets['1-2']} 3-5:${buckets['3-5']} 6-8:${buckets['6-8']} 9+:${buckets['9+']}`);
}
