import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Dynamic import after mocking
const data = await import('../data.ts');

// Sample observations (mirrors observations.json structure)
const sampleObservations = {
  meta: { saves_parsed: 1, total_jobs: 100 },
  cities: ['berlin', 'paris'],
  companies: ['eurogoodies', 'posped'],
  cargo: ['electronics', 'glass', 'excluded_cargo', 'premium_glass'],
  trailers: ['curtainsider', 'refrigerated', 'special_trailer'],
  city_companies: {
    berlin: { eurogoodies: 2, posped: 1 },
    paris: { eurogoodies: 1 },
  },
  company_cargo: {
    eurogoodies: ['electronics', 'glass'],
    posped: ['excluded_cargo', 'premium_glass'],
  },
  cargo_trailers: {
    electronics: ['curtainsider', 'refrigerated'],
    glass: ['curtainsider'],
    premium_glass: ['refrigerated'],
  },
  cargo_frequency: {
    electronics: 10,
    glass: 10,
    excluded_cargo: 10,
    premium_glass: 10,
  },
  cargo_spawn_weight: {},
  cargo_trailer_units: {},
  company_cargo_frequency: {},
};

// Build AllData from observations only (no game defs)
function buildAllData(obs = sampleObservations) {
  const titleCase = (id: string) =>
    id
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  return {
    gameDefs: null,
    observations: obs,
    cities: obs.cities.map((id) => ({
      id,
      name: titleCase(id),
      country: '',
    })),
    companies: obs.companies.map((id) => ({
      id,
      name: titleCase(id),
    })),
    cargo: obs.cargo.map((id) => ({
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
      body_types: [] as string[],
      groups: [] as string[],
      excluded: false,
    })),
    trailers: obs.trailers.map((id) => ({
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
    })),
  };
}

function createFetchResponse(responseData: any, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(responseData),
  });
}

describe('data.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadAllData', () => {
    it('loads observations-only and returns combined object', async () => {
      // First fetch: game-defs.json returns 404
      // Second fetch: observations.json returns data
      fetchMock
        .mockResolvedValueOnce(createFetchResponse(null, false, 404))
        .mockResolvedValueOnce(createFetchResponse(sampleObservations));

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('../data.ts');
      const result = await freshData.loadAllData();

      expect(result.observations).toEqual(sampleObservations);
      expect(result.gameDefs).toBeNull();
      expect(result.cities).toHaveLength(2);
      expect(result.cities[0]).toEqual({ id: 'berlin', name: 'Berlin', country: '' });
      expect(result.companies).toHaveLength(2);
      expect(result.cargo).toHaveLength(4);
      expect(result.trailers).toHaveLength(3);
    });

    it('throws error when both sources fail', async () => {
      fetchMock
        .mockResolvedValueOnce(createFetchResponse(null, false, 404))
        .mockResolvedValueOnce(createFetchResponse(null, false, 404));

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('../data.ts');

      await expect(freshData.loadAllData()).rejects.toThrow('No data sources available');
    });

    it('caches loaded data and does not refetch', async () => {
      fetchMock
        .mockResolvedValueOnce(createFetchResponse(null, false, 404))
        .mockResolvedValueOnce(createFetchResponse(sampleObservations));

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('../data.ts');

      await freshData.loadAllData();
      expect(fetchMock).toHaveBeenCalledTimes(2); // game-defs + observations

      // Second call should use cache
      await freshData.loadAllData();
      expect(fetchMock).toHaveBeenCalledTimes(2); // No additional calls
    });

    it('all cargo gets default value 1.0 and no flags (observations only)', async () => {
      fetchMock
        .mockResolvedValueOnce(createFetchResponse(null, false, 404))
        .mockResolvedValueOnce(createFetchResponse(sampleObservations));

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('../data.ts');
      const result = await freshData.loadAllData();

      for (const cargo of result.cargo) {
        expect(cargo.value).toBe(1.0);
        expect(cargo.fragile).toBe(false);
        expect(cargo.high_value).toBe(false);
        expect(cargo.excluded).toBe(false);
      }
    });

    it('all trailers are ownable by default (observations only)', async () => {
      fetchMock
        .mockResolvedValueOnce(createFetchResponse(null, false, 404))
        .mockResolvedValueOnce(createFetchResponse(sampleObservations));

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('../data.ts');
      const result = await freshData.loadAllData();

      for (const trailer of result.trailers) {
        expect(trailer.ownable).toBe(true);
      }
    });

    it('uses titleCase for all names (observations only)', async () => {
      fetchMock
        .mockResolvedValueOnce(createFetchResponse(null, false, 404))
        .mockResolvedValueOnce(createFetchResponse(sampleObservations));

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('../data.ts');
      const result = await freshData.loadAllData();

      expect(result.cities[0].name).toBe('Berlin');
      expect(result.companies[0].name).toBe('Eurogoodies');
      expect(result.cargo[2].name).toBe('Excluded Cargo');
      expect(result.trailers[2].name).toBe('Special Trailer');
    });
  });

  describe('buildLookups', () => {
    const testData = buildAllData();

    it('creates citiesById map correctly', () => {
      const lookups = data.buildLookups(testData);

      expect(lookups.citiesById.get('berlin')).toEqual({ id: 'berlin', name: 'Berlin', country: '' });
      expect(lookups.citiesById.get('paris')).toEqual({ id: 'paris', name: 'Paris', country: '' });
      expect(lookups.citiesById.get('unknown')).toBeUndefined();
    });

    it('creates companiesById map correctly', () => {
      const lookups = data.buildLookups(testData);

      expect(lookups.companiesById.get('eurogoodies')).toEqual({ id: 'eurogoodies', name: 'Eurogoodies' });
      expect(lookups.companiesById.get('posped')).toEqual({ id: 'posped', name: 'Posped' });
    });

    it('creates cargoById map correctly', () => {
      const lookups = data.buildLookups(testData);

      expect(lookups.cargoById.get('electronics')!.name).toBe('Electronics');
      expect(lookups.cargoById.get('glass')!.name).toBe('Glass');
      expect(lookups.cargoById.size).toBe(4);
    });

    it('creates trailersById map correctly', () => {
      const lookups = data.buildLookups(testData);

      expect(lookups.trailersById.get('curtainsider')!.name).toBe('Curtainsider');
      expect(lookups.trailersById.get('special_trailer')!.ownable).toBe(true);
    });

    it('creates cityCompanyMap with company counts', () => {
      const lookups = data.buildLookups(testData);

      const berlinCompanies = lookups.cityCompanyMap.get('berlin');
      expect(berlinCompanies).toHaveLength(2);
      expect(berlinCompanies).toContainEqual({ companyId: 'eurogoodies', count: 2 });
      expect(berlinCompanies).toContainEqual({ companyId: 'posped', count: 1 });

      const parisCompanies = lookups.cityCompanyMap.get('paris');
      expect(parisCompanies).toHaveLength(1);
      expect(parisCompanies![0]).toEqual({ companyId: 'eurogoodies', count: 1 });
    });

    it('creates companyCargoMap correctly', () => {
      const lookups = data.buildLookups(testData);

      const euroGoodiesCargo = lookups.companyCargoMap.get('eurogoodies');
      expect(euroGoodiesCargo).toContain('electronics');
      expect(euroGoodiesCargo).toContain('glass');

      const pospedCargo = lookups.companyCargoMap.get('posped');
      expect(pospedCargo).toContain('excluded_cargo');
      expect(pospedCargo).toContain('premium_glass');
    });

    it('creates trailerCargoMap as Set', () => {
      const lookups = data.buildLookups(testData);

      const curtainsiderCargo = lookups.trailerCargoMap.get('curtainsider');
      expect(curtainsiderCargo).toBeInstanceOf(Set);
      expect(curtainsiderCargo!.has('electronics')).toBe(true);
      expect(curtainsiderCargo!.has('glass')).toBe(true);

      const refrigeratedCargo = lookups.trailerCargoMap.get('refrigerated');
      expect(refrigeratedCargo!.has('electronics')).toBe(true);
      expect(refrigeratedCargo!.has('premium_glass')).toBe(true);
    });

    it('creates cargoTrailerMap as Set', () => {
      const lookups = data.buildLookups(testData);

      const electronicsTrailers = lookups.cargoTrailerMap.get('electronics');
      expect(electronicsTrailers).toBeInstanceOf(Set);
      expect(electronicsTrailers!.has('curtainsider')).toBe(true);
      expect(electronicsTrailers!.has('refrigerated')).toBe(true);

      const glassTrailers = lookups.cargoTrailerMap.get('glass');
      expect(glassTrailers!.has('curtainsider')).toBe(true);
      expect(glassTrailers!.size).toBe(1);
    });

    it('handles empty observations', () => {
      const emptyObs = {
        ...sampleObservations,
        cities: [],
        companies: [],
        cargo: [],
        trailers: [],
        city_companies: {},
        company_cargo: {},
        cargo_trailers: {},
        cargo_frequency: {},
        company_cargo_frequency: {},
      };
      const emptyData = buildAllData(emptyObs);
      const lookups = data.buildLookups(emptyData);

      expect(lookups.citiesById.size).toBe(0);
      expect(lookups.companiesById.size).toBe(0);
      expect(lookups.cargoById.size).toBe(0);
      expect(lookups.trailersById.size).toBe(0);
      expect(lookups.cityCompanyMap.size).toBe(0);
      expect(lookups.companyCargoMap.size).toBe(0);
      expect(lookups.trailerCargoMap.size).toBe(0);
      expect(lookups.cargoTrailerMap.size).toBe(0);
    });
  });

  describe('getCityCargoPool', () => {
    it('returns cargo pool for a city with uniform values', () => {
      const testData = buildAllData();
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool('berlin', testData, lookups);

      // Berlin has EuroGoodies (count 2) with Electronics and Glass
      // and Posped (count 1) with Excluded Cargo and Premium Glass
      expect(pool.length).toBe(4);

      const cargoNames = pool.map((p) => p.cargoName);
      expect(cargoNames).toContain('Electronics');
      expect(cargoNames).toContain('Glass');
      expect(cargoNames).toContain('Excluded Cargo');
      expect(cargoNames).toContain('Premium Glass');
    });

    it('all pool entries have value 1.0 (no fragile/high_value bonuses)', () => {
      const testData = buildAllData();
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool('berlin', testData, lookups);

      for (const entry of pool) {
        expect(entry.value).toBe(1.0);
      }
    });

    it('includes depot count in pool entries', () => {
      const testData = buildAllData();
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool('berlin', testData, lookups);

      const electronics = pool.find((p) => p.cargoName === 'Electronics');
      expect(electronics!.depotCount).toBe(2);

      const premiumGlass = pool.find((p) => p.cargoName === 'Premium Glass');
      expect(premiumGlass!.depotCount).toBe(1);
    });

    it('returns empty array for city with no companies', () => {
      const testData = buildAllData();
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool('unknown_city', testData, lookups);

      expect(pool).toEqual([]);
    });

    it('returns empty array for city with companies but no cargo', () => {
      const obsNoCargo = {
        ...sampleObservations,
        company_cargo: {},
      };
      const noCargo = buildAllData(obsNoCargo);
      const lookups = data.buildLookups(noCargo);
      const pool = data.getCityCargoPool('berlin', noCargo, lookups);

      expect(pool).toEqual([]);
    });

    it('uses prob_coef as spawnWeight', () => {
      const testData = buildAllData();
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool('berlin', testData, lookups);

      const electronics = pool.find((p) => p.cargoName === 'Electronics');
      const glass = pool.find((p) => p.cargoName === 'Glass');
      // spawnWeight = prob_coef (default 1.0 for all mock cargo)
      expect(electronics!.spawnWeight).toBe(1);
      expect(glass!.spawnWeight).toBe(1);
    });
  });

  describe('getOwnableTrailers', () => {
    it('returns all trailers (all ownable by default)', () => {
      const testData = buildAllData();
      const ownable = data.getOwnableTrailers(testData);

      expect(ownable).toHaveLength(3);
      expect(ownable.every((t) => t.ownable)).toBe(true);
    });
  });
});
