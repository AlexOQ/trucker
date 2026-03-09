/**
 * Trailer Set Optimizer for ETS2 Trucker Advisor
 *
 * Answers: "Where should I buy a garage to maximize income with 5 AI drivers?"
 *
 * Model: Binomial contention
 * - 5 drivers independently roll against the city's job market each cycle
 * - Each driver takes ONE job, consuming a physical trailer
 * - P(job matches body type B) = observed frequency of B in this city
 * - Marginal value of mth copy = avgValue × P(demand ≥ m)
 * - City score = E[income/cycle] with optimal 10-trailer allocation
 *
 * Data sources:
 * - Probabilities: observation data (city_body_type_frequency from parsed saves)
 * - Values: body_type_avg_value from observations (derived from game-defs cargo values)
 * - Fallback: game-defs theoretical cargo pools when no observation data
 */

import { getCityCargoPool, getOwnableTrailers, getBodyTypeProfiles, formatTrailerSpec } from './data.js';
import type { AllData, Lookups, Trailer, BodyTypeProfile } from './data.js';

const DRIVER_COUNT = 5;

/**
 * Bayesian confidence: n / (n + k).
 * Cities with few observed jobs get scores shrunk toward zero.
 * k=20 means a city needs ~20 observed jobs to reach 50% confidence.
 */
const CONFIDENCE_K = 20;
const DEPOT_K = 5;

// ============================================
// Math utilities
// ============================================

function binomialCoeff(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) result = result * (n - i) / (i + 1);
  return result;
}

/** P(X >= m) for X ~ Binomial(n, p) */
function pAtLeast(m: number, n: number, p: number): number {
  let sum = 0;
  for (let k = m; k <= n; k++) {
    sum += binomialCoeff(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
  }
  return sum;
}

/** E[min(X, m)] for X ~ Binomial(n, p) — expected drivers served with m copies */
function expectedServed(m: number, n: number, p: number): number {
  let ev = 0;
  for (let k = 0; k <= n; k++) {
    const prob = binomialCoeff(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
    ev += Math.min(k, m) * prob;
  }
  return ev;
}

// ============================================
// Body type stats for a city
// ============================================

export interface CityBodyTypeStats {
  bodyType: string;       // composite key: 'curtainside' (standard) or 'curtainside:doubles'
  zone: string;           // 'standard', 'doubles', 'hct', 'long_chassis'
  displayName: string;
  bestTrailerName: string;
  probability: number;   // P(random job matches this body type in this zone)
  avgValue: number;       // average cargo value when matched
  pool: number;           // observed job count for this body type + zone
  totalPool: number;      // total observed jobs in city
  cargoCount: number;     // distinct cargo types covered
  hasDoubles: boolean;
  hasHCT: boolean;
  dominatedBy: string | null; // body type whose cargo is a strict superset
}

/**
 * Build per-body-type stats for a city using observation data.
 * Falls back to game-defs theoretical cargo pools when no observations exist.
 */
export function getCityBodyTypeStats(
  cityId: string,
  data: AllData,
  lookups: Lookups
): CityBodyTypeStats[] {
  const obs = data.observations;

  let stats: CityBodyTypeStats[];
  // Use observation data when available — prefer company-level pooling,
  // fall back to per-city observations, then game-defs theoretical pools
  const hasCompanyObs = obs?.city_companies?.[cityId]
    && obs?.company_body_type_frequency
    && obs?.company_job_count;
  const hasCityObs = obs?.city_body_type_frequency?.[cityId]
    && obs?.body_type_avg_value;
  if (hasCompanyObs || hasCityObs) {
    stats = getStatsFromObservations(cityId, data, lookups);
  } else {
    // Fallback: game-defs theoretical pools
    stats = getStatsFromGameDefs(cityId, data, lookups);
  }

  // Pad with zero-pool entries for body types available in city's country but not observed.
  // Only pad when the city has some real data (otherwise it's truly empty).
  if (stats.some((s) => s.pool > 0)) {
    const city = lookups.citiesById.get(cityId);
    const country = city?.country ?? '';
    const profiles = getBodyTypeProfiles(data, lookups);
    const seen = new Set(stats.map((s) => s.bodyType));
    const totalPool = stats[0]?.totalPool ?? 0;

    for (const profile of profiles) {
      if (seen.has(profile.bodyType)) continue;
      // Check if this body type has trailers valid in this country
      const hasTrailer = data.trailers.some(
        (t) => t.ownable && t.body_type === profile.bodyType
          && (!t.country_validity || t.country_validity.length === 0 || t.country_validity.includes(country))
      );
      if (!hasTrailer) continue;

      stats.push({
        bodyType: profile.bodyType,
        zone: 'standard',
        displayName: profile.displayName,
        bestTrailerName: profile.bestTrailerName,
        probability: 0,
        avgValue: obs?.body_type_avg_value?.[profile.bodyType] ?? 0,
        pool: 0,
        totalPool,
        cargoCount: profile.cargoCount,
        hasDoubles: profile.hasDoubles,
        hasHCT: profile.hasHCT,
        dominatedBy: profile.dominatedBy,
      });
    }
  }

  return stats;
}

function getZoneBestTrailerName(
  bodyType: string,
  zone: string,
  data: AllData,
): string | null {
  // Map zone name back to chain_types
  const zoneChainTypes: string[] =
    zone === 'doubles' ? ['double', 'b_double']
    : zone === 'hct' ? ['hct']
    : [];
  if (zoneChainTypes.length === 0) return null;

  // For flatbed, also include container body_type trailers (flatbed w/ container pins)
  const matchBodyType = bodyType === 'flatbed'
    ? (bt: string) => bt === 'flatbed' || bt === 'container'
    : (bt: string) => bt === bodyType;
  const candidates = data.trailers.filter(
    (t) => t.ownable && matchBodyType(t.body_type) && zoneChainTypes.includes(t.chain_type)
  );
  if (candidates.length === 0) return null;

  // Prefer SCS (base game) over DLC brands
  const scs = candidates.filter((t) => t.id.startsWith('scs.'));
  const pool = scs.length > 0 ? scs : candidates;

  pool.sort((a, b) =>
    b.gross_weight_limit - a.gross_weight_limit
    || b.volume - a.volume
    || b.length - a.length
  );
  return formatTrailerSpec(pool[0]);
}

/**
 * Fold dominated body types into their dominators.
 * A dominated body type's cargo is a strict subset of its dominator,
 * so the dominator's trailer can serve all dominated jobs.
 * Also folds container into flatbed (flatbed w/ container pins covers both pools).
 */
function mergeDominatedBodyTypes(
  btFreq: Record<string, number>,
  avgValues: Record<string, number>,
  profiles: BodyTypeProfile[]
): { freq: Record<string, number>; avg: Record<string, number> } {
  const freq = { ...btFreq };
  const avg = { ...avgValues };

  // Container → flatbed (physical merge: flatbed chassis with container pins)
  if (freq['container'] && freq['container'] > 0) {
    const cCount = freq['container'];
    const fCount = freq['flatbed'] ?? 0;
    const cVal = avg['container'] ?? 1.0;
    const fVal = avg['flatbed'] ?? cVal;
    const total = fCount + cCount;
    avg['flatbed'] = (fVal * fCount + cVal * cCount) / total;
    freq['flatbed'] = total;
    delete freq['container'];
    delete avg['container'];
  }

  // Dominated body types → their dominator (e.g. dryvan → curtainside)
  for (const profile of profiles) {
    if (!profile.dominatedBy) continue;
    const src = profile.bodyType;
    const dst = profile.dominatedBy;
    const srcCount = freq[src] ?? 0;
    if (srcCount === 0) continue;
    const dstCount = freq[dst] ?? 0;
    const srcVal = avg[src] ?? 1.0;
    const dstVal = avg[dst] ?? srcVal;
    const total = dstCount + srcCount;
    avg[dst] = (dstVal * dstCount + srcVal * srcCount) / total;
    freq[dst] = total;
    delete freq[src];
    delete avg[src];
  }

  return { freq, avg };
}

/**
 * Synthesize a city's body type distribution from its companies' global observations.
 *
 * A city's job pool is determined by its depots. If Istanbul has ns_oil (1 depot)
 * and fle (1 depot), the probability of seeing body type B equals:
 *   Σ(company c in city) depotCount(c) × companyRate(c, B) / Σ depotCount(c) × companyTotalRate(c)
 *
 * This pools all observations of each company across ALL cities, giving much larger
 * sample sizes than the ~49 jobs observed in Istanbul alone.
 *
 * Falls back to raw per-city observations when company-level data is unavailable.
 */
function getStatsFromObservations(
  cityId: string,
  data: AllData,
  lookups: Lookups
): CityBodyTypeStats[] {
  const obs = data.observations!;

  const profiles = getBodyTypeProfiles(data, lookups);
  const profileByBT = new Map<string, BodyTypeProfile>();
  for (const p of profiles) profileByBT.set(p.bodyType, p);

  // Filter zones by city's country — doubles/HCT only available in certain countries
  const city = lookups.citiesById.get(cityId);
  const country = city?.country ?? '';
  const validZones = getValidZonesForCountry(country, data);

  // Synthesize city stats from company-level observations when available
  const cityComps = obs.city_companies?.[cityId];
  const hasCompanyData = cityComps
    && obs.company_body_type_frequency
    && obs.company_job_count;

  let zones: Record<string, Record<string, number>>;
  let avgValueSource: Record<string, Record<string, number>>;
  let totalPool: number;

  if (hasCompanyData) {
    // Build city pool from companies: weight each company's body type distribution
    // by its depot count in this city. Only include zones valid for this country.
    const zoneBTFreq: Record<string, Record<string, number>> = {};
    const zoneBTValueAcc: Record<string, Record<string, { total: number; count: number }>> = {};
    totalPool = 0;

    for (const [comp, depots] of Object.entries(cityComps!)) {
      const compJobs = obs.company_job_count![comp];
      if (!compJobs) continue;

      // Prefer zone-level; fall back to flat frequency
      const compZoneFreq = obs.company_zone_body_type_frequency?.[comp];
      const compZones: Record<string, Record<string, number>> =
        compZoneFreq && Object.keys(compZoneFreq).length > 0
          ? compZoneFreq
          : { standard: obs.company_body_type_frequency![comp] || {} };
      const compAvgValues = obs.company_body_type_avg_value?.[comp] || {};

      for (const [zone, btFreq] of Object.entries(compZones)) {
        // Skip zones not available in this city's country
        if (!validZones.has(zone)) continue;

        if (!zoneBTFreq[zone]) zoneBTFreq[zone] = {};
        if (!zoneBTValueAcc[zone]) zoneBTValueAcc[zone] = {};

        for (const [bt, count] of Object.entries(btFreq)) {
          // Weight by depot count: company with 2 depots contributes 2× the jobs
          const weighted = count * depots;
          zoneBTFreq[zone][bt] = (zoneBTFreq[zone][bt] || 0) + weighted;
          totalPool += weighted;

          // Weighted value accumulation for per-company avg values
          const val = compAvgValues[bt] ?? obs.body_type_avg_value?.[bt] ?? 1.0;
          if (!zoneBTValueAcc[zone][bt]) zoneBTValueAcc[zone][bt] = { total: 0, count: 0 };
          zoneBTValueAcc[zone][bt].total += val * weighted;
          zoneBTValueAcc[zone][bt].count += weighted;
        }
      }
    }

    zones = zoneBTFreq;
    // Convert value accumulators to averages
    avgValueSource = {};
    for (const [zone, bts] of Object.entries(zoneBTValueAcc)) {
      avgValueSource[zone] = {};
      for (const [bt, acc] of Object.entries(bts)) {
        avgValueSource[zone][bt] = acc.count > 0 ? acc.total / acc.count : 1.0;
      }
    }
  } else {
    // Fallback: raw per-city observations — also filter by valid zones
    totalPool = 0;

    const zoneFreq = obs.city_zone_body_type_frequency?.[cityId];
    const rawZones = zoneFreq && Object.keys(zoneFreq).length > 0
      ? zoneFreq
      : { standard: obs.city_body_type_frequency[cityId] || {} };
    zones = {};
    avgValueSource = {};
    for (const [zone, btFreq] of Object.entries(rawZones)) {
      if (!validZones.has(zone)) continue;
      zones[zone] = btFreq;
      avgValueSource[zone] = obs.zone_body_type_avg_value?.[zone] || {};
      for (const count of Object.values(btFreq)) totalPool += count;
    }
  }

  if (totalPool === 0) return [];

  const stats: CityBodyTypeStats[] = [];

  for (const [zone, rawBtFreq] of Object.entries(zones)) {
    const rawAvgValues = avgValueSource[zone] || {};
    const isStandard = zone === 'standard';

    // Fold dominated body types into their dominators (dryvan→curtainside, container→flatbed)
    const { freq: btFreq, avg: zoneAvgValues } = mergeDominatedBodyTypes(rawBtFreq, rawAvgValues, profiles);

    for (const [bt, count] of Object.entries(btFreq)) {
      const profile = profileByBT.get(bt);
      if (!profile) continue;
      const avgValue = zoneAvgValues[bt] ?? obs.body_type_avg_value?.[bt] ?? 1.0;

      const compositeKey = isStandard ? bt : `${bt}:${zone}`;
      const zoneSuffix = isStandard ? '' : ` (${zone.charAt(0).toUpperCase() + zone.slice(1)})`;
      const displayName = profile.displayName + zoneSuffix;

      let bestTrailerName = profile.bestTrailerName;
      if (!isStandard) {
        bestTrailerName = getZoneBestTrailerName(bt, zone, data) ?? bestTrailerName;
      }

      stats.push({
        bodyType: compositeKey,
        zone,
        displayName,
        bestTrailerName,
        probability: count / totalPool,
        avgValue,
        pool: Math.round(count),
        totalPool: Math.round(totalPool),
        cargoCount: profile.cargoCount,
        hasDoubles: profile.hasDoubles,
        hasHCT: profile.hasHCT,
        dominatedBy: profile.dominatedBy,
      });
    }
  }

  stats.sort((a, b) => (b.probability * b.avgValue) - (a.probability * a.avgValue));
  return stats;
}

/** Fallback: build stats from game-defs theoretical cargo pools */
function getStatsFromGameDefs(
  cityId: string,
  data: AllData,
  lookups: Lookups
): CityBodyTypeStats[] {
  const cargoPool = getCityCargoPool(cityId, data, lookups);
  const city = lookups.citiesById.get(cityId);
  const country = city?.country ?? '';
  const trailers = getTrailersForCountry(getOwnableTrailers(data), country);
  const profiles = getBodyTypeProfiles(data, lookups);

  // Build remap: dominated body types fold into their dominator, container folds into flatbed
  const btRemap = new Map<string, string>();
  btRemap.set('container', 'flatbed');
  for (const p of profiles) {
    if (p.dominatedBy) btRemap.set(p.bodyType, p.dominatedBy);
  }

  const bodyCargoSets = new Map<string, Set<string>>();
  for (const trailer of trailers) {
    const cargoes = lookups.trailerCargoMap.get(trailer.id);
    if (!cargoes) continue;
    const bt = btRemap.get(trailer.body_type) ?? trailer.body_type;
    if (!bodyCargoSets.has(bt)) bodyCargoSets.set(bt, new Set());
    const set = bodyCargoSets.get(bt)!;
    for (const c of cargoes) set.add(c);
  }

  const profileByBT = new Map<string, BodyTypeProfile>();
  for (const p of profiles) profileByBT.set(p.bodyType, p);

  let totalPool = 0;
  for (const entry of cargoPool) {
    totalPool += entry.depotCount * entry.spawnWeight;
  }
  if (totalPool === 0) return [];

  const stats: CityBodyTypeStats[] = [];

  for (const [bt, cargoSet] of bodyCargoSets) {
    let btPool = 0;
    let btEV = 0;
    let cargoCount = 0;

    for (const entry of cargoPool) {
      if (!cargoSet.has(entry.cargoId)) continue;
      const w = entry.spawnWeight;
      btPool += entry.depotCount * w;
      btEV += entry.value * entry.depotCount * w;
      cargoCount++;
    }

    if (btPool <= 0) continue;

    const profile = profileByBT.get(bt);
    const displayName = bt.charAt(0).toUpperCase() + bt.slice(1).replace(/_/g, ' ');

    stats.push({
      bodyType: bt,
      zone: 'standard',
      displayName: profile?.displayName ?? displayName,
      bestTrailerName: profile?.bestTrailerName ?? displayName,
      probability: btPool / totalPool,
      avgValue: btEV / btPool,
      pool: btPool,
      totalPool,
      cargoCount,
      hasDoubles: profile?.hasDoubles ?? false,
      hasHCT: profile?.hasHCT ?? false,
      dominatedBy: profile?.dominatedBy ?? null,
    });
  }

  stats.sort((a, b) => (b.probability * b.avgValue) - (a.probability * a.avgValue));
  return stats;
}

/** chain_type → zone name. Matches CHAIN_TYPE_ZONE in parse-saves.cjs. */
const CHAIN_TYPE_ZONE: Record<string, string> = {
  single: 'standard',
  double: 'doubles',
  b_double: 'doubles',
  hct: 'hct',
};

/** Which zone tiers are available in this country? Derived from trailer chain_type + country_validity. */
function getValidZonesForCountry(country: string, data: AllData): Set<string> {
  const zones = new Set(['standard']);
  if (!country) return zones;
  for (const t of data.trailers) {
    if (!t.ownable) continue;
    if (!t.country_validity || t.country_validity.length === 0) continue;
    if (!t.country_validity.includes(country)) continue;
    const zone = CHAIN_TYPE_ZONE[t.chain_type];
    if (zone) zones.add(zone);
  }
  return zones;
}

function getTrailersForCountry(trailers: Trailer[], country: string): Trailer[] {
  if (!country) return trailers;
  return trailers.filter(
    (t) => !t.country_validity || t.country_validity.length === 0 || t.country_validity.includes(country)
  );
}

// ============================================
// Marginal value calculations
// ============================================

export interface MarginalOption {
  bodyType: string;
  displayName: string;
  bestTrailerName: string;
  currentCopies: number;
  marginalValue: number;
  probability: number;
  avgValue: number;
  pAtLeast: number;
}

/**
 * Calculate marginal value of adding one more copy of each body type.
 * marginal = avgValue × P(demand >= m+1 | nDrivers, p)
 */
export function getMarginalOptions(
  stats: CityBodyTypeStats[],
  currentTrailers: string[],
  driverCount: number
): MarginalOption[] {
  const copies = new Map<string, number>();
  for (const bt of currentTrailers) {
    copies.set(bt, (copies.get(bt) || 0) + 1);
  }

  const options: MarginalOption[] = [];

  for (const s of stats) {
    const current = copies.get(s.bodyType) || 0;
    const nextCopy = current + 1;
    if (nextCopy > driverCount) continue;

    const pGe = pAtLeast(nextCopy, driverCount, s.probability);
    const marginal = s.avgValue * pGe;

    options.push({
      bodyType: s.bodyType,
      displayName: s.displayName,
      bestTrailerName: s.bestTrailerName,
      currentCopies: current,
      marginalValue: marginal,
      probability: s.probability,
      avgValue: s.avgValue,
      pAtLeast: pGe,
    });
  }

  options.sort((a, b) => b.marginalValue - a.marginalValue);
  return options;
}

// ============================================
// Expected income calculation
// ============================================

/**
 * E[income/cycle] = Σ over body types: E[min(demand, copies)] × avgValue
 */
export function expectedIncome(
  stats: CityBodyTypeStats[],
  trailers: string[],
  driverCount: number
): { totalIncome: number; totalServed: number; details: Array<{ bodyType: string; copies: number; served: number; income: number }> } {
  const copies = new Map<string, number>();
  for (const bt of trailers) {
    copies.set(bt, (copies.get(bt) || 0) + 1);
  }

  let totalIncome = 0;
  let totalServed = 0;
  const details: Array<{ bodyType: string; copies: number; served: number; income: number }> = [];

  for (const s of stats) {
    const m = copies.get(s.bodyType) || 0;
    if (m === 0) continue;

    const served = expectedServed(m, driverCount, s.probability);
    const income = served * s.avgValue;
    totalServed += served;
    totalIncome += income;

    details.push({
      bodyType: s.bodyType,
      copies: m,
      served: Math.round(served * 1000) / 1000,
      income: Math.round(income * 100) / 100,
    });
  }

  return {
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalServed: Math.round(totalServed * 1000) / 1000,
    details,
  };
}

// ============================================
// Greedy auto-fill
// ============================================

/**
 * Greedy allocation: fill N trailer slots by picking highest marginal value each round.
 * Dominated body types are excluded — their superset covers more cargo.
 */
export function greedyAllocation(
  stats: CityBodyTypeStats[],
  maxSlots: number,
  driverCount: number,
  existingTrailers: string[] = []
): string[] {
  const nonDominated = stats.filter((s) => !s.dominatedBy);
  const result = [...existingTrailers];

  for (let slot = result.length; slot < maxSlots; slot++) {
    const options = getMarginalOptions(nonDominated, result, driverCount);
    if (options.length === 0 || options[0].marginalValue <= 0) break;
    result.push(options[0].bodyType);
  }

  return result;
}

// ============================================
// City rankings
// ============================================

export interface CityRanking {
  id: string;
  name: string;
  country: string;
  depotCount: number;
  observedJobs: number;
  confidence: number;      // n / (n + k), Bayesian shrinkage factor
  rawScore: number;        // E[income/cycle] before confidence adjustment
  score: number;           // rawScore × confidence — ranking metric
  optimalTrailers: string[];
}

/**
 * Effective observation count for a city.
 * When company-level data exists, sums each company's global job count
 * (a city is just a set of its depots — knowing the company = knowing the city).
 * Falls back to raw per-city observation count.
 */
export function getEffectiveObservations(cityId: string, data: AllData): number {
  const obs = data.observations;
  if (!obs) return 0;

  const cityComps = obs.city_companies?.[cityId];
  if (cityComps && obs.company_job_count) {
    let total = 0;
    for (const comp of Object.keys(cityComps)) {
      total += obs.company_job_count[comp] ?? 0;
    }
    return total;
  }

  return obs.city_job_count?.[cityId] ?? 0;
}

/**
 * Blended confidence: geometric mean of evidence confidence and depot diversity.
 * - Evidence: how well we know the companies (pooled observations)
 * - Depot diversity: how many depots feed the city's job market
 * A 2-depot city with well-known companies can be top-10 but needs ~5 depots to compete for #1.
 */
export function getCityConfidence(cityId: string, depotCount: number, data: AllData): number {
  const pooledObs = getEffectiveObservations(cityId, data);
  const evidenceConf = pooledObs / (pooledObs + CONFIDENCE_K);
  const depotConf = depotCount / (depotCount + DEPOT_K);
  return Math.sqrt(evidenceConf * depotConf);
}

/**
 * Rank all cities by E[income/cycle] with optimal 10-trailer allocation and 5 drivers.
 */
export function calculateCityRankings(
  data: AllData,
  lookups: Lookups
): CityRanking[] {
  const rankings: CityRanking[] = [];

  for (const city of data.cities) {
    const stats = getCityBodyTypeStats(city.id, data, lookups);
    if (stats.length === 0 || !stats.some((s) => s.pool > 0)) continue;

    const optimal = greedyAllocation(stats, 10, DRIVER_COUNT);
    const income = expectedIncome(stats, optimal, DRIVER_COUNT);

    const cityCompanies = lookups.cityCompanyMap.get(city.id) || [];
    let depotCount = 0;
    for (const { count } of cityCompanies) depotCount += count;

    const observedJobs = getEffectiveObservations(city.id, data);
    const confidence = getCityConfidence(city.id, depotCount, data);

    rankings.push({
      id: city.id,
      name: city.name,
      country: city.country,
      depotCount,
      observedJobs,
      confidence,
      rawScore: income.totalIncome,
      score: income.totalIncome * confidence,
      optimalTrailers: optimal,
    });
  }

  rankings.sort((a, b) => b.score - a.score);
  return rankings;
}
