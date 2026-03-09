/**
 * Test different city scoring hypotheses against real data.
 * Run: npx tsx scripts/test-scoring.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load data files
const dataDir = resolve(import.meta.dirname, '../public/data');
const gameDefs = JSON.parse(readFileSync(resolve(dataDir, 'game-defs.json'), 'utf-8'));
const observations = JSON.parse(readFileSync(resolve(dataDir, 'observations.json'), 'utf-8'));

// ============================================
// Inline the math we need from optimizer.ts
// ============================================

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

// ============================================
// Build city data from observations
// ============================================

interface CityInfo {
  id: string;
  name: string;
  country: string;
  depotCount: number;
  companies: Record<string, number>; // company -> depot count
  // Body type stats from company pooling
  bodyTypes: Array<{
    bt: string;
    probability: number;
    avgValue: number;
    pool: number;
  }>;
  totalPool: number;
  rawObservedJobs: number;
  pooledObservedJobs: number;
}

const CHAIN_TYPE_ZONE: Record<string, string> = {
  single: 'standard',
  double: 'doubles',
  b_double: 'doubles',
  hct: 'hct',
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

// Dominated body types (from game-defs profiles)
function findDominated(): Map<string, string> {
  // Build body_type -> cargo set
  const btCargo = new Map<string, Set<string>>();
  for (const [tid, t] of Object.entries(gameDefs.trailers) as [string, any][]) {
    if (!t.ownable) continue;
    const bt = t.body_type;
    if (!btCargo.has(bt)) btCargo.set(bt, new Set());
    const cargo = gameDefs.cargo_trailer_map?.[tid];
    if (cargo) {
      for (const cid of Object.keys(cargo)) btCargo.get(bt)!.add(cid);
    }
  }

  const dominated = new Map<string, string>();
  for (const [a, cargoA] of btCargo) {
    for (const [b, cargoB] of btCargo) {
      if (a === b) continue;
      if (cargoA.size >= cargoB.size) continue;
      // Check if A ⊂ B
      let isSubset = true;
      for (const c of cargoA) {
        if (!cargoB.has(c)) { isSubset = false; break; }
      }
      if (isSubset) {
        // A is dominated by B (or by something with fewer cargo — pick smallest superset)
        if (!dominated.has(a) || cargoB.size < btCargo.get(dominated.get(a)!)!.size) {
          dominated.set(a, b);
        }
      }
    }
  }
  return dominated;
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

    // Pool body type frequencies from companies (standard zone only for simplicity)
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
      bt,
      probability: count / totalPool,
      avgValue: btValueAcc[bt]?.count > 0 ? btValueAcc[bt].total / btValueAcc[bt].count : 1.0,
      pool: count,
    })).sort((a, b) => (b.probability * b.avgValue) - (a.probability * a.avgValue));

    // Pooled observations
    let pooledObs = 0;
    for (const comp of Object.keys(comps)) {
      pooledObs += observations.company_job_count?.[comp] ?? 0;
    }

    cities.push({
      id: cityId,
      name: cityDef.name || cityId,
      country,
      depotCount,
      companies: comps,
      bodyTypes,
      totalPool,
      rawObservedJobs: observations.city_job_count?.[cityId] ?? 0,
      pooledObservedJobs: pooledObs,
    });
  }

  return cities;
}

// ============================================
// Scoring functions
// ============================================

const DRIVER_COUNT = 5;
const MAX_SLOTS = 10;
const CONFIDENCE_K = 20;

function greedyAlloc(bodyTypes: CityInfo['bodyTypes'], totalPool: number, driverCount: number): string[] {
  const result: string[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    let bestBT = '';
    let bestMarginal = 0;

    for (const s of bodyTypes) {
      const current = result.filter(b => b === s.bt).length;
      const nextCopy = current + 1;
      if (nextCopy > driverCount) continue;

      const pGe = pAtLeast(nextCopy, driverCount, s.probability);
      const marginal = s.avgValue * pGe;

      if (marginal > bestMarginal) {
        bestMarginal = marginal;
        bestBT = s.bt;
      }
    }

    if (!bestBT || bestMarginal <= 0) break;
    result.push(bestBT);
  }
  return result;
}

function calcExpectedIncome(bodyTypes: CityInfo['bodyTypes'], trailers: string[], driverCount: number): number {
  const copies = new Map<string, number>();
  for (const bt of trailers) copies.set(bt, (copies.get(bt) || 0) + 1);

  let total = 0;
  for (const s of bodyTypes) {
    const m = copies.get(s.bt) || 0;
    if (m === 0) continue;
    total += expectedServed(m, driverCount, s.probability) * s.avgValue;
  }
  return total;
}

// ============================================
// Hypothesis functions
// ============================================

interface ScoringResult {
  name: string;
  city: CityInfo;
  rawScore: number;
  confidence: number;
  finalScore: number;
}

type Hypothesis = (city: CityInfo, rawIncome: number) => { confidence: number; finalScore: number };

// H0: Current model (pooled confidence, no depot adjustment)
const h0_pooledOnly: Hypothesis = (city, rawIncome) => {
  const n = city.pooledObservedJobs;
  const confidence = n / (n + CONFIDENCE_K);
  return { confidence, finalScore: rawIncome * confidence };
};

// H1: Raw city observations only (the old model before our change)
const h1_rawOnly: Hypothesis = (city, rawIncome) => {
  const n = city.rawObservedJobs;
  const confidence = n / (n + CONFIDENCE_K);
  return { confidence, finalScore: rawIncome * confidence };
};

// H2: Depot-scaled income — model job supply as proportional to depot count
// More depots = more concurrent jobs. Scale effective drivers by min(drivers, depotCount * jobsPerDepot)
const h2_depotScaled: Hypothesis = (city, rawIncome) => {
  const JOBS_PER_DEPOT = 2; // assume ~2 concurrent jobs per depot
  const jobSupply = city.depotCount * JOBS_PER_DEPOT;
  const effectiveDrivers = Math.min(DRIVER_COUNT, jobSupply);

  // Recalculate income with effective drivers
  const trailers = greedyAlloc(city.bodyTypes, city.totalPool, effectiveDrivers);
  const scaledIncome = calcExpectedIncome(city.bodyTypes, trailers, effectiveDrivers);

  const n = city.pooledObservedJobs;
  const confidence = n / (n + CONFIDENCE_K);
  return { confidence, finalScore: scaledIncome * confidence };
};

// H3: Blended confidence — geometric mean of pooled evidence and depot diversity
// High company evidence + low depot count = moderate confidence
const h3_blendedConfidence: Hypothesis = (city, rawIncome) => {
  const pooledConf = city.pooledObservedJobs / (city.pooledObservedJobs + CONFIDENCE_K);
  const depotConf = city.depotCount / (city.depotCount + 5); // k=5 for depots
  const confidence = Math.sqrt(pooledConf * depotConf);
  return { confidence, finalScore: rawIncome * confidence };
};

// H4: Log-depot scaling — income scales with log(depotCount + 1)
// Diminishing returns: going from 1→2 depots is huge, 9→10 is marginal
const h4_logDepot: Hypothesis = (city, rawIncome) => {
  const depotFactor = Math.log(city.depotCount + 1) / Math.log(11); // normalized: 10 depots = 1.0
  const n = city.pooledObservedJobs;
  const confidence = n / (n + CONFIDENCE_K);
  return { confidence, finalScore: rawIncome * depotFactor * confidence };
};

// H5: Sqrt-depot scaling — softer than log, penalizes low depot less aggressively
const h5_sqrtDepot: Hypothesis = (city, rawIncome) => {
  const depotFactor = Math.sqrt(city.depotCount) / Math.sqrt(10); // normalized: 10 depots = 1.0
  const n = city.pooledObservedJobs;
  const confidence = n / (n + CONFIDENCE_K);
  return { confidence, finalScore: rawIncome * depotFactor * confidence };
};

// H6: Driver utilization model — cap drivers by job supply from depots
// Use Poisson-like model: P(idle) increases as drivers/jobs ratio grows
const h6_utilization: Hypothesis = (city, rawIncome) => {
  const JOBS_PER_DEPOT = 3; // slightly higher estimate
  const jobSupply = city.depotCount * JOBS_PER_DEPOT;
  // Utilization = min(1, jobSupply / driverCount) — fraction of drivers that can work
  const utilization = Math.min(1, jobSupply / DRIVER_COUNT);

  const n = city.pooledObservedJobs;
  const confidence = n / (n + CONFIDENCE_K);
  return { confidence, finalScore: rawIncome * utilization * confidence };
};

// ============================================
// Run all hypotheses
// ============================================

const cities = buildCityData();
console.log(`Loaded ${cities.length} cities with observation data\n`);

const hypotheses: Array<{ name: string; fn: Hypothesis; description: string }> = [
  { name: 'H0: Pooled confidence only', fn: h0_pooledOnly, description: 'Current (broken): pooled obs for confidence, no depot factor' },
  { name: 'H1: Raw city obs only', fn: h1_rawOnly, description: 'Previous model: raw per-city job count for confidence' },
  { name: 'H2: Depot-scaled drivers', fn: h2_depotScaled, description: 'Cap effective drivers by depot count × 2 jobs/depot' },
  { name: 'H3: Blended confidence', fn: h3_blendedConfidence, description: 'Geometric mean of pooled evidence + depot diversity (k=5)' },
  { name: 'H4: Log-depot factor', fn: h4_logDepot, description: 'Income × log(depots+1)/log(11), normalized to 10 depots = 1.0' },
  { name: 'H5: Sqrt-depot factor', fn: h5_sqrtDepot, description: 'Income × sqrt(depots)/sqrt(10), normalized to 10 depots = 1.0' },
  { name: 'H6: Utilization cap', fn: h6_utilization, description: 'Income × min(1, depots×3/drivers), pooled confidence' },
];

for (const h of hypotheses) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${h.name}`);
  console.log(`${h.description}`);
  console.log('='.repeat(80));

  const results: ScoringResult[] = [];

  for (const city of cities) {
    const trailers = greedyAlloc(city.bodyTypes, city.totalPool, DRIVER_COUNT);
    const rawIncome = calcExpectedIncome(city.bodyTypes, trailers, DRIVER_COUNT);
    const { confidence, finalScore } = h.fn(city, rawIncome);

    results.push({
      name: h.name,
      city,
      rawScore: rawIncome,
      confidence,
      finalScore,
    });
  }

  results.sort((a, b) => b.finalScore - a.finalScore);

  // Print top 20
  console.log(`\n${'#'.padStart(3)} ${'City'.padEnd(20)} ${'Country'.padEnd(12)} ${'Dep'.padStart(3)} ${'RawObs'.padStart(6)} ${'PoolObs'.padStart(7)} ${'RawInc'.padStart(8)} ${'Conf'.padStart(6)} ${'Score'.padStart(8)}`);
  console.log('-'.repeat(80));

  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i];
    console.log(
      `${(i + 1).toString().padStart(3)} ` +
      `${r.city.name.padEnd(20)} ` +
      `${r.city.country.padEnd(12)} ` +
      `${r.city.depotCount.toString().padStart(3)} ` +
      `${r.city.rawObservedJobs.toString().padStart(6)} ` +
      `${r.city.pooledObservedJobs.toString().padStart(7)} ` +
      `€${r.rawScore.toFixed(1).padStart(7)} ` +
      `${(r.confidence * 100).toFixed(0).padStart(5)}% ` +
      `€${r.finalScore.toFixed(1).padStart(7)}`
    );
  }

  // Sanity checks
  const top5 = results.slice(0, 5);
  const avgDepots = top5.reduce((s, r) => s + r.city.depotCount, 0) / 5;
  const singleDepotInTop10 = results.slice(0, 10).filter(r => r.city.depotCount === 1).length;
  console.log(`\nSanity: Top 5 avg depots: ${avgDepots.toFixed(1)}, 1-depot cities in top 10: ${singleDepotInTop10}`);
}
