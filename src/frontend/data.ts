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
  bestTrailerId: string;     // standard ownable trailer with max volume
  bestTrailerName: string;
  hasDoubles: boolean;
  hasHCT: boolean;
  doublesCountries: string[];
  hctCountries: string[];
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
function formatTrailerSpec(t: Trailer): string {
  const idParts = t.id.split('.');
  const brandRaw = idParts[0];
  const brand = brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1);

  // Extract axle count from ID. Only the first digit(s) after "single_" are axles.
  // Special case: "41" = 4+1 axle (lowbed/lowboy), "4_1" = 4+1 axle (lowboy)
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
  }

  const isLong = t.id.includes('.long') || t.id.includes('_ln.');
  const lengthLabel = isLong ? 'long' : '';

  const gwt = `${Math.round(t.gross_weight_limit / 1000)}t`;
  const len = `${t.length}m`;

  const parts = [brand, axleStr, lengthLabel, gwt, len].filter(Boolean);
  return parts.join(' ');
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

    // Pick best standard trailer: max GWL → max volume → max length
    // This ensures we recommend the trailer that covers ALL cargo in the body type
    const standards = trailers.filter(
      (t) => !t.id.includes('hct') && !t.id.includes('double') && !t.id.includes('bdouble')
        && (!t.country_validity || t.country_validity.length === 0)
    );
    let best = standards[0] ?? trailers[0];
    for (const t of standards) {
      if (t.gross_weight_limit > best.gross_weight_limit) best = t;
      else if (t.gross_weight_limit === best.gross_weight_limit && t.volume > best.volume) best = t;
      else if (t.gross_weight_limit === best.gross_weight_limit && t.volume === best.volume && t.length > best.length) best = t;
    }

    // Check doubles/HCT availability
    const doublesSet = new Set<string>();
    const hctSet = new Set<string>();
    for (const t of trailers) {
      if (t.id.includes('hct') && t.country_validity) {
        for (const c of t.country_validity) hctSet.add(c);
      } else if ((t.id.includes('double') || t.id.includes('bdouble')) && t.country_validity) {
        for (const c of t.country_validity) doublesSet.add(c);
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
      hasDoubles: doublesSet.size > 0,
      hasHCT: hctSet.size > 0,
      doublesCountries: [...doublesSet].sort(),
      hctCountries: [...hctSet].sort(),
    });
  }

  // Sort by cargo count descending
  profiles.sort((a, b) => b.cargoCount - a.cargoCount);
  return profiles;
}
