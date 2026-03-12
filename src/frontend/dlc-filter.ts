/**
 * DLC filtering for ETS2 Trucker Advisor
 *
 * Filters out trailers, cargo, and cities from unowned DLCs.
 */

import { GARAGE_CITIES } from './dlc-data';
import type { AllData } from './types';

/**
 * Filter out trailers/cargo/cities from unowned DLCs.
 * Returns a new AllData with filtered content and cleaned-up gameDefs maps.
 *
 * cargoDLCMap should be the COMBINED map (cargo packs + map DLC shadow entries).
 * ownedCargoDLCSet should be the union of owned cargo pack IDs + owned map DLC IDs.
 * blockedCities is the set of city IDs from unowned map DLCs.
 */
export function applyDLCFilter(
  data: AllData,
  ownedTrailerDLCs: string[],
  ownedCargoDLCSet?: Set<string>,
  cargoDLCMap?: Record<string, string>,
  blockedCities?: Set<string>,
): AllData {
  const ownedTrailerSet = new Set(ownedTrailerDLCs);

  function isTrailerAllowed(trailerId: string): boolean {
    const brand = trailerId.split('.')[0];
    return brand === 'scs' || ownedTrailerSet.has(brand);
  }

  function isCargoAllowed(cargoId: string): boolean {
    if (!ownedCargoDLCSet || !cargoDLCMap) return true;
    const dlc = cargoDLCMap[cargoId];
    return !dlc || ownedCargoDLCSet.has(dlc);
  }

  function isCityAllowed(cityId: string): boolean {
    return !blockedCities || !blockedCities.has(cityId);
  }

  const trailers = data.trailers.filter((t) => isTrailerAllowed(t.id));
  const cargo = data.cargo.filter((c) => isCargoAllowed(c.id));
  const cities = data.cities.filter((c) => c.hasGarage && isCityAllowed(c.id));

  let gameDefs = data.gameDefs;
  if (gameDefs) {
    const filteredTrailers: typeof gameDefs.trailers = {};
    for (const [id, t] of Object.entries(gameDefs.trailers)) {
      if (isTrailerAllowed(id)) filteredTrailers[id] = t;
    }

    const filteredCargo: typeof gameDefs.cargo = {};
    for (const [id, c] of Object.entries(gameDefs.cargo)) {
      if (isCargoAllowed(id)) filteredCargo[id] = c;
    }

    const filteredCTU: typeof gameDefs.cargo_trailer_units = {};
    for (const [cargoId, tmap] of Object.entries(gameDefs.cargo_trailer_units)) {
      if (!isCargoAllowed(cargoId)) continue;
      const filtered: Record<string, number> = {};
      for (const [tid, units] of Object.entries(tmap)) {
        if (isTrailerAllowed(tid)) filtered[tid] = units;
      }
      if (Object.keys(filtered).length > 0) filteredCTU[cargoId] = filtered;
    }

    const filteredCT: typeof gameDefs.cargo_trailers = {};
    for (const [cargoId, tids] of Object.entries(gameDefs.cargo_trailers)) {
      if (!isCargoAllowed(cargoId)) continue;
      const filtered = tids.filter(isTrailerAllowed);
      if (filtered.length > 0) filteredCT[cargoId] = filtered;
    }

    const filteredCC: typeof gameDefs.company_cargo = {};
    for (const [compId, cargoIds] of Object.entries(gameDefs.company_cargo)) {
      const filtered = cargoIds.filter(isCargoAllowed);
      if (filtered.length > 0) filteredCC[compId] = filtered;
    }

    // Filter city_companies to remove blocked and non-garage cities
    const filteredCityCompanies: typeof gameDefs.city_companies = {};
    for (const [cityId, comps] of Object.entries(gameDefs.city_companies)) {
      const city = gameDefs.cities[cityId];
      const hasGarage = city ? (city.has_garage ?? GARAGE_CITIES.has(cityId)) : GARAGE_CITIES.has(cityId);
      if (hasGarage && isCityAllowed(cityId)) filteredCityCompanies[cityId] = comps;
    }

    // Filter cities from gameDefs
    const filteredCities: typeof gameDefs.cities = {};
    for (const [cityId, city] of Object.entries(gameDefs.cities)) {
      const hasGarage = city.has_garage ?? GARAGE_CITIES.has(cityId);
      if (hasGarage && isCityAllowed(cityId)) filteredCities[cityId] = city;
    }

    gameDefs = {
      ...gameDefs,
      cargo: filteredCargo,
      trailers: filteredTrailers,
      cargo_trailer_units: filteredCTU,
      cargo_trailers: filteredCT,
      company_cargo: filteredCC,
      city_companies: filteredCityCompanies,
      cities: filteredCities,
    };
  }

  return { ...data, trailers, cargo, cities, gameDefs };
}

/**
 * Build the set of blocked city IDs from unowned map DLCs.
 */
export function getBlockedCities(
  ownedMapDLCs: string[],
  cityDLCMap: Record<string, string[]>,
): Set<string> {
  const owned = new Set(ownedMapDLCs);
  const blocked = new Set<string>();
  for (const [dlcId, cities] of Object.entries(cityDLCMap)) {
    if (!owned.has(dlcId)) {
      for (const city of cities) blocked.add(city);
    }
  }
  return blocked;
}
