/**
 * Trailer Set Optimizer for ETS2 Trucker Advisor
 *
 * Optimizes trailer selection by body type profile:
 * 1. Collapse 500+ trailers to ~16 non-dominated body types
 * 2. For each body type, use max units available (HCT/doubles in applicable countries)
 * 3. Score by EV = spawn_weight × projected_revenue
 * 4. Greedy selection with flat diminishing factor per repeat body type
 *
 * Parameters:
 * - maxTrailers: number of trailer slots in garage (1-20)
 * - diminishingFactor: 0-100 slider controlling duplicate body type penalty
 */

import { getCityCargoPool, getOwnableTrailers, getBodyTypeProfiles } from './data.js';
import type { AllData, Lookups, CargoPoolEntry, Trailer, BodyTypeProfile } from './data.js';

interface BodyTypeStats {
  bodyType: string;
  displayName: string;
  bestTrailerName: string;
  cargoCount: number;
  totalEV: number;
  coverage: number;
  topCargoes: string[];
  hasDoubles: boolean;
  hasHCT: boolean;
}

interface OptimizationOptions {
  maxTrailers?: number;
  diminishingFactor?: number;
}

interface TrailerRecommendation {
  trailerId: string;       // body type ID (e.g., "curtainside")
  trailerName: string;     // display name (e.g., "Curtainside")
  bestTrailerName: string; // actual trailer to buy (e.g., "Wielton Curtainm Single 3 Curtain")
  count: number;
  coveragePct: number;
  avgValue: number;
  score: number;
  topCargoes: string[];
}

interface OptimizationResult {
  cityId: string;
  totalDepots: number;
  totalCargoInstances: number;
  totalValue: number;
  recommendations: TrailerRecommendation[];
  options: Required<OptimizationOptions>;
}

export interface CityRanking {
  id: string;
  name: string;
  country: string;
  depotCount: number;
  jobs: number;
  totalValue: number;
  avgValuePerJob: number;
  score: number;
}

/**
 * Filter trailers to only those valid in a given country.
 * Trailers with no country_validity are valid everywhere.
 */
function getTrailersForCountry(trailers: Trailer[], country: string): Trailer[] {
  if (!country) return trailers;
  return trailers.filter(
    (t) => !t.country_validity || t.country_validity.length === 0 || t.country_validity.includes(country)
  );
}

/**
 * Build cargo set per body type and find dominated (subset) body types.
 * A body type is dominated if another body type can haul all the same cargoes plus more.
 */
function findNonDominatedBodyTypes(
  trailers: Trailer[],
  lookups: Lookups
): Set<string> {
  // Build cargo set per body type
  const bodyCargoSets = new Map<string, Set<string>>();
  for (const trailer of trailers) {
    const cargoes = lookups.trailerCargoMap.get(trailer.id);
    if (!cargoes) continue;
    if (!bodyCargoSets.has(trailer.body_type)) {
      bodyCargoSets.set(trailer.body_type, new Set());
    }
    const bodySet = bodyCargoSets.get(trailer.body_type)!;
    for (const c of cargoes) bodySet.add(c);
  }

  // Find dominated body types
  const bodyTypes = [...bodyCargoSets.keys()];
  const dominated = new Set<string>();
  for (const a of bodyTypes) {
    if (dominated.has(a)) continue;
    const setA = bodyCargoSets.get(a)!;
    for (const b of bodyTypes) {
      if (a === b || dominated.has(b)) continue;
      const setB = bodyCargoSets.get(b)!;
      // a is dominated by b if a ⊂ b (strict subset)
      if (setA.size < setB.size) {
        let isSubset = true;
        for (const c of setA) {
          if (!setB.has(c)) { isSubset = false; break; }
        }
        if (isSubset) dominated.add(a);
      }
    }
  }

  const nonDominated = new Set<string>();
  for (const bt of bodyTypes) {
    if (!dominated.has(bt)) nonDominated.add(bt);
  }
  return nonDominated;
}

/** Trailer size tier multipliers for revenue estimation */
const TIER_MULTIPLIERS = { standard: 1.0, double: 1.5, hct: 2.0 } as const;
type TrailerTier = keyof typeof TIER_MULTIPLIERS;

/**
 * Classify a trailer into standard/double/hct tier based on its ID.
 */
function getTrailerTier(trailerId: string): TrailerTier {
  if (trailerId.includes('hct')) return 'hct';
  if (trailerId.includes('double') || trailerId.includes('bdouble')) return 'double';
  return 'standard';
}

/**
 * Check if any trailers of a body type exist for a given tier.
 */
function bodyTypeHasTier(
  bodyType: string,
  tier: TrailerTier,
  trailers: Trailer[],
  lookups: Lookups
): boolean {
  return trailers.some(
    (t) => t.body_type === bodyType && getTrailerTier(t.id) === tier && lookups.trailerCargoMap.has(t.id)
  );
}

/**
 * Calculate body type statistics for a city.
 * Splits each body type into standard/double/HCT tiers (where available).
 * Each tier is a separate optimizer entry with its own multiplier.
 */
function calculateBodyTypeStats(
  cargoPool: CargoPoolEntry[],
  trailers: Trailer[],
  lookups: Lookups,
  nonDominated: Set<string>,
  profiles: BodyTypeProfile[]
): { stats: BodyTypeStats[]; totalSpawnWeight: number; totalValue: number } {
  // Build profile lookup for best trailer names
  const profileByBodyType = new Map<string, BodyTypeProfile>();
  for (const p of profiles) profileByBodyType.set(p.bodyType, p);
  let totalSpawnWeight = 0;
  let totalValue = 0;
  for (const entry of cargoPool) {
    const w = entry.spawnWeight;
    totalSpawnWeight += entry.depotCount * w;
    totalValue += entry.value * entry.depotCount * w;
  }

  if (totalSpawnWeight === 0) {
    return { stats: [], totalSpawnWeight: 0, totalValue: 0 };
  }

  // Find which (bodyType, tier) combos exist
  const tierCombos: Array<{ bodyType: string; tier: TrailerTier }> = [];
  for (const bt of nonDominated) {
    for (const tier of ['standard', 'double', 'hct'] as TrailerTier[]) {
      if (bodyTypeHasTier(bt, tier, trailers, lookups)) {
        tierCombos.push({ bodyType: bt, tier });
      }
    }
  }

  // Build cargo set and max standard units per (bodyType, cargoId)
  const bodyCargoes = new Map<string, Set<string>>();
  const bodyCargoUnits = new Map<string, Map<string, number>>(); // bodyType -> cargoId -> max units
  for (const trailer of trailers) {
    if (!nonDominated.has(trailer.body_type)) continue;
    const cargoes = lookups.trailerCargoMap.get(trailer.id);
    if (!cargoes) continue;

    const bt = trailer.body_type;
    if (!bodyCargoes.has(bt)) bodyCargoes.set(bt, new Set());
    if (!bodyCargoUnits.has(bt)) bodyCargoUnits.set(bt, new Map());
    const cargoSet = bodyCargoes.get(bt)!;
    const unitsMap = bodyCargoUnits.get(bt)!;

    // Only use standard trailers for base unit count (tier multiplier scales on top)
    if (getTrailerTier(trailer.id) === 'standard') {
      for (const cargoId of cargoes) {
        cargoSet.add(cargoId);
        const units = lookups.cargoTrailerUnits.get(`${cargoId}:${trailer.id}`) ?? 1;
        const cur = unitsMap.get(cargoId) ?? 0;
        if (units > cur) unitsMap.set(cargoId, units);
      }
    } else {
      // Non-standard trailers still contribute to cargo compatibility
      for (const cargoId of cargoes) cargoSet.add(cargoId);
    }
  }

  // Calculate EV per (bodyType, tier)
  const stats: BodyTypeStats[] = [];
  for (const { bodyType, tier } of tierCombos) {
    const cargoSet = bodyCargoes.get(bodyType);
    if (!cargoSet) continue;
    const unitsMap = bodyCargoUnits.get(bodyType) ?? new Map<string, number>();

    const mult = TIER_MULTIPLIERS[tier];
    let totalEV = 0;
    let cargoCount = 0;
    const cargoContributions: Array<{ name: string; ev: number }> = [];

    for (const entry of cargoPool) {
      if (!cargoSet.has(entry.cargoId)) continue;

      const w = entry.spawnWeight;
      const units = unitsMap.get(entry.cargoId) ?? 1;
      const baseContribution = entry.value * units * entry.depotCount * w;
      const contribution = baseContribution * mult;

      totalEV += contribution;
      cargoCount++;
      cargoContributions.push({ name: entry.cargoName, ev: contribution });
    }

    if (cargoCount > 0) {
      const seen = new Set<string>();
      const topCargoes = cargoContributions
        .sort((a, b) => b.ev - a.ev)
        .filter((c) => {
          if (seen.has(c.name)) return false;
          seen.add(c.name);
          return true;
        })
        .slice(0, 5)
        .map((c) => c.name);

      const profileId = tier === 'standard' ? bodyType : `${bodyType}_${tier}`;
      const profile = profileByBodyType.get(bodyType);
      stats.push({
        bodyType: profileId,
        displayName: formatBodyType(bodyType, tier),
        bestTrailerName: profile?.bestTrailerName ?? formatBodyType(bodyType, tier),
        cargoCount,
        totalEV,
        coverage: cargoCount / cargoPool.length,
        topCargoes,
        hasDoubles: tier === 'double',
        hasHCT: tier === 'hct',
      });
    }
  }

  stats.sort((a, b) => b.totalEV - a.totalEV);
  return { stats, totalSpawnWeight, totalValue };
}

function formatBodyType(bt: string, tier: TrailerTier): string {
  const name = bt.charAt(0).toUpperCase() + bt.slice(1).replace(/_/g, ' ');
  if (tier === 'hct') return `${name} (HCT)`;
  if (tier === 'double') return `${name} (Double)`;
  return name;
}

export function optimizeTrailerSet(
  cityId: string,
  data: AllData,
  lookups: Lookups,
  options: OptimizationOptions = {}
): OptimizationResult {
  const {
    maxTrailers = 10,
    diminishingFactor = 75,
  } = options;

  const cargoPool = getCityCargoPool(cityId, data, lookups);
  const city = lookups.citiesById.get(cityId);
  const country = city?.country ?? '';
  const trailers = getTrailersForCountry(getOwnableTrailers(data), country);

  const nonDominated = findNonDominatedBodyTypes(trailers, lookups);
  const profiles = getBodyTypeProfiles(data, lookups);
  const { stats, totalSpawnWeight, totalValue } = calculateBodyTypeStats(
    cargoPool, trailers, lookups, nonDominated, profiles
  );

  if (stats.length === 0) {
    return {
      cityId,
      totalDepots: 0,
      totalCargoInstances: 0,
      totalValue: 0,
      recommendations: [],
      options: { maxTrailers, diminishingFactor },
    };
  }

  const cityCompanies = lookups.cityCompanyMap.get(cityId) || [];
  let totalDepots = 0;
  for (const { count } of cityCompanies) {
    totalDepots += count;
  }

  // Flat diminishing factor per repeat body type
  const dimFactor = diminishingFactor / 100;
  const selected = new Map<string, number>();
  for (let round = 0; round < maxTrailers; round++) {
    let bestBt: string | null = null;
    let bestScore = -1;

    for (const bt of stats) {
      const count = selected.get(bt.bodyType) || 0;
      const effective = bt.totalEV * Math.pow(dimFactor, count);

      if (effective > bestScore) {
        bestScore = effective;
        bestBt = bt.bodyType;
      }
    }

    if (bestBt === null) break;
    selected.set(bestBt, (selected.get(bestBt) || 0) + 1);
  }

  const recommendations: TrailerRecommendation[] = [];
  for (const [bt, count] of Array.from(selected.entries())) {
    const bodyStats = stats.find((s) => s.bodyType === bt)!;
    const maxEV = stats[0].totalEV;
    recommendations.push({
      trailerId: bt,
      trailerName: bodyStats.displayName,
      bestTrailerName: bodyStats.bestTrailerName,
      count,
      coveragePct: Math.round(bodyStats.coverage * 1000) / 10,
      avgValue: Math.round((bodyStats.totalEV / bodyStats.cargoCount) * 100) / 100,
      score: Math.round((bodyStats.totalEV / maxEV) * 1000) / 1000,
      topCargoes: bodyStats.topCargoes,
    });
  }
  recommendations.sort((a, b) => b.count - a.count || b.score - a.score);

  return {
    cityId,
    totalDepots,
    totalCargoInstances: totalSpawnWeight,
    totalValue: Math.round(totalValue * 100) / 100,
    recommendations,
    options: { maxTrailers, diminishingFactor },
  };
}

/**
 * Lightweight city stats for rankings (skips greedy trailer selection)
 */
export function calculateCityStats(
  cityId: string,
  data: AllData,
  lookups: Lookups
): { totalDepots: number; totalCargoInstances: number; totalValue: number } {
  const cargoPool = getCityCargoPool(cityId, data, lookups);

  let totalCargoInstances = 0;
  let totalValue = 0;
  for (const entry of cargoPool) {
    const w = entry.spawnWeight;
    totalCargoInstances += entry.depotCount * w;
    totalValue += entry.value * entry.depotCount * w;
  }

  const cityCompanies = lookups.cityCompanyMap.get(cityId) || [];
  let totalDepots = 0;
  for (const { count } of cityCompanies) {
    totalDepots += count;
  }

  return { totalDepots, totalCargoInstances, totalValue };
}

/**
 * Calculate city rankings based on profitability
 */
export function calculateCityRankings(
  data: AllData,
  lookups: Lookups,
  _options: OptimizationOptions = {}
): CityRanking[] {
  const rankings: CityRanking[] = [];

  for (const city of data.cities) {
    const result = calculateCityStats(city.id, data, lookups);

    if (result.totalCargoInstances === 0) continue;

    const jobs = result.totalCargoInstances;
    const value = result.totalValue;
    const score = Math.sqrt(jobs * value);
    const avgValuePerJob = jobs > 0 ? value / jobs : 0;

    rankings.push({
      id: city.id,
      name: city.name,
      country: city.country,
      depotCount: result.totalDepots,
      jobs,
      totalValue: Math.round(value),
      avgValuePerJob: Math.round(avgValuePerJob * 100) / 100,
      score: Math.round(score * 10) / 10,
    });
  }

  rankings.sort((a, b) => b.score - a.score);
  return rankings;
}

export const defaultOptions = {
  maxTrailers: 10,
  diminishingFactor: 75,
};

export const optionDescriptions = {
  maxTrailers: {
    label: 'Garage Size',
    min: 1,
    max: 20,
    step: 1,
    description: 'Number of trailer slots in garage',
  },
  diminishingFactor: {
    label: 'Diversity Pressure',
    min: 0,
    max: 100,
    step: 1,
    minLabel: 'Allow duplicates',
    maxLabel: 'Force variety',
    description: 'Multiplier applied per duplicate body type (75 = each copy scores 0.75× the previous)',
  },
};
