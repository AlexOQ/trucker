/**
 * Lookup builder for ETS2 Trucker Advisor
 *
 * Builds efficient lookup maps from loaded data for
 * fast access by ID and relationship traversal.
 */

import type { AllData, Lookups } from './types';

// Build lookup maps for efficient access
export function buildLookups(data: AllData): Lookups {
  const citiesById = new Map(data.cities.map((c) => [c.id, c]));
  const companiesById = new Map(data.companies.map((c) => [c.id, c]));
  const cargoById = new Map(data.cargo.map((c) => [c.id, c]));
  const trailersById = new Map(data.trailers.map((t) => [t.id, t]));

  const defs = data.gameDefs;
  const obs = data.observations;

  // City -> [{ companyId, count }]
  const cityCompanyMap = new Map<string, Array<{ companyId: string; count: number }>>();
  const cityCompaniesSource = defs?.city_companies ?? obs?.city_companies ?? {};
  for (const [city, companies] of Object.entries(cityCompaniesSource)) {
    const entries: Array<{ companyId: string; count: number }> = [];
    for (const [company, count] of Object.entries(companies)) {
      entries.push({ companyId: company, count });
    }
    cityCompanyMap.set(city, entries);
  }

  // Company -> [cargoId]
  const companyCargoMap = new Map<string, string[]>();
  const companyCargoSource = defs?.company_cargo ?? obs?.company_cargo ?? {};
  for (const [company, cargoes] of Object.entries(companyCargoSource)) {
    companyCargoMap.set(company, cargoes);
  }

  // Cargo -> Trailer compatibility
  const cargoTrailersSource = defs?.cargo_trailers ?? obs?.cargo_trailers ?? {};

  // Trailer -> Set<cargoId>
  const trailerCargoMap = new Map<string, Set<string>>();
  for (const [cargoId, trailerIds] of Object.entries(cargoTrailersSource)) {
    for (const trailerId of trailerIds) {
      if (!trailerCargoMap.has(trailerId)) {
        trailerCargoMap.set(trailerId, new Set());
      }
      trailerCargoMap.get(trailerId)!.add(cargoId);
    }
  }

  // Cargo -> Set<trailerId>
  const cargoTrailerMap = new Map<string, Set<string>>();
  for (const [cargoId, trailerIds] of Object.entries(cargoTrailersSource)) {
    cargoTrailerMap.set(cargoId, new Set(trailerIds));
  }

  // Cargo-trailer units: prefer game defs (computed from volumes), fall back to observations
  const cargoTrailerUnits = new Map<string, number>();
  if (defs?.cargo_trailer_units) {
    for (const [cargoId, trailers] of Object.entries(defs.cargo_trailer_units)) {
      for (const [trailerId, units] of Object.entries(trailers)) {
        cargoTrailerUnits.set(`${cargoId}:${trailerId}`, units);
      }
    }
  } else if (obs?.cargo_trailer_units) {
    for (const [cargoId, trailers] of Object.entries(obs.cargo_trailer_units)) {
      for (const [trailerId, unitData] of Object.entries(trailers)) {
        cargoTrailerUnits.set(`${cargoId}:${trailerId}`, unitData.median);
      }
    }
  }

  // Multi-body fan-out: for trailers with extra_body_types (set by loader from
  // multi-body-overrides.json), register them as compatible with cargo of any
  // matching body type they weren't already in. Iterate the FULL augmented set
  // [primary, ...extras] — the override can change body_type away from the
  // parser's original, leaving the new primary unregistered. Units computed
  // inline using the same volume/weight formula as the parser
  // (scripts/parse-game-defs.ts:1260).
  for (const trailer of data.trailers) {
    if (!trailer.extra_body_types || trailer.extra_body_types.length === 0) continue;
    const augmentedBodyTypes = [trailer.body_type, ...trailer.extra_body_types];
    for (const cargo of data.cargo) {
      if (cargo.excluded) continue;
      // Skip if cargo's body_types don't overlap any of trailer's body types
      const matchingModes = augmentedBodyTypes.filter((bt) => cargo.body_types.includes(bt));
      if (matchingModes.length === 0) continue;
      // Skip if already compatible (parser registered, or earlier fan-out pass)
      const existingTrailers = cargoTrailerMap.get(cargo.id);
      if (existingTrailers?.has(trailer.id)) continue;

      // Pick the trailer's best applicable bed for this cargo
      let effectiveVolume = 0;
      for (const bt of matchingModes) {
        const v = trailer.bodyVolumes?.[bt] ?? trailer.volume;
        if (v > effectiveVolume) effectiveVolume = v;
      }

      // Volume-limited units
      let units = 1;
      if (cargo.volume > 0 && effectiveVolume > 0) {
        units = Math.floor(effectiveVolume / cargo.volume);
        if (units < 1) units = 1;
      }
      // Weight-limited: cargo can't ride at all if even one unit overweights
      if (trailer.gross_weight_limit > 0 && cargo.mass > 0) {
        const maxCargoWeight = trailer.gross_weight_limit - trailer.chassis_mass - trailer.body_mass;
        const weightUnits = Math.floor(maxCargoWeight / cargo.mass);
        if (weightUnits <= 0) continue;
        if (weightUnits < units) units = weightUnits;
      }

      // Register in all three maps
      if (!cargoTrailerMap.has(cargo.id)) cargoTrailerMap.set(cargo.id, new Set());
      cargoTrailerMap.get(cargo.id)!.add(trailer.id);
      if (!trailerCargoMap.has(trailer.id)) trailerCargoMap.set(trailer.id, new Set());
      trailerCargoMap.get(trailer.id)!.add(cargo.id);
      cargoTrailerUnits.set(`${cargo.id}:${trailer.id}`, units);
    }
  }

  // Cargo -> [cityId] destinations
  const cargoDestinationsMap = new Map<string, string[]>();
  if (defs?.companies) {
    // 1. Map cargoId to set of company IDs that accept it
    const cargoToAcceptingCompanies = new Map<string, Set<string>>();
    for (const [coId, co] of Object.entries(defs.companies)) {
      for (const cargoId of co.cargo_in || []) {
        if (!cargoToAcceptingCompanies.has(cargoId)) {
          cargoToAcceptingCompanies.set(cargoId, new Set());
        }
        cargoToAcceptingCompanies.get(cargoId)!.add(coId);
      }
    }

    // 2. Map cargoId to all cities that have at least one accepting company
    // Only include cities that actually exist in our filtered citiesById map.
    for (const [cargoId, acceptingCos] of cargoToAcceptingCompanies.entries()) {
      const cityIds = new Set<string>();
      for (const coId of acceptingCos) {
        const coCities = defs.companies[coId]?.cities || [];
        for (const cityId of coCities) {
          if (citiesById.has(cityId)) {
            cityIds.add(cityId);
          }
        }
      }
      if (cityIds.size > 0) {
        cargoDestinationsMap.set(cargoId, [...cityIds]);
      }
    }
  }

  return {
    citiesById,
    companiesById,
    cargoById,
    trailersById,
    cityCompanyMap,
    companyCargoMap,
    trailerCargoMap,
    cargoTrailerMap,
    cargoTrailerUnits,
    cargoDestinationsMap,
  };
}
