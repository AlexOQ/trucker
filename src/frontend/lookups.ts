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
  };
}
