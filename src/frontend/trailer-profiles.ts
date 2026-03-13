/**
 * Trailer profile builder for ETS2 Trucker Advisor
 *
 * Builds earning profiles for trailers, deduplicates cosmetically
 * identical variants, and eliminates dominated types.
 * Also provides city-level cargo pool and scoring functions.
 */

import type {
  AllData, Lookups,
  TrailerProfile, TrailerCargoEntry,
  UniqueTrailerType,
  CargoWeight, DepotProfile, CityCargoProfile,
  TrailerCityScore, CargoPoolEntry,
} from './types';
import { cargoBonus } from './utils';

/**
 * Build earning profiles for all ownable trailer variants.
 * Each profile contains the cargo this specific variant can haul,
 * with units, haul value, and spawn weight per cargo.
 */
export function buildTrailerProfiles(data: AllData, lookups: Lookups): TrailerProfile[] {
  const profiles: TrailerProfile[] = [];

  for (const trailer of data.trailers) {
    if (!trailer.ownable) continue;

    const cargoIds = lookups.trailerCargoMap.get(trailer.id);
    if (!cargoIds || cargoIds.size === 0) continue;

    const cargo: TrailerCargoEntry[] = [];
    let totalHaulValue = 0;
    let totalWeightedValue = 0;

    for (const cargoId of cargoIds) {
      const c = lookups.cargoById.get(cargoId);
      if (!c || c.excluded) continue;

      const units = lookups.cargoTrailerUnits.get(`${cargoId}:${trailer.id}`) ?? 1;
      const bonus = cargoBonus(c);
      const haulValue = c.value * bonus * units;
      const spawnWeight = c.prob_coef ?? 1.0;

      cargo.push({ cargoId, units, haulValue, spawnWeight });
      totalHaulValue += haulValue;
      totalWeightedValue += haulValue * spawnWeight;
    }

    cargo.sort((a, b) => b.haulValue - a.haulValue);

    profiles.push({
      trailerId: trailer.id,
      bodyType: trailer.body_type,
      volume: trailer.volume,
      grossWeightLimit: trailer.gross_weight_limit,
      length: trailer.length,
      chainType: trailer.chain_type,
      countryValidity: trailer.country_validity ?? [],
      cargo,
      totalHaulValue,
      totalWeightedValue,
    });
  }

  profiles.sort((a, b) => b.totalWeightedValue - a.totalWeightedValue);
  return profiles;
}

/**
 * Build cargo profiles for all depot types (companies).
 * Same company = same cargo profile regardless of city.
 */
export function buildDepotProfiles(data: AllData, lookups: Lookups): Map<string, DepotProfile> {
  const profiles = new Map<string, DepotProfile>();

  for (const company of data.companies) {
    const cargoIds = lookups.companyCargoMap.get(company.id) || [];
    const cargo: CargoWeight[] = [];
    let totalWeightedValue = 0;

    for (const cargoId of cargoIds) {
      const c = lookups.cargoById.get(cargoId);
      if (!c || c.excluded) continue;
      const bonus = cargoBonus(c);
      const value = c.value * bonus;
      const spawnWeight = c.prob_coef ?? 1.0;
      const weightedValue = value * spawnWeight;
      cargo.push({ cargoId, value, spawnWeight, depotCount: 1, weightedValue });
      totalWeightedValue += weightedValue;
    }

    cargo.sort((a, b) => b.weightedValue - a.weightedValue);
    profiles.set(company.id, {
      companyId: company.id,
      companyName: company.name,
      cargo,
      totalWeightedValue,
    });
  }

  return profiles;
}

/**
 * Build cargo profile for a city = sum of its depot profiles.
 * Each cargo's depotCount accumulates across all companies that export it.
 */
export function buildCityCargoProfile(
  cityId: string, data: AllData, lookups: Lookups,
): CityCargoProfile | null {
  const city = lookups.citiesById.get(cityId);
  if (!city) return null;

  const cityCompanies = lookups.cityCompanyMap.get(cityId) || [];
  if (cityCompanies.length === 0) return null;

  const cargo = new Map<string, CargoWeight>();
  let totalDepots = 0;
  let companyCount = 0;

  for (const { companyId, count } of cityCompanies) {
    companyCount++;
    totalDepots += count;
    const cargoIds = lookups.companyCargoMap.get(companyId) || [];

    for (const cargoId of cargoIds) {
      const c = lookups.cargoById.get(cargoId);
      if (!c || c.excluded) continue;

      const existing = cargo.get(cargoId);
      if (existing) {
        existing.depotCount += count;
        existing.weightedValue = existing.value * existing.spawnWeight * existing.depotCount;
      } else {
        const bonus = cargoBonus(c);
        const value = c.value * bonus;
        const spawnWeight = c.prob_coef ?? 1.0;
        cargo.set(cargoId, {
          cargoId, value, spawnWeight, depotCount: count,
          weightedValue: value * spawnWeight * count,
        });
      }
    }
  }

  let totalWeightedValue = 0;
  for (const entry of cargo.values()) totalWeightedValue += entry.weightedValue;

  return {
    cityId, cityName: city.name, country: city.country,
    depotCount: totalDepots, companyCount,
    cargo, totalWeightedValue,
  };
}

/**
 * Score a trailer profile against a city's cargo profile.
 * Only scores if the trailer is valid in the city's country.
 * Returns null if trailer can't operate in this country.
 */
export function scoreTrailerInCity(
  trailer: TrailerProfile, cityProfile: CityCargoProfile,
): TrailerCityScore | null {
  // Zone check: trailer must be valid in this country
  if (trailer.countryValidity.length > 0
    && !trailer.countryValidity.includes(cityProfile.country)) {
    return null;
  }

  let cityValue = 0;
  let cargoMatched = 0;

  for (const entry of trailer.cargo) {
    const cityEntry = cityProfile.cargo.get(entry.cargoId);
    if (!cityEntry) continue;
    // Trailer's haulValue (value*bonus*units) * city's spawn contribution (spawnWeight*depotCount)
    cityValue += entry.haulValue * cityEntry.spawnWeight * cityEntry.depotCount;
    cargoMatched++;
  }

  return {
    trailerId: trailer.trailerId,
    bodyType: trailer.bodyType,
    chainType: trailer.chainType,
    cityValue,
    cargoMatched,
  };
}

/**
 * Rank all trailer profiles for a city, sorted by cityValue descending.
 * Filters by country validity automatically.
 */
export function rankTrailersForCity(
  trailerProfiles: TrailerProfile[], cityProfile: CityCargoProfile,
): TrailerCityScore[] {
  const scores: TrailerCityScore[] = [];
  for (const tp of trailerProfiles) {
    const score = scoreTrailerInCity(tp, cityProfile);
    if (score && score.cityValue > 0) scores.push(score);
  }
  scores.sort((a, b) => b.cityValue - a.cityValue);
  return scores;
}

/**
 * Compute earning fingerprint for a trailer profile.
 * Two trailers with the same fingerprint earn identically on all cargo.
 * Fingerprint includes: bodyType, chainType, country validity, and cargo->units mapping.
 */
function earningFingerprint(p: TrailerProfile): string {
  const cargoKey = p.cargo
    .map((e) => `${e.cargoId}:${e.units}`)
    .sort()
    .join('|');
  return `${p.bodyType}/${p.chainType}/${p.countryValidity.slice().sort().join(',')}/${cargoKey}`;
}

/**
 * Deduplicate trailer profiles into unique earning types.
 * Step 1: Cosmetic dedup -- group trailers with identical earning fingerprints.
 *         Pick representative: shortest length, then highest GWL, then shortest ID.
 * Step 2: Domination -- type A dominates B if:
 *         - A can operate everywhere B can (A's countries >= B's, or A is unrestricted)
 *         - A can haul all of B's cargo with >= haulValue per cargo
 *         - A is strictly better somewhere (more cargo, higher value, or shorter length)
 *
 * Typical reduction: 514 ownable -> ~134 earning-unique -> ~43 non-dominated types.
 */
export function deduplicateTrailerProfiles(profiles: TrailerProfile[]): UniqueTrailerType[] {
  // Step 1: Cosmetic dedup -- group by earning fingerprint
  const groups = new Map<string, TrailerProfile[]>();
  for (const p of profiles) {
    const fp = earningFingerprint(p);
    const group = groups.get(fp);
    if (group) group.push(p);
    else groups.set(fp, [p]);
  }

  const deduped: UniqueTrailerType[] = [];
  for (const members of groups.values()) {
    // Pick representative: shortest length -> highest GWL -> shortest ID
    members.sort((a, b) =>
      a.length - b.length
      || b.grossWeightLimit - a.grossWeightLimit
      || a.trailerId.length - b.trailerId.length
      || a.trailerId.localeCompare(b.trailerId)
    );
    deduped.push({
      representative: members[0],
      variants: members.map((m) => m.trailerId),
      dominatedBy: null,
    });
  }

  // Step 2: Domination check
  // Build cargo lookup per type for fast comparison
  const cargoMaps = new Map<UniqueTrailerType, Map<string, number>>();
  for (const t of deduped) {
    const m = new Map<string, number>();
    for (const e of t.representative.cargo) m.set(e.cargoId, e.haulValue);
    cargoMaps.set(t, m);
  }

  function countriesSuperset(a: string[], b: string[]): boolean {
    // A covers B's countries if A is unrestricted (empty) or A >= B
    if (a.length === 0) return true;
    if (b.length === 0) return false;
    const setA = new Set(a);
    return b.every((c) => setA.has(c));
  }

  function dominates(a: UniqueTrailerType, b: UniqueTrailerType): boolean {
    const aRep = a.representative;
    const bRep = b.representative;

    // A must be valid everywhere B is valid
    if (!countriesSuperset(aRep.countryValidity, bRep.countryValidity)) return false;

    // A must cover all of B's cargo with >= haulValue
    const aMap = cargoMaps.get(a)!;
    const bMap = cargoMaps.get(b)!;
    for (const [cargoId, bVal] of bMap) {
      const aVal = aMap.get(cargoId);
      if (aVal === undefined || aVal < bVal - 0.001) return false;
    }

    // A must be strictly better somewhere
    if (aMap.size > bMap.size) return true;
    for (const [cargoId, bVal] of bMap) {
      if (aMap.get(cargoId)! > bVal + 0.001) return true;
    }
    if (aRep.length < bRep.length) return true;

    return false;
  }

  const dominated = new Set<number>();
  for (let i = 0; i < deduped.length; i++) {
    if (dominated.has(i)) continue;
    for (let j = 0; j < deduped.length; j++) {
      if (i === j || dominated.has(j)) continue;
      if (dominates(deduped[i], deduped[j])) {
        dominated.add(j);
        deduped[j].dominatedBy = deduped[i].representative.trailerId;
      }
    }
  }

  // Return non-dominated types, sorted by totalWeightedValue descending
  return deduped
    .filter((_, i) => !dominated.has(i))
    .sort((a, b) => b.representative.totalWeightedValue - a.representative.totalWeightedValue);
}

/**
 * Convenience: build profiles, dedup, and return unique types in one call.
 */
export function getUniqueTrailerTypes(data: AllData, lookups: Lookups): UniqueTrailerType[] {
  const profiles = buildTrailerProfiles(data, lookups);
  return deduplicateTrailerProfiles(profiles);
}

// Get cargo pool for a city (with depot count multiplicity)
export function getCityCargoPool(cityId: string, data: AllData, lookups: Lookups): CargoPoolEntry[] {
  const pool: CargoPoolEntry[] = [];
  const cityCompanies = lookups.cityCompanyMap.get(cityId) || [];

  for (const { companyId, count } of cityCompanies) {
    const cargoIds = lookups.companyCargoMap.get(companyId) || [];
    for (const cargoId of cargoIds) {
      const cargo = lookups.cargoById.get(cargoId);
      if (cargo && !cargo.excluded) {
        const multiplier = cargoBonus(cargo);
        const spawnWeight = cargo.prob_coef ?? 1.0;
        pool.push({
          companyId,
          depotCount: count,
          cargoId,
          cargoName: cargo.name,
          value: cargo.value * multiplier,
          spawnWeight,
        });
      }
    }
  }

  return pool;
}
