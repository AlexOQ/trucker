/**
 * Data loader for ETS2 Trucker Advisor
 *
 * Hybrid data model:
 * - game-defs.json: authoritative game data (cargo values, trailer specs, company mappings)
 * - observations.json: observed spawn probabilities from save game parsing
 *
 * Game defs provide the value side (what a job is worth).
 * Observations provide the probability side (how often cargoes spawn).
 */

export interface City {
  id: string;
  name: string;
  country: string;
}

export interface Company {
  id: string;
  name: string;
}

export interface Cargo {
  id: string;
  name: string;
  value: number;       // unit_reward_per_km from game defs
  volume: number;      // m3 per unit
  mass: number;        // kg per unit
  fragility: number;
  fragile: boolean;    // fragility >= 0.5
  high_value: boolean; // valuable: true in defs
  adr_class: number;
  prob_coef: number;   // spawn probability coefficient
  body_types: string[];
  groups: string[];
  excluded: boolean;
}

export interface Trailer {
  id: string;
  name: string;
  body_type: string;
  volume: number;
  chassis_mass: number;
  body_mass: number;
  gross_weight_limit: number;
  length: number;
  chain_type: string;
  country_validity?: string[];
  ownable: boolean;
}

import { initDlcData, type DlcSection } from './dlc-data';

export interface GameDefs {
  cargo: Record<string, {
    name: string;
    value: number;
    volume: number;
    mass: number;
    fragility: number;
    fragile: boolean;
    high_value: boolean;
    adr_class: number;
    prob_coef: number;
    body_types: string[];
    groups: string[];
    excluded: boolean;
  }>;
  trailers: Record<string, {
    name: string;
    body_type: string;
    volume: number;
    chassis_mass: number;
    body_mass: number;
    gross_weight_limit: number;
    length: number;
    chain_type: string;
    country_validity?: string[];
    ownable: boolean;
  }>;
  companies: Record<string, {
    name: string;
    cargo_out: string[];
    cargo_in: string[];
    cities: string[];
  }>;
  cities: Record<string, {
    name: string;
    country: string;
  }>;
  countries: Record<string, { name: string }>;
  cargo_trailer_units: Record<string, Record<string, number>>;
  company_cargo: Record<string, string[]>;
  cargo_trailers: Record<string, string[]>;
  city_companies: Record<string, Record<string, number>>;
  economy: {
    fixed_revenue: number;
    revenue_coef_per_km: number;
    cargo_market_revenue_coef_per_km: number;
  };
  dlc?: DlcSection;
  trucks: Array<{
    id: string;
    brand: string;
    model: string;
    engines: Array<{
      id: string;
      name: string;
      torque: number;
      volume: number;
      rpm_limit: number;
      price: number;
      unlock: number;
    }>;
    transmissions: Array<{
      id: string;
      name: string;
      differential_ratio: number;
      forward_gears: number;
      reverse_gears: number;
      retarder: number;
      price: number;
      unlock: number;
    }>;
    chassis: Array<{
      id: string;
      name: string;
      axle_config: string;
      tank_size: number;
      price: number;
      unlock: number;
    }>;
  }>;
}

export interface Observations {
  meta: { saves_parsed: number; total_jobs: number; max_saves: number };
  variant_body_type: Record<string, string>;
  cities: string[];
  companies: string[];
  cargo: string[];
  trailers: string[];
  city_companies: Record<string, Record<string, number>>;
  company_cargo: Record<string, string[]>;
  cargo_trailers: Record<string, string[]>;
  cargo_frequency: Record<string, number>;
  cargo_spawn_weight: Record<string, number>;
  cargo_trailer_units: Record<string, Record<string, { median: number; count: number }>>;
  company_cargo_frequency: Record<string, Record<string, number>>;
  city_job_count: Record<string, number>;
  city_cargo_frequency: Record<string, Record<string, number>>;
  city_trailer_frequency: Record<string, Record<string, number>>;
  city_body_type_frequency: Record<string, Record<string, number>>;
  body_type_avg_value: Record<string, number>;
  city_zone_body_type_frequency: Record<string, Record<string, Record<string, number>>>;
  zone_body_type_avg_value: Record<string, Record<string, number>>;
  company_body_type_frequency?: Record<string, Record<string, number>>;
  company_zone_body_type_frequency?: Record<string, Record<string, Record<string, number>>>;
  company_job_count?: Record<string, number>;
  company_body_type_avg_value?: Record<string, Record<string, number>>;
}

export interface AllData {
  gameDefs: GameDefs | null;
  observations: Observations | null;
  cities: City[];
  companies: Company[];
  cargo: Cargo[];
  trailers: Trailer[];
}

export interface Lookups {
  citiesById: Map<string, City>;
  companiesById: Map<string, Company>;
  cargoById: Map<string, Cargo>;
  trailersById: Map<string, Trailer>;
  cityCompanyMap: Map<string, Array<{ companyId: string; count: number }>>;
  companyCargoMap: Map<string, string[]>;
  trailerCargoMap: Map<string, Set<string>>;
  cargoTrailerMap: Map<string, Set<string>>;
  cargoTrailerUnits: Map<string, number>; // "cargoId:trailerId" -> units
}

export interface BodyTypeProfile {
  bodyType: string;
  displayName: string;
  cargoIds: Set<string>;
  cargoCount: number;
  bestTrailerId: string;     // absolute best trailer (any chain type) by totalHV
  bestTrailerName: string;
  bestTotalHV: number;       // sum of haulValue across all cargo for the best trailer
  bestChainType: string;     // chain_type of the best trailer
  bestCountries: string[];   // country_validity of the best trailer (empty = all)
  hasDoubles: boolean;
  hasBDoubles: boolean;
  hasHCT: boolean;
  doublesCountries: string[];
  bdoublesCountries: string[];
  hctCountries: string[];
  dominatedBy: string | null; // if non-null, this body type's cargo ⊂ the named body type
}

/** Result of deduplicating trailer profiles: unique earning types + dominated elimination */
export interface UniqueTrailerType {
  representative: TrailerProfile;   // the chosen representative trailer
  variants: string[];               // all trailer IDs that are cosmetically identical
  dominatedBy: string | null;       // if non-null, this type is dominated by another
}

/** A single cargo entry in a trailer's earning profile */
export interface TrailerCargoEntry {
  cargoId: string;
  units: number;         // max units on this specific trailer variant
  haulValue: number;     // value × bonus × units = max haul value/km
  spawnWeight: number;   // prob_coef (0.3–2.0)
}

/** Earning profile for one ownable trailer variant */
export interface TrailerProfile {
  trailerId: string;
  bodyType: string;
  volume: number;
  grossWeightLimit: number;
  length: number;
  chainType: string;            // single, double, b_double, hct
  countryValidity: string[];    // empty = all countries
  cargo: TrailerCargoEntry[];   // sorted by haulValue desc
  totalHaulValue: number;       // sum of all cargo haulValues
  totalWeightedValue: number;   // sum of haulValue × spawnWeight
}

/** A single cargo's contribution to a profile's spawn-weighted value */
export interface CargoWeight {
  cargoId: string;
  value: number;         // value × bonus (per unit per km)
  spawnWeight: number;   // prob_coef
  depotCount: number;    // how many depots spawn this cargo (city-level only)
  weightedValue: number; // value × spawnWeight × depotCount
}

/** Cargo profile for a depot type (company). Same company = same profile everywhere. */
export interface DepotProfile {
  companyId: string;
  companyName: string;
  cargo: CargoWeight[];
  totalWeightedValue: number;
}

/** Cargo profile for a city = sum of its depot profiles, weighted by depot counts. */
export interface CityCargoProfile {
  cityId: string;
  cityName: string;
  country: string;
  depotCount: number;                   // total depot slots
  companyCount: number;
  cargo: Map<string, CargoWeight>;      // cargoId → aggregated weight
  totalWeightedValue: number;
}

/** A trailer type scored against a specific city */
export interface TrailerCityScore {
  trailerId: string;
  bodyType: string;
  chainType: string;
  cityValue: number;    // sum of haulValue × spawnWeight × depotCount for matching cargo
  cargoMatched: number; // how many of the city's cargo types this trailer covers
}

export interface CargoPoolEntry {
  companyId: string;
  depotCount: number;
  cargoId: string;
  cargoName: string;
  value: number;
  spawnWeight: number;
}

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

/** Convert game ID to display name: "apples_c" -> "Apples C" */
function titleCase(gameId: string): string {
  return gameId
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
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
      country: city.country,
    }));
  }
  if (obs) {
    return obs.cities.map((id) => ({ id, name: titleCase(id), country: '' }));
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
  const cities = data.cities.filter((c) => isCityAllowed(c.id));

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

    // Filter city_companies to remove blocked cities
    const filteredCityCompanies: typeof gameDefs.city_companies = {};
    for (const [cityId, comps] of Object.entries(gameDefs.city_companies)) {
      if (isCityAllowed(cityId)) filteredCityCompanies[cityId] = comps;
    }

    // Filter cities from gameDefs
    const filteredCities: typeof gameDefs.cities = {};
    for (const [cityId, city] of Object.entries(gameDefs.cities)) {
      if (isCityAllowed(cityId)) filteredCities[cityId] = city;
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
      const bonus = 1 + (c.fragile ? 0.3 : 0) + (c.high_value ? 0.3 : 0);
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
      const bonus = 1 + (c.fragile ? 0.3 : 0) + (c.high_value ? 0.3 : 0);
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
        const bonus = 1 + (c.fragile ? 0.3 : 0) + (c.high_value ? 0.3 : 0);
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
    // Trailer's haulValue (value×bonus×units) × city's spawn contribution (spawnWeight×depotCount)
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
 * Fingerprint includes: bodyType, chainType, country validity, and cargo→units mapping.
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
 * Step 1: Cosmetic dedup — group trailers with identical earning fingerprints.
 *         Pick representative: shortest length, then highest GWL, then shortest ID.
 * Step 2: Domination — type A dominates B if:
 *         - A can operate everywhere B can (A's countries ⊇ B's, or A is unrestricted)
 *         - A can haul all of B's cargo with ≥ haulValue per cargo
 *         - A is strictly better somewhere (more cargo, higher value, or shorter length)
 *
 * Typical reduction: 514 ownable → ~134 earning-unique → ~43 non-dominated types.
 */
export function deduplicateTrailerProfiles(profiles: TrailerProfile[]): UniqueTrailerType[] {
  // Step 1: Cosmetic dedup — group by earning fingerprint
  const groups = new Map<string, TrailerProfile[]>();
  for (const p of profiles) {
    const fp = earningFingerprint(p);
    const group = groups.get(fp);
    if (group) group.push(p);
    else groups.set(fp, [p]);
  }

  const deduped: UniqueTrailerType[] = [];
  for (const members of groups.values()) {
    // Pick representative: shortest length → highest GWL → shortest ID
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
    // A covers B's countries if A is unrestricted (empty) or A ⊇ B
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

    // A must cover all of B's cargo with ≥ haulValue
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
        const multiplier = 1 + (cargo.fragile ? 0.3 : 0) + (cargo.high_value ? 0.3 : 0);
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

// Get ownable trailers only
export function getOwnableTrailers(data: AllData): Trailer[] {
  return data.trailers.filter((t) => t.ownable);
}

/**
 * Normalize text for accent-insensitive search
 * Removes diacritics and converts to lowercase
 */
export function normalize(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Build body type profiles from game data.
 * Each profile represents one body type needed to cover all cargo.
 * Picks the best standard ownable trailer per body type (max volume).
 */
/** Build a human-readable spec string from trailer properties, e.g. "Kassbohrer 3-axle 79t 16.4m" */
export function formatTrailerSpec(t: Trailer): string {
  const idParts = t.id.split('.');
  const brandRaw = idParts[0];
  const brand = brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1);

  // Chain type label for non-single trailers
  let chainLabel = '';
  if (t.chain_type === 'hct') chainLabel = 'HCT';
  else if (t.chain_type === 'b_double') chainLabel = 'B-double';
  else if (t.chain_type === 'double') chainLabel = 'Double';

  // Extract axle count from ID
  let axleStr = '';
  const singleMatch = t.id.match(/single_(\d+)/);
  if (singleMatch) {
    const num = singleMatch[1];
    if (num === '41') axleStr = '4+1-axle';
    else axleStr = `${num.charAt(0)}-axle`;
    // Check for "+1" patterns like single_4_1 or single_3_1
    const plusMatch = t.id.match(/single_(\d)_1\b/);
    if (plusMatch) axleStr = `${plusMatch[1]}+1-axle`;
  } else if (t.id.includes('ch_')) {
    const chMatch = t.id.match(/ch_(\d+)/);
    if (chMatch) axleStr = `${chMatch[1]}-axle`;
  } else if (chainLabel) {
    // HCT: hct_3_2_3 → 3+2+3, hct_3_2s_4 → 3+2+4
    const hctMatch = t.id.match(/hct_(\d+)_(\d+)s?_(\d+)/);
    if (hctMatch) axleStr = `${hctMatch[1]}+${hctMatch[2]}+${hctMatch[3]}-axle`;
    // Double/b_double: double_3_2 → 3+2, bdouble_2_2 → 2+2
    const dblMatch = t.id.match(/(?:double|bdouble)_(\d+)_(\d+)/);
    if (!hctMatch && dblMatch) axleStr = `${dblMatch[1]}+${dblMatch[2]}-axle`;
  }

  const isLong = t.id.includes('.long') || t.id.includes('_ln.');
  const lengthLabel = isLong ? 'long' : '';

  // Extract meaningful subtype from last ID segment (belly/straight, crane, etc.)
  let subtype = '';
  const lastSeg = idParts[idParts.length - 1];
  if (/belly/.test(lastSeg)) subtype = 'belly';
  else if (/\bstr\b/.test(lastSeg)) subtype = 'straight';
  else if (/brick_crane/.test(lastSeg)) subtype = 'crane';
  else if (/\blight\b/.test(lastSeg)) subtype = 'light';
  else if (/\bsolid\b/.test(lastSeg)) subtype = 'solid';
  else if (/_sh\b/.test(idParts[idParts.length - 2] ?? '')) subtype = 'short';

  const gwt = `${Math.round(t.gross_weight_limit / 1000)}t`;
  const len = `${t.length}m`;

  const parts = [brand, chainLabel, axleStr, lengthLabel, subtype, gwt, len].filter(Boolean);
  return parts.join(' ');
}

/**
 * Total haul value for a trailer: sum of (value × bonus × units) across all compatible cargo.
 * Uses cargo_trailer_units which accounts for both volume and weight limits.
 */
export function trailerTotalHV(t: Trailer, lookups: Lookups): number {
  const cargoes = lookups.trailerCargoMap.get(t.id);
  if (!cargoes) return 0;
  let total = 0;
  for (const cargoId of cargoes) {
    const cargo = lookups.cargoById.get(cargoId);
    if (!cargo || cargo.excluded) continue;
    const units = lookups.cargoTrailerUnits.get(`${cargoId}:${t.id}`) ?? 1;
    const bonus = 1 + (cargo.fragile ? 0.3 : 0) + (cargo.high_value ? 0.3 : 0);
    total += cargo.value * bonus * units;
  }
  return total;
}

/**
 * Pick the best trailer by total haul value across all compatible cargo.
 * Tie-break order: SCS (base game) preferred over DLC, then shorter length.
 */
export function pickBestTrailer(candidates: Trailer[], fallback: Trailer, lookups: Lookups): Trailer {
  if (candidates.length === 0) return fallback;

  let bestTrailer = candidates[0];
  let bestValue = trailerTotalHV(bestTrailer, lookups);
  let bestIsSCS = bestTrailer.id.startsWith('scs.');
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const v = trailerTotalHV(c, lookups);
    if (v > bestValue) {
      bestTrailer = c; bestValue = v; bestIsSCS = c.id.startsWith('scs.');
    } else if (v === bestValue) {
      const cIsSCS = c.id.startsWith('scs.');
      if (cIsSCS && !bestIsSCS) {
        bestTrailer = c; bestIsSCS = true;
      } else if (cIsSCS === bestIsSCS && c.length < bestTrailer.length) {
        bestTrailer = c;
      }
    }
  }
  return bestTrailer;
}

/**
 * Compute chassis-based body type merge map from trailer data.
 * Body types sharing a physical chassis (same trailer ID prefix) merge together.
 * NO transitive merges — only body types on the exact same chassis model merge.
 * When a body type appears on multiple chassis families, it joins the largest group.
 * Returns a map of absorbed_body_type → survivor_body_type.
 */
export function getChassisMergeMap(data: AllData, lookups?: Lookups): Map<string, string> {
  const ownable = getOwnableTrailers(data);

  // Group body types by chassis model (trailer ID minus last segment)
  // e.g. scs.flatbed.single_3 → {flatbed, container, flatbed_brck}
  const chassisBodyTypes = new Map<string, Set<string>>();
  for (const t of ownable) {
    const parts = t.id.split('.');
    if (parts.length < 2) continue;
    const chassis = parts.slice(0, -1).join('.');
    if (!chassisBodyTypes.has(chassis)) chassisBodyTypes.set(chassis, new Set());
    chassisBodyTypes.get(chassis)!.add(t.body_type);
  }

  // Group chassis models by their brand.model prefix (e.g. scs.flatbed, kassbohrer.sll)
  // Each brand.model family defines a set of interchangeable body types
  const familyBodyTypes = new Map<string, Set<string>>();
  for (const [chassis, bodyTypes] of chassisBodyTypes) {
    if (bodyTypes.size <= 1) continue;
    const parts = chassis.split('.');
    const family = parts.slice(0, 2).join('.');
    if (!familyBodyTypes.has(family)) familyBodyTypes.set(family, new Set());
    for (const bt of bodyTypes) familyBodyTypes.get(family)!.add(bt);
  }

  // Count distinct cargo per body type for survivor selection
  const cargoCounts = new Map<string, number>();
  for (const t of ownable) {
    if (cargoCounts.has(t.body_type)) continue;
    const cargoSet = new Set<string>();
    if (lookups) {
      for (const t2 of ownable) {
        if (t2.body_type !== t.body_type) continue;
        const cargo = lookups.trailerCargoMap.get(t2.id);
        if (cargo) for (const c of cargo) cargoSet.add(c);
      }
    }
    cargoCounts.set(t.body_type, cargoSet.size);
  }

  // When a body type appears in multiple families, assign it to the largest family
  // (most body types). This prevents bridging unrelated families.
  const btBestFamily = new Map<string, string>();
  for (const [family, bodyTypes] of familyBodyTypes) {
    for (const bt of bodyTypes) {
      const current = btBestFamily.get(bt);
      if (!current || bodyTypes.size > (familyBodyTypes.get(current)?.size ?? 0)) {
        btBestFamily.set(bt, family);
      }
    }
  }

  // Rebuild family groups with exclusive assignment
  const exclusiveFamilies = new Map<string, Set<string>>();
  for (const [bt, family] of btBestFamily) {
    if (!exclusiveFamilies.has(family)) exclusiveFamilies.set(family, new Set());
    exclusiveFamilies.get(family)!.add(bt);
  }

  // For each family, pick survivor and merge others into it.
  // Prefer the body type matching the chassis family name (e.g. scs.flatbed → flatbed),
  // then fall back to most cargo.
  const mergeMap = new Map<string, string>();
  for (const [family, bodyTypes] of exclusiveFamilies) {
    if (bodyTypes.size <= 1) continue;
    const familyBaseName = family.split('.')[1] || '';
    const members = [...bodyTypes].sort((a, b) => {
      // Body type matching chassis family name wins
      if (a === familyBaseName && b !== familyBaseName) return -1;
      if (b === familyBaseName && a !== familyBaseName) return 1;
      return (cargoCounts.get(b) || 0) - (cargoCounts.get(a) || 0);
    });
    const survivor = members[0];
    for (let i = 1; i < members.length; i++) {
      mergeMap.set(members[i], survivor);
    }
  }

  return mergeMap;
}

export function getBodyTypeProfiles(data: AllData, lookups: Lookups): BodyTypeProfile[] {
  const ownable = getOwnableTrailers(data);

  // Group ownable trailers by body type
  const byBodyType = new Map<string, Trailer[]>();
  for (const t of ownable) {
    const list = byBodyType.get(t.body_type) ?? [];
    list.push(t);
    byBodyType.set(t.body_type, list);
  }

  const profiles: BodyTypeProfile[] = [];

  for (const [bt, trailers] of byBodyType) {
    // Collect all cargo IDs this body type can haul
    const cargoIds = new Set<string>();
    for (const t of trailers) {
      const cargoes = lookups.trailerCargoMap.get(t.id);
      if (cargoes) {
        for (const c of cargoes) cargoIds.add(c);
      }
    }
    if (cargoIds.size === 0) continue;

    // Pick absolute best trailer across all chain types by totalHV
    const best = pickBestTrailer(trailers, trailers[0], lookups);
    const bestHV = trailerTotalHV(best, lookups);

    // Check doubles/b-doubles/HCT availability from country_validity
    const doublesSet = new Set<string>();
    const bdoublesSet = new Set<string>();
    const hctSet = new Set<string>();
    for (const t of trailers) {
      if (!t.country_validity) continue;
      if (t.id.includes('hct')) {
        for (const c of t.country_validity) hctSet.add(c);
      } else if (t.id.includes('bdouble')) {
        for (const c of t.country_validity) { bdoublesSet.add(c); doublesSet.add(c); }
      } else if (t.id.includes('double')) {
        for (const c of t.country_validity) { doublesSet.add(c); }
      }
    }

    const displayName = bt.charAt(0).toUpperCase() + bt.slice(1).replace(/_/g, ' ');

    profiles.push({
      bodyType: bt,
      displayName,
      cargoIds,
      cargoCount: cargoIds.size,
      bestTrailerId: best.id,
      bestTrailerName: formatTrailerSpec(best),
      bestTotalHV: bestHV,
      bestChainType: best.chain_type || 'single',
      bestCountries: best.country_validity ?? [],
      hasDoubles: doublesSet.size > 0,
      hasBDoubles: bdoublesSet.size > 0,
      hasHCT: hctSet.size > 0,
      doublesCountries: [...doublesSet].sort(),
      bdoublesCountries: [...bdoublesSet].sort(),
      hctCountries: [...hctSet].sort(),
      dominatedBy: null,
    });
  }

  // Merge body types that share a physical chassis family.
  // Uses getChassisMergeMap for consistent merge logic across the codebase.
  const chassisMerges = getChassisMergeMap(data, lookups);

  // Group by survivor
  const mergeGroups = new Map<string, string[]>();
  for (const [absorbed, survivor] of chassisMerges) {
    if (!mergeGroups.has(survivor)) mergeGroups.set(survivor, []);
    mergeGroups.get(survivor)!.push(absorbed);
  }

  for (const [survivorBT, absorbedBTs] of mergeGroups) {
    const survivorIdx = profiles.findIndex((p) => p.bodyType === survivorBT);
    if (survivorIdx < 0) continue;
    const survivor = profiles[survivorIdx];

    const toRemoveIndices: number[] = [];
    for (const absorbedBT of absorbedBTs) {
      const absIdx = profiles.findIndex((p) => p.bodyType === absorbedBT);
      if (absIdx < 0) continue;
      const src = profiles[absIdx];

      for (const c of src.cargoIds) survivor.cargoIds.add(c);
      if (src.hasDoubles) {
        survivor.hasDoubles = true;
        for (const c of src.doublesCountries) {
          if (!survivor.doublesCountries.includes(c)) survivor.doublesCountries.push(c);
        }
      }
      if (src.hasBDoubles) {
        survivor.hasBDoubles = true;
        for (const c of src.bdoublesCountries) {
          if (!survivor.bdoublesCountries.includes(c)) survivor.bdoublesCountries.push(c);
        }
      }
      if (src.hasHCT) {
        survivor.hasHCT = true;
        for (const c of src.hctCountries) {
          if (!survivor.hctCountries.includes(c)) survivor.hctCountries.push(c);
        }
      }
      toRemoveIndices.push(absIdx);
    }

    survivor.cargoCount = survivor.cargoIds.size;
    survivor.doublesCountries.sort();
    survivor.bdoublesCountries.sort();
    survivor.hctCountries.sort();
    survivor.displayName = survivor.displayName
      + ' (+' + absorbedBTs.map((bt) => bt.replace(/_/g, ' ')).join(', ') + ')';

    // Remove absorbed profiles (reverse order to preserve indices)
    toRemoveIndices.sort((a, b) => b - a);
    for (const idx of toRemoveIndices) profiles.splice(idx, 1);
  }

  // Detect dominated body types: A is dominated if A's cargo ⊂ B's cargo (strict subset).
  // Pick smallest dominator (most specific superset) for the label.
  for (const a of profiles) {
    let bestDominator: BodyTypeProfile | null = null;
    for (const b of profiles) {
      if (a === b) continue;
      if (b.cargoCount <= a.cargoCount) continue;
      let isSubset = true;
      for (const c of a.cargoIds) {
        if (!b.cargoIds.has(c)) { isSubset = false; break; }
      }
      if (isSubset && (!bestDominator || b.cargoCount < bestDominator.cargoCount)) {
        bestDominator = b;
      }
    }
    if (bestDominator) {
      a.dominatedBy = bestDominator.bodyType;
    }
  }

  // Sort by totalHV descending (earning potential)
  profiles.sort((a, b) => b.bestTotalHV - a.bestTotalHV);
  return profiles;
}
