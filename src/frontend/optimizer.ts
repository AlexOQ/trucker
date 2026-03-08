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
  // Use observation data when available
  if (obs?.city_body_type_frequency?.[cityId] && obs?.body_type_avg_value) {
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
  const zonePattern = zone === 'doubles' ? /double|bdouble/
    : zone === 'hct' ? /hct/
    : zone === 'long_chassis' ? /long/
    : null;
  if (!zonePattern) return null;

  const candidates = data.trailers.filter(
    (t) => t.ownable && t.body_type === bodyType && zonePattern.test(t.id)
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

function getStatsFromObservations(
  cityId: string,
  data: AllData,
  lookups: Lookups
): CityBodyTypeStats[] {
  const obs = data.observations!;
  const totalJobs = obs.city_job_count[cityId] || 0;
  if (totalJobs === 0) return [];

  // Prefer zone-level frequency; fall back to flat frequency wrapped in 'standard'
  const zoneFreq = obs.city_zone_body_type_frequency?.[cityId];
  const zones: Record<string, Record<string, number>> =
    zoneFreq && Object.keys(zoneFreq).length > 0
      ? zoneFreq
      : { standard: obs.city_body_type_frequency[cityId] || {} };

  const profiles = getBodyTypeProfiles(data, lookups);
  const profileByBT = new Map<string, BodyTypeProfile>();
  for (const p of profiles) profileByBT.set(p.bodyType, p);

  const stats: CityBodyTypeStats[] = [];

  for (const [zone, btFreq] of Object.entries(zones)) {
    const zoneAvgValues = obs.zone_body_type_avg_value?.[zone] || {};
    const isStandard = zone === 'standard';

    for (const [bt, count] of Object.entries(btFreq)) {
      const avgValue = zoneAvgValues[bt] ?? obs.body_type_avg_value?.[bt] ?? 1.0;
      const profile = profileByBT.get(bt);
      const baseName = bt.charAt(0).toUpperCase() + bt.slice(1).replace(/_/g, ' ');

      const compositeKey = isStandard ? bt : `${bt}:${zone}`;
      const zoneSuffix = isStandard ? '' : ` (${zone.charAt(0).toUpperCase() + zone.slice(1)})`;
      const displayName = (profile?.displayName ?? baseName) + zoneSuffix;

      let bestTrailerName = profile?.bestTrailerName ?? baseName;
      if (!isStandard) {
        bestTrailerName = getZoneBestTrailerName(bt, zone, data) ?? bestTrailerName;
      }

      stats.push({
        bodyType: compositeKey,
        zone,
        displayName,
        bestTrailerName,
        probability: count / totalJobs,
        avgValue,
        pool: count,
        totalPool: totalJobs,
        cargoCount: profile?.cargoCount ?? 0,
        hasDoubles: profile?.hasDoubles ?? false,
        hasHCT: profile?.hasHCT ?? false,
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

  const bodyCargoSets = new Map<string, Set<string>>();
  for (const trailer of trailers) {
    const cargoes = lookups.trailerCargoMap.get(trailer.id);
    if (!cargoes) continue;
    const bt = trailer.body_type;
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
    });
  }

  stats.sort((a, b) => (b.probability * b.avgValue) - (a.probability * a.avgValue));
  return stats;
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
 */
export function greedyAllocation(
  stats: CityBodyTypeStats[],
  maxSlots: number,
  driverCount: number,
  existingTrailers: string[] = []
): string[] {
  const result = [...existingTrailers];

  for (let slot = result.length; slot < maxSlots; slot++) {
    const options = getMarginalOptions(stats, result, driverCount);
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

    const observedJobs = data.observations?.city_job_count?.[city.id] ?? 0;
    const confidence = observedJobs / (observedJobs + CONFIDENCE_K);

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
