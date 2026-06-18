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

import { getActiveGame } from './game';
import { initDlcData, GARAGE_CITIES } from './dlc-data';
import { getCityDisplayNames, getCountryDisplayNames } from './display-names';
import { titleCase } from './utils';
import type {
  City, Company, Cargo, Trailer,
  GameDefs, Observations, AllData, MultiBodyOverrides, ManualPricesFile, DataVersion,
} from './types';

const dataCache: Record<string, unknown> = {};

async function loadJson<T>(path: string): Promise<T | null> {
  if (path in dataCache) {
    return dataCache[path] as T | null;
  }
  try {
    const response = await fetch(path);
    if (!response.ok) {
      dataCache[path] = null;
      return null;
    }
    const data = await response.json();
    dataCache[path] = data;
    return data as T;
  } catch {
    dataCache[path] = null;
    return null;
  }
}

export async function loadAllData(): Promise<AllData> {
  const gameId = getActiveGame();
  const dataDir = `data/${gameId}`;

  // Load all sources in parallel. multi-body-overrides.json is optional — when
  // present, applied to trailers as `extra_body_types` so they compete for
  // multiple body_type slots in the optimizer. manual-prices.json is also
  // optional — when present, hand-walked prices override parser values at load
  // time so walks show up immediately without re-running the parser.
  // data-version.json is optional too — surfaced in the footer/README (#255).
  const [gameDefs, observations, multiBody, manualPrices, dataVersion] = await Promise.all([
    loadJson<GameDefs>(`${dataDir}/game-defs.json`),
    loadJson<Observations>(`${dataDir}/observations.json`),
    loadJson<MultiBodyOverrides>(`${dataDir}/multi-body-overrides.json`),
    loadJson<ManualPricesFile>(`${dataDir}/manual-prices.json`),
    loadJson<DataVersion>(`${dataDir}/data-version.json`),
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
  const trailers = buildTrailers(gameDefs, observations, multiBody, manualPrices);

  return { gameDefs, observations, cities, companies, cargo, trailers, dataVersion };
}

function buildCities(defs: GameDefs | null, obs: Observations | null): City[] {
  const gameId = getActiveGame();
  const cityNames = getCityDisplayNames(gameId);
  const countryNames = getCountryDisplayNames(gameId);

  if (defs) {
    return Object.entries(defs.cities).map(([id, city]) => ({
      id,
      name: city.name,
      displayName: cityNames[id] ?? city.name,
      country: city.country,
      countryName: countryNames[city.country] ?? city.country,
      hasGarage: city.has_garage ?? GARAGE_CITIES.has(id),
    }));
  }
  if (obs) {
    return obs.cities.map((id) => ({
      id, name: titleCase(id), displayName: cityNames[id] ?? titleCase(id),
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

function buildTrailers(
  defs: GameDefs | null,
  obs: Observations | null,
  multiBody: MultiBodyOverrides | null,
  manualPrices: ManualPricesFile | null,
): Trailer[] {
  const overrides = multiBody?.overrides ?? {};
  const walked = manualPrices?.prices ?? {};
  if (defs) {
    return Object.entries(defs.trailers).map(([id, t]) => {
      const override = overrides[id];
      // Normalise legacy array form and new object form to one shape.
      const bodyTypes = Array.isArray(override)
        ? override
        : override?.body_types;
      const volumesMap = !Array.isArray(override) ? override?.volumes : undefined;
      const primary = bodyTypes && bodyTypes.length > 0 ? bodyTypes[0] : t.body_type;
      const extras = bodyTypes && bodyTypes.length > 1 ? bodyTypes.slice(1) : undefined;
      const walkedEntry = walked[id];
      // Manual-walked price overrides parser unconditionally (parser is
      // unreliable per feedback_trucker_parser_prices_unreliable memory).
      const price = walkedEntry ? walkedEntry.price : (t.price ?? 0);
      const priceWalked = walkedEntry !== undefined;
      return {
        id,
        name: t.name,
        body_type: primary,
        extra_body_types: extras,
        bodyVolumes: volumesMap,
        volume: t.volume,
        chassis_mass: t.chassis_mass,
        body_mass: t.body_mass,
        gross_weight_limit: t.gross_weight_limit,
        length: t.length,
        chain_type: t.chain_type,
        country_validity: t.country_validity,
        ownable: t.ownable,
        price,
        priceWalked,
        level_floor: t.level_floor ?? 0,
      };
    });
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
      price: 0,
      level_floor: 0,
    }));
  }
  return [];
}
