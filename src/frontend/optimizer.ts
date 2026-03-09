/**
 * Trailer Set Optimizer for ETS2 Trucker Advisor
 *
 * Model: Profile-based proportional allocation
 * - Each city has a cargo profile (sum of depot profiles weighted by depot count)
 * - Each unique trailer type is scored against the city's cargo
 * - Garage slots allocated proportional to each trailer type's earning potential
 * - No diminishing returns — heavy machinery cities get heavy machinery trailers
 *
 * Data source: game-defs.json (authoritative cargo values, spawn coefficients, trailer specs)
 */

import {
  buildCityCargoProfile, buildTrailerProfiles, deduplicateTrailerProfiles,
  scoreTrailerInCity, formatTrailerSpec,
} from './data.js';
import type { AllData, Lookups, UniqueTrailerType, CityCargoProfile, TrailerCityScore } from './data.js';

/** Average jobs spawned per depot instance */
const JOBS_PER_DEPOT = 4;

// ============================================
// Interfaces
// ============================================

export interface FleetEntry {
  trailerId: string;
  bodyType: string;
  chainType: string;
  countryValidity: string[];
  displayName: string;
  trailerSpec: string;
  cityValue: number;
  pctOfTotal: number;
  cargoMatched: number;
  variants: number;
}

export interface MarginalFleetEntry extends FleetEntry {
  owned: number;
  marginalEV: number;
}

export interface OptimalFleetEntry {
  displayName: string;
  bodyType: string;
  trailerId: string;
  trailerSpec: string;
  role: 'driver' | 'spare';
  ev: number;              // driver EV or spare incremental EV
  cargoMatched: number;
  count: number;           // 1-5 for drivers (collapsed), always 1 for spares
}

export interface OptimalFleet {
  drivers: OptimalFleetEntry[];
  spares: OptimalFleetEntry[];
  totalTrailers: number;
}

export interface CityRanking {
  id: string;
  name: string;
  country: string;
  depotCount: number;
  cargoTypes: number;
  score: number;
  topTrailers: FleetEntry[];
}

// ============================================
// Trailer type cache (city-independent)
// ============================================

let cachedUniqueTypes: UniqueTrailerType[] | null = null;

export function getUniqueTypes(data: AllData, lookups: Lookups): UniqueTrailerType[] {
  if (!cachedUniqueTypes) {
    cachedUniqueTypes = deduplicateTrailerProfiles(buildTrailerProfiles(data, lookups));
  }
  return cachedUniqueTypes;
}

// ============================================
// Display helpers
// ============================================

export function zoneLabel(chainType: string, countryValidity: string[]): string {
  if (chainType === 'hct') return 'HCT';
  if (chainType === 'double' || chainType === 'b_double') return 'Doubles';
  if (countryValidity.length > 0) return 'Regional';
  return '';
}

function bodyTypeDisplayName(bodyType: string, chainType: string, countryValidity: string[]): string {
  const base = bodyType.charAt(0).toUpperCase() + bodyType.slice(1).replace(/_/g, ' ');
  const zone = zoneLabel(chainType, countryValidity);
  return zone ? `${base} (${zone})` : base;
}

// ============================================
// Fleet scoring
// ============================================

/**
 * Score unique trailer types against a city profile.
 * Returns all types with cityValue > 0, sorted by EV descending.
 */
function scoreFleet(
  uniqueTypes: UniqueTrailerType[],
  cityProfile: CityCargoProfile,
  lookups: Lookups,
): FleetEntry[] {
  const scored: Array<{ type: UniqueTrailerType; score: TrailerCityScore }> = [];
  for (const ut of uniqueTypes) {
    const score = scoreTrailerInCity(ut.representative, cityProfile);
    if (score && score.cityValue > 0) {
      scored.push({ type: ut, score });
    }
  }
  scored.sort((a, b) => b.score.cityValue - a.score.cityValue);

  const totalCityValue = scored.reduce((s, e) => s + e.score.cityValue, 0);

  return scored.map(({ type, score }) => {
    const trailer = lookups.trailersById.get(type.representative.trailerId);
    const rep = type.representative;
    return {
      trailerId: rep.trailerId,
      bodyType: rep.bodyType,
      chainType: rep.chainType,
      countryValidity: rep.countryValidity,
      displayName: bodyTypeDisplayName(rep.bodyType, rep.chainType, rep.countryValidity),
      trailerSpec: trailer ? formatTrailerSpec(trailer) : rep.trailerId,
      cityValue: score.cityValue,
      pctOfTotal: totalCityValue > 0 ? score.cityValue / totalCityValue * 100 : 0,
      cargoMatched: score.cargoMatched,
      variants: type.variants.length,
    };
  });
}

/**
 * Get fleet data for a city.
 * Returns all scoring trailer types sorted by cityValue descending.
 */
export function getFleetRecommendation(
  cityId: string, data: AllData, lookups: Lookups,
): FleetEntry[] | null {
  const cityProfile = buildCityCargoProfile(cityId, data, lookups);
  if (!cityProfile) return null;
  return scoreFleet(getUniqueTypes(data, lookups), cityProfile, lookups);
}

// ============================================
// City rankings
// ============================================

/** Number of top trailers to show in rankings summary */
const TOP_TRAILERS = 5;

/** Drivers dispatched simultaneously for ranking score */
const RANKING_DRIVERS = 5;

/**
 * Rank all cities by total EV of 5 optimal drivers.
 * Uses the same greedy driver selection as computeOptimalFleet.
 */
export function calculateCityRankings(
  data: AllData, lookups: Lookups,
): CityRanking[] {
  const uniqueTypes = getUniqueTypes(data, lookups);
  const rankings: CityRanking[] = [];

  for (const city of data.cities) {
    const cityProfile = buildCityCargoProfile(city.id, data, lookups);
    if (!cityProfile || cityProfile.cargo.size === 0) continue;

    const cityCompanies = lookups.cityCompanyMap.get(city.id) || [];
    let depotCount = 0;
    for (const { count } of cityCompanies) depotCount += count;

    const fleet = scoreFleet(uniqueTypes, cityProfile, lookups);
    const score = driverFleetScore(city.id, city.country, lookups, uniqueTypes);

    rankings.push({
      id: city.id,
      name: city.name,
      country: city.country,
      depotCount,
      cargoTypes: cityProfile.cargo.size,
      score,
      topTrailers: fleet.slice(0, TOP_TRAILERS),
    });
  }

  rankings.sort((a, b) => b.score - a.score);
  return rankings;
}

/**
 * Sum of EV for 5 greedy-picked drivers in a city.
 * Same algorithm as computeOptimalFleet Phase 1, but returns just the total score.
 */
function driverFleetScore(
  cityId: string, country: string, lookups: Lookups,
  uniqueTypes: UniqueTrailerType[],
): number {
  const jobPool = buildJobPool(cityId, lookups);
  if (!jobPool) return 0;

  const validTypes = uniqueTypes.filter((ut) => {
    const rep = ut.representative;
    return rep.countryValidity.length === 0 || rep.countryValidity.includes(country);
  });

  const remaining = new Map(jobPool);
  let totalScore = 0;

  for (let pick = 0; pick < RANKING_DRIVERS; pick++) {
    let bestEV = -1;
    let bestType: UniqueTrailerType | null = null;

    for (const ut of validTypes) {
      const rep = ut.representative;
      let totalCompatible = 0;
      let weightedHV = 0;
      for (const c of rep.cargo) {
        const rem = remaining.get(c.cargoId) ?? 0;
        if (rem > 0) { totalCompatible += rem; weightedHV += rem * c.haulValue; }
      }
      if (totalCompatible <= 0) continue;
      const ev = (weightedHV / totalCompatible) * Math.min(1, totalCompatible);
      if (ev > bestEV) { bestEV = ev; bestType = ut; }
    }

    if (!bestType || bestEV <= 0) break;
    totalScore += bestEV;

    // Proportional consumption
    const rep = bestType.representative;
    let totalCompatible = 0;
    for (const c of rep.cargo) {
      const rem = remaining.get(c.cargoId) ?? 0;
      if (rem > 0) totalCompatible += rem;
    }
    const consumption = Math.min(1, totalCompatible);
    for (const c of rep.cargo) {
      const rem = remaining.get(c.cargoId) ?? 0;
      if (rem <= 0) continue;
      remaining.set(c.cargoId, rem - consumption * rem / totalCompatible);
    }
  }

  return totalScore;
}

// ============================================
// Job pool model
// ============================================

/**
 * Build expected job distribution for a city.
 * Each depot spawns ~JOBS_PER_DEPOT jobs. Within a company, jobs are distributed
 * proportional to each cargo's prob_coef / total_prob_coef_at_company.
 *
 * Returns cargoId → expected job count (fractional).
 */
export function buildJobPool(
  cityId: string, lookups: Lookups,
): Map<string, number> | null {
  const cityCompanies = lookups.cityCompanyMap.get(cityId) || [];
  if (cityCompanies.length === 0) return null;

  const pool = new Map<string, number>();

  for (const { companyId, count: depotCount } of cityCompanies) {
    const cargoIds = lookups.companyCargoMap.get(companyId) || [];

    // Collect non-excluded cargo with their prob_coef
    let totalProbCoef = 0;
    const companyCargo: Array<{ cargoId: string; probCoef: number }> = [];
    for (const cargoId of cargoIds) {
      const cargo = lookups.cargoById.get(cargoId);
      if (!cargo || cargo.excluded) continue;
      const probCoef = cargo.prob_coef ?? 1.0;
      totalProbCoef += probCoef;
      companyCargo.push({ cargoId, probCoef });
    }

    if (totalProbCoef === 0) continue;

    // Distribute jobs: depotCount × JOBS_PER_DEPOT × (probCoef / totalProbCoef)
    for (const { cargoId, probCoef } of companyCargo) {
      const expectedJobs = depotCount * JOBS_PER_DEPOT * probCoef / totalProbCoef;
      pool.set(cargoId, (pool.get(cargoId) || 0) + expectedJobs);
    }
  }

  return pool.size > 0 ? pool : null;
}

/**
 * Compute marginal EV for each trailer type using the job pool model.
 *
 * 1. Build expected job pool for the city
 * 2. Greedy-assign owned trailers: each picks its highest-value available job
 * 3. For each candidate type, marginalEV = best remaining job it could pick
 *
 * Naturally handles cargo overlap: if Curtainside HCT already took the best
 * curtainside job, Curtainside Doubles sees a depleted pool.
 */
export function computeMarginalFleet(
  cityId: string, data: AllData, lookups: Lookups,
  ownedTrailerIds: string[],
): MarginalFleetEntry[] | null {
  const fleet = getFleetRecommendation(cityId, data, lookups);
  if (!fleet) return null;

  const jobPool = buildJobPool(cityId, lookups);
  if (!jobPool) return null;

  const uniqueTypes = getUniqueTypes(data, lookups);
  const typeMap = new Map(uniqueTypes.map((ut) => [ut.representative.trailerId, ut]));

  const city = lookups.citiesById.get(cityId);
  const country = city?.country ?? '';

  // Mutable copy of remaining jobs
  const remaining = new Map(jobPool);

  // Proportional consumption: each owned trailer spreads its 1-job consumption
  // across all compatible cargo, weighted by remaining spawn probability.
  // This models "driver gets a random job from the spawn pool."
  for (const tid of ownedTrailerIds) {
    const ut = typeMap.get(tid);
    if (!ut) continue;
    const rep = ut.representative;

    // Zone check
    if (rep.countryValidity.length > 0 && !rep.countryValidity.includes(country)) continue;

    // Total compatible jobs remaining for this trailer type
    let totalCompatible = 0;
    for (const entry of rep.cargo) {
      const rem = remaining.get(entry.cargoId) ?? 0;
      if (rem > 0) totalCompatible += rem;
    }
    if (totalCompatible <= 0) continue;

    // Consume up to 1 job, spread proportionally across compatible cargo
    const consumption = Math.min(1, totalCompatible);
    for (const entry of rep.cargo) {
      const rem = remaining.get(entry.cargoId) ?? 0;
      if (rem <= 0) continue;
      const fraction = rem / totalCompatible;
      remaining.set(entry.cargoId, rem - consumption * fraction);
    }
  }

  // Compute marginalEV for each candidate type
  // EV = probability-weighted average haulValue across compatible cargo,
  // scaled by probability of getting a job at all (min(1, totalCompatible)).
  const ownedCounts = new Map<string, number>();
  for (const tid of ownedTrailerIds) {
    ownedCounts.set(tid, (ownedCounts.get(tid) || 0) + 1);
  }

  const result: MarginalFleetEntry[] = fleet.map((entry) => {
    const owned = ownedCounts.get(entry.trailerId) || 0;
    const ut = typeMap.get(entry.trailerId);
    let marginalEV = 0;

    if (ut) {
      const rep = ut.representative;
      if (rep.countryValidity.length === 0 || rep.countryValidity.includes(country)) {
        let totalCompatible = 0;
        let weightedHaulValue = 0;
        for (const cargoEntry of rep.cargo) {
          const rem = remaining.get(cargoEntry.cargoId) ?? 0;
          if (rem <= 0) continue;
          totalCompatible += rem;
          weightedHaulValue += rem * cargoEntry.haulValue;
        }
        if (totalCompatible > 0) {
          // Weighted avg haulValue × chance of getting a job
          marginalEV = (weightedHaulValue / totalCompatible) * Math.min(1, totalCompatible);
        }
      }
    }

    return { ...entry, owned, marginalEV };
  });

  // City-level dedup: merge trailers with the same displayName (same body type + zone).
  // Different manufacturers/sizes haul the same cargo set — user just wants "a dumper."
  const deduped: MarginalFleetEntry[] = [];
  const seen = new Map<string, number>(); // displayName → index in deduped
  for (const entry of result) {
    const existingIdx = seen.get(entry.displayName);
    if (existingIdx !== undefined) {
      const existing = deduped[existingIdx];
      existing.variants += entry.variants;
      existing.owned += entry.owned;
      if (entry.marginalEV > existing.marginalEV) {
        existing.marginalEV = entry.marginalEV;
      }
      if (entry.cityValue > existing.cityValue) {
        existing.cityValue = entry.cityValue;
        existing.trailerId = entry.trailerId;
        existing.trailerSpec = entry.trailerSpec;
      }
      if (entry.cargoMatched > existing.cargoMatched) {
        existing.cargoMatched = entry.cargoMatched;
      }
    } else {
      seen.set(entry.displayName, deduped.length);
      deduped.push({ ...entry });
    }
  }

  deduped.sort((a, b) => b.marginalEV - a.marginalEV);
  return deduped;
}

// ============================================
// Optimal fleet recommendation
// ============================================

/** Max AI drivers in a garage */
const MAX_DRIVERS = 5;

/** Spare must add at least this fraction of average driver EV to justify buying */
const SPARE_EV_THRESHOLD_PCT = 0.20;

/** Zone capacity ranking: higher = more units per haul */
const ZONE_RANK: Record<string, number> = { hct: 3, double: 2, b_double: 2, single: 1 };

function getZoneRank(chainType: string): number {
  return ZONE_RANK[chainType] ?? 1;
}

/**
 * Compute the optimal finite trailer set for a city garage.
 *
 * Phase 1: Greedy-pick MAX_DRIVERS driver trailers using proportional consumption.
 * Phase 2: Evaluate spare trailers — each spare expands the returning driver's
 * cargo pool. Value = avg incremental EV across all fleet driver types.
 * Spares deduped by bodyType (only best zone variant per body type).
 */
export function computeOptimalFleet(
  cityId: string, data: AllData, lookups: Lookups,
): OptimalFleet | null {
  const jobPool = buildJobPool(cityId, lookups);
  if (!jobPool) return null;

  const uniqueTypes = getUniqueTypes(data, lookups);
  const city = lookups.citiesById.get(cityId);
  const country = city?.country ?? '';

  // Filter to types valid in this country
  const validTypes = uniqueTypes.filter((ut) => {
    const rep = ut.representative;
    return rep.countryValidity.length === 0 || rep.countryValidity.includes(country);
  });

  // For display: build a lookup from type to its best trailer spec
  const typeSpecs = new Map<string, { trailerId: string; trailerSpec: string; cargoMatched: number }>();
  for (const ut of validTypes) {
    const trailer = lookups.trailersById.get(ut.representative.trailerId);
    typeSpecs.set(ut.representative.trailerId, {
      trailerId: ut.representative.trailerId,
      trailerSpec: trailer ? formatTrailerSpec(trailer) : ut.representative.trailerId,
      cargoMatched: ut.representative.cargo.length,
    });
  }

  const remaining = new Map(jobPool);

  // Phase 1: Pick driver trailers
  // Each pick: find type with highest EV, consume 1 job proportionally.
  type DriverPick = { type: UniqueTrailerType; ev: number };
  const driverPicks: DriverPick[] = [];

  for (let pick = 0; pick < MAX_DRIVERS; pick++) {
    let bestType: UniqueTrailerType | null = null;
    let bestEV = -1;

    for (const ut of validTypes) {
      const rep = ut.representative;
      let totalCompatible = 0;
      let weightedHV = 0;
      for (const c of rep.cargo) {
        const rem = remaining.get(c.cargoId) ?? 0;
        if (rem > 0) { totalCompatible += rem; weightedHV += rem * c.haulValue; }
      }
      if (totalCompatible <= 0) continue;
      const ev = (weightedHV / totalCompatible) * Math.min(1, totalCompatible);
      if (ev > bestEV) { bestEV = ev; bestType = ut; }
    }

    if (!bestType || bestEV <= 0) break;
    driverPicks.push({ type: bestType, ev: bestEV });

    // Proportional consumption
    const rep = bestType.representative;
    let totalCompatible = 0;
    for (const c of rep.cargo) {
      const rem = remaining.get(c.cargoId) ?? 0;
      if (rem > 0) totalCompatible += rem;
    }
    const consumption = Math.min(1, totalCompatible);
    for (const c of rep.cargo) {
      const rem = remaining.get(c.cargoId) ?? 0;
      if (rem <= 0) continue;
      remaining.set(c.cargoId, rem - consumption * rem / totalCompatible);
    }
  }

  if (driverPicks.length === 0) return null;

  // Collapse driver picks by type (e.g., 5× Lowboy → one entry with count=5)
  const driverCounts = new Map<string, { type: UniqueTrailerType; ev: number; count: number }>();
  for (const pick of driverPicks) {
    const id = pick.type.representative.trailerId;
    const existing = driverCounts.get(id);
    if (existing) {
      existing.count++;
    } else {
      driverCounts.set(id, { type: pick.type, ev: pick.ev, count: 1 });
    }
  }

  const drivers: OptimalFleetEntry[] = [...driverCounts.values()].map((d) => {
    const rep = d.type.representative;
    const spec = typeSpecs.get(rep.trailerId)!;
    return {
      displayName: bodyTypeDisplayName(rep.bodyType, rep.chainType, rep.countryValidity),
      bodyType: rep.bodyType,
      trailerId: rep.trailerId,
      trailerSpec: spec.trailerSpec,
      role: 'driver' as const,
      ev: d.ev,
      cargoMatched: spec.cargoMatched,
      count: d.count,
    };
  });

  // Phase 2: Spare trailers
  // For each candidate type, compute avg incremental EV across all fleet driver types.
  // A spare adds cargo pool access for returning drivers who don't have that type.

  // Build cargo sets for each driver type in the fleet
  type DriverCargoProfile = { cargo: Array<{ cargoId: string; haulValue: number }> };
  const fleetProfiles: DriverCargoProfile[] = driverPicks.map((pick) => ({
    cargo: pick.type.representative.cargo.map((c) => ({ cargoId: c.cargoId, haulValue: c.haulValue })),
  }));

  const spareCandidates: Array<{
    type: UniqueTrailerType;
    spareEV: number;
    bodyType: string;
    zoneRank: number;
  }> = [];

  for (const spare of validTypes) {
    const spareRep = spare.representative;

    // Compute avg incremental EV across all fleet drivers
    let totalIncrementalEV = 0;

    for (const driverProfile of fleetProfiles) {
      // Driver's pool
      let driverTotal = 0;
      let driverWeightedHV = 0;
      for (const c of driverProfile.cargo) {
        const rem = remaining.get(c.cargoId) ?? 0;
        if (rem > 0) { driverTotal += rem; driverWeightedHV += rem * c.haulValue; }
      }

      // Combined pool (driver ∪ spare)
      const seen = new Set<string>();
      let combinedTotal = 0;
      let combinedWeightedHV = 0;
      for (const c of driverProfile.cargo) {
        const rem = remaining.get(c.cargoId) ?? 0;
        if (rem > 0) { combinedTotal += rem; combinedWeightedHV += rem * c.haulValue; seen.add(c.cargoId); }
      }
      for (const c of spareRep.cargo) {
        if (seen.has(c.cargoId)) continue;
        const rem = remaining.get(c.cargoId) ?? 0;
        if (rem > 0) { combinedTotal += rem; combinedWeightedHV += rem * c.haulValue; }
      }

      const driverEV = driverTotal > 0 ? (driverWeightedHV / driverTotal) * Math.min(1, driverTotal) : 0;
      const combinedEV = combinedTotal > 0 ? (combinedWeightedHV / combinedTotal) * Math.min(1, combinedTotal) : 0;

      totalIncrementalEV += combinedEV - driverEV;
    }

    const avgIncrementalEV = totalIncrementalEV / driverPicks.length;
    if (avgIncrementalEV > 0) {
      spareCandidates.push({
        type: spare,
        spareEV: avgIncrementalEV,
        bodyType: spareRep.bodyType,
        zoneRank: getZoneRank(spareRep.chainType),
      });
    }
  }

  // Dedup spares by bodyType — keep only the highest-capacity zone variant.
  // Curtainside (Doubles) and Curtainside (Standard) cover the same cargo pool;
  // only recommend the one with more units (HCT > Doubles > Standard).
  const bestByBody = new Map<string, typeof spareCandidates[0]>();
  for (const spare of spareCandidates) {
    const existing = bestByBody.get(spare.bodyType);
    if (!existing || spare.zoneRank > existing.zoneRank) {
      bestByBody.set(spare.bodyType, spare);
    }
  }

  // Threshold: spare must add at least 20% of average driver EV to justify buying
  const avgDriverEV = driverPicks.reduce((s, p) => s + p.ev, 0) / driverPicks.length;
  const minSpareEV = avgDriverEV * SPARE_EV_THRESHOLD_PCT;

  const spares: OptimalFleetEntry[] = [...bestByBody.values()]
    .filter((s) => s.spareEV > minSpareEV)
    .sort((a, b) => b.spareEV - a.spareEV)
    .map((s) => {
      const rep = s.type.representative;
      const spec = typeSpecs.get(rep.trailerId)!;
      return {
        displayName: bodyTypeDisplayName(rep.bodyType, rep.chainType, rep.countryValidity),
        bodyType: rep.bodyType,
        trailerId: rep.trailerId,
        trailerSpec: spec.trailerSpec,
        role: 'spare' as const,
        ev: s.spareEV,
        cargoMatched: spec.cargoMatched,
        count: 1,
      };
    });

  const totalTrailers = drivers.reduce((s, d) => s + d.count, 0) + spares.length;

  return { drivers, spares, totalTrailers };
}
