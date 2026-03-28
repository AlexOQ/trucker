/**
 * Data loader for ETS2 Trucker Advisor
 *
 * Hybrid data model:
 * - game-defs.json: authoritative game data (cargo values, trailer specs, company mappings,
 *   prob_coef spawn probability coefficients)
 * - observations.json: supplementary data from save game parsing (city-company mappings,
 *   cargo-trailer compatibility, unit counts). Validates but does NOT override game defs.
 *
 * Game defs are the single source of truth for both value and probability.
 * Observations fill gaps and cross-validate.
 */

import { initDlcData, GARAGE_CITIES } from './dlc-data';
import { CITY_DISPLAY_NAMES, COUNTRY_DISPLAY_NAMES } from './display-names';
import { titleCase } from './utils';
import type {
  City, Company, Cargo, Trailer,
  GameDefs, Observations, AllData,
} from './types';

const dataCache: Record<string, unknown> = {};

async function loadJson<T>(filename: string): Promise<T | null> {
  if (filename in dataCache) {
    return dataCache[filename] as T | null;
  }
  try {
    const response = await fetch(`data/${filename}`);
    if (!response.ok) {
      dataCache[filename] = null;
      return null;
    }
    const data = await response.json();
    dataCache[filename] = data;
    return data as T;
  } catch {
    dataCache[filename] = null;
    return null;
  }
}

export async function loadAllData(): Promise<AllData> {
  // Load both sources in parallel
  const [gameDefs, observations] = await Promise.all([
    loadJson<GameDefs>('game-defs.json'),
    loadJson<Observations>('observations.json'),
  ]);

  if (!gameDefs && !observations) {
    throw new Error('No data sources available. Need game-defs.json or observations.json.');
  }

  // Initialize DLC data from game-defs.json when available
  if (gameDefs?.dlc) {
    initDlcData(gameDefs.dlc);
  }

  // Build entities from game defs (primary) with observations fallback
  const cities = buildCities(gameDefs, observations);
  const companies = buildCompanies(gameDefs, observations);
  const cargo = buildCargo(gameDefs, observations);
  const trailers = buildTrailers(gameDefs, observations);

  return { gameDefs, observations, cities, companies, cargo, trailers };
}

function buildCities(defs: GameDefs | null, obs: Observations | null): City[] {
  if (defs) {
    return Object.entries(defs.cities).map(([id, city]) => ({
      id,
      name: city.name,
      displayName: CITY_DISPLAY_NAMES[id] ?? city.name,
      country: city.country,
      countryName: COUNTRY_DISPLAY_NAMES[city.country] ?? city.country,
      hasGarage: city.has_garage ?? GARAGE_CITIES.has(id),
    }));
  }
  if (obs) {
    return obs.cities.map((id) => ({
      id, name: titleCase(id), displayName: CITY_DISPLAY_NAMES[id] ?? titleCase(id),
      country: '', countryName: '', hasGarage: GARAGE_CITIES.has(id),
    }));
  }
  return [];
}

function buildCompanies(defs: GameDefs | null, obs: Observations | null): Company[] {
  if (defs) {
    return Object.entries(defs.companies).map(([id, co]) => ({
      id,
      name: co.name,
    }));
  }
  if (obs) {
    return obs.companies.map((id) => ({ id, name: titleCase(id) }));
  }
  return [];
}

function buildCargo(defs: GameDefs | null, obs: Observations | null): Cargo[] {
  if (defs) {
    return Object.entries(defs.cargo).map(([id, c]) => ({
      id,
      name: c.name,
      value: c.value,
      volume: c.volume,
      mass: c.mass,
      fragility: c.fragility,
      fragile: c.fragile,
      high_value: c.high_value,
      adr_class: c.adr_class,
      prob_coef: c.prob_coef,
      body_types: c.body_types,
      groups: c.groups,
      excluded: c.excluded,
    }));
  }
  if (obs) {
    return obs.cargo.map((id) => ({
      id,
      name: titleCase(id),
      value: 1.0,
      volume: 1,
      mass: 0,
      fragility: 0,
      fragile: false,
      high_value: false,
      adr_class: 0,
      prob_coef: 1,
      body_types: [],
      groups: [],
      excluded: false,
    }));
  }
  return [];
}

function buildTrailers(defs: GameDefs | null, obs: Observations | null): Trailer[] {
  if (defs) {
    return Object.entries(defs.trailers).map(([id, t]) => ({
      id,
      name: t.name,
      body_type: t.body_type,
      volume: t.volume,
      chassis_mass: t.chassis_mass,
      body_mass: t.body_mass,
      gross_weight_limit: t.gross_weight_limit,
      length: t.length,
      chain_type: t.chain_type,
      country_validity: t.country_validity,
      ownable: t.ownable,
    }));
  }
  if (obs) {
    return obs.trailers.map((id) => ({
      id,
      name: titleCase(id),
      body_type: 'unknown',
      volume: 0,
      chassis_mass: 0,
      body_mass: 0,
      gross_weight_limit: 0,
      length: 0,
      chain_type: 'single',
      ownable: true,
    }));
  }
  return [];
}
