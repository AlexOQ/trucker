/**
 * Data loader for ETS2 Trucker Advisor
 * Loads and caches JSON data files
 */

export interface City {
  id: number;
  name: string;
  country: string;
}

export interface Company {
  id: number;
  name: string;
}

export interface Cargo {
  id: number;
  name: string;
  value: number;
  fragile?: boolean;
  high_value?: boolean;
  excluded?: boolean;
}

export interface Trailer {
  id: number;
  name: string;
  ownable: boolean;
}

export interface CityCompany {
  cityId: number;
  companyId: number;
  count: number;
}

export interface CompanyCargo {
  companyId: number;
  cargoId: number;
}

export interface CargoTrailer {
  cargoId: number;
  trailerId: number;
}

export interface AllData {
  cities: City[];
  companies: Company[];
  cargo: Cargo[];
  trailers: Trailer[];
  cityCompanies: CityCompany[];
  companyCargo: CompanyCargo[];
  cargoTrailers: CargoTrailer[];
}

export interface Lookups {
  citiesById: Map<number, City>;
  companiesById: Map<number, Company>;
  cargoById: Map<number, Cargo>;
  trailersById: Map<number, Trailer>;
  cityCompanyMap: Map<number, Array<{ companyId: number; count: number }>>;
  companyCargoMap: Map<number, number[]>;
  trailerCargoMap: Map<number, Set<number>>;
  cargoTrailerMap: Map<number, Set<number>>;
}

export interface CargoPoolEntry {
  companyId: number;
  depotCount: number;
  cargoId: number;
  cargoName: string;
  value: number;
}

const dataCache: Record<string, any> = {};

async function loadJson(filename: string): Promise<any> {
  if (dataCache[filename]) {
    return dataCache[filename];
  }
  const response = await fetch(`data/${filename}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  dataCache[filename] = data;
  return data;
}

export async function loadAllData(): Promise<AllData> {
  const [cities, companies, cargo, trailers, cityCompanies, companyCargo, cargoTrailers] = await Promise.all([
    loadJson('cities.json'),
    loadJson('companies.json'),
    loadJson('cargo.json'),
    loadJson('trailers.json'),
    loadJson('city-companies.json'),
    loadJson('company-cargo.json'),
    loadJson('cargo-trailers.json'),
  ]);

  return {
    cities,
    companies,
    cargo,
    trailers,
    cityCompanies,
    companyCargo,
    cargoTrailers,
  };
}

// Build lookup maps for efficient access
export function buildLookups(data: AllData): Lookups {
  const citiesById = new Map(data.cities.map((c) => [c.id, c]));
  const companiesById = new Map(data.companies.map((c) => [c.id, c]));
  const cargoById = new Map(data.cargo.map((c) => [c.id, c]));
  const trailersById = new Map(data.trailers.map((t) => [t.id, t]));

  // City -> [{ companyId, count }]
  const cityCompanyMap = new Map<number, Array<{ companyId: number; count: number }>>();
  for (const cc of data.cityCompanies) {
    if (!cityCompanyMap.has(cc.cityId)) {
      cityCompanyMap.set(cc.cityId, []);
    }
    cityCompanyMap.get(cc.cityId)!.push({ companyId: cc.companyId, count: cc.count });
  }

  // Company -> [cargoId]
  const companyCargoMap = new Map<number, number[]>();
  for (const cc of data.companyCargo) {
    if (!companyCargoMap.has(cc.companyId)) {
      companyCargoMap.set(cc.companyId, []);
    }
    companyCargoMap.get(cc.companyId)!.push(cc.cargoId);
  }

  // Trailer -> Set<cargoId>
  const trailerCargoMap = new Map<number, Set<number>>();
  for (const ct of data.cargoTrailers) {
    if (!trailerCargoMap.has(ct.trailerId)) {
      trailerCargoMap.set(ct.trailerId, new Set());
    }
    trailerCargoMap.get(ct.trailerId)!.add(ct.cargoId);
  }

  // Cargo -> Set<trailerId>
  const cargoTrailerMap = new Map<number, Set<number>>();
  for (const ct of data.cargoTrailers) {
    if (!cargoTrailerMap.has(ct.cargoId)) {
      cargoTrailerMap.set(ct.cargoId, new Set());
    }
    cargoTrailerMap.get(ct.cargoId)!.add(ct.trailerId);
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
  };
}

// Get cargo pool for a city (with depot count multiplicity)
export function getCityCargoPool(cityId: number, data: AllData, lookups: Lookups): CargoPoolEntry[] {
  const pool: CargoPoolEntry[] = [];
  const cityCompanies = lookups.cityCompanyMap.get(cityId) || [];

  for (const { companyId, count } of cityCompanies) {
    const cargoIds = lookups.companyCargoMap.get(companyId) || [];
    for (const cargoId of cargoIds) {
      const cargo = lookups.cargoById.get(cargoId);
      if (cargo && !cargo.excluded) {
        // Apply 30% bonus for fragile and/or high_value cargo
        const multiplier = 1 + (cargo.fragile ? 0.3 : 0) + (cargo.high_value ? 0.3 : 0);
        pool.push({
          companyId,
          depotCount: count,
          cargoId,
          cargoName: cargo.name,
          value: cargo.value * multiplier,
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
