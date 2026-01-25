import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Dynamic import after mocking
const data = await import('./data.js');

// Sample test data
const sampleCities = [
  { id: 1, name: 'Berlin', country: 'Germany' },
  { id: 2, name: 'Paris', country: 'France' },
];

const sampleCompanies = [
  { id: 1, name: 'EuroGoodies' },
  { id: 2, name: 'Posped' },
];

const sampleCargo = [
  { id: 1, name: 'Electronics', value: 100, fragile: false, high_value: true, excluded: false },
  { id: 2, name: 'Glass', value: 80, fragile: true, high_value: false, excluded: false },
  { id: 3, name: 'Excluded Cargo', value: 50, fragile: false, high_value: false, excluded: true },
  { id: 4, name: 'Premium Glass', value: 120, fragile: true, high_value: true, excluded: false },
];

const sampleTrailers = [
  { id: 1, name: 'Curtainsider', ownable: true },
  { id: 2, name: 'Refrigerated', ownable: true },
  { id: 3, name: 'Special Trailer', ownable: false },
];

const sampleCityCompanies = [
  { cityId: 1, companyId: 1, count: 2 },
  { cityId: 1, companyId: 2, count: 1 },
  { cityId: 2, companyId: 1, count: 1 },
];

const sampleCompanyCargo = [
  { companyId: 1, cargoId: 1 },
  { companyId: 1, cargoId: 2 },
  { companyId: 2, cargoId: 3 },
  { companyId: 2, cargoId: 4 },
];

const sampleCargoTrailers = [
  { cargoId: 1, trailerId: 1 },
  { cargoId: 1, trailerId: 2 },
  { cargoId: 2, trailerId: 1 },
  { cargoId: 4, trailerId: 2 },
];

function createFetchResponse(data, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

describe('data.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module cache by clearing dataCache (if accessible)
    // Since dataCache is internal, we reload the module for fresh state
  });

  describe('loadAllData', () => {
    it('loads all data files and returns combined object', async () => {
      fetchMock
        .mockResolvedValueOnce(createFetchResponse(sampleCities))
        .mockResolvedValueOnce(createFetchResponse(sampleCompanies))
        .mockResolvedValueOnce(createFetchResponse(sampleCargo))
        .mockResolvedValueOnce(createFetchResponse(sampleTrailers))
        .mockResolvedValueOnce(createFetchResponse(sampleCityCompanies))
        .mockResolvedValueOnce(createFetchResponse(sampleCompanyCargo))
        .mockResolvedValueOnce(createFetchResponse(sampleCargoTrailers));

      // Need fresh import to test without cache
      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('./data.js');
      const result = await freshData.loadAllData();

      expect(result.cities).toEqual(sampleCities);
      expect(result.companies).toEqual(sampleCompanies);
      expect(result.cargo).toEqual(sampleCargo);
      expect(result.trailers).toEqual(sampleTrailers);
      expect(result.cityCompanies).toEqual(sampleCityCompanies);
      expect(result.companyCargo).toEqual(sampleCompanyCargo);
      expect(result.cargoTrailers).toEqual(sampleCargoTrailers);
      expect(fetchMock).toHaveBeenCalledTimes(7);
    });

    it('throws error on HTTP failure', async () => {
      fetchMock.mockResolvedValueOnce(createFetchResponse(null, false, 404));

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('./data.js');

      await expect(freshData.loadAllData()).rejects.toThrow('HTTP 404');
    });

    it('throws error on network failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('./data.js');

      await expect(freshData.loadAllData()).rejects.toThrow('Network error');
    });

    it('throws error on malformed JSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('./data.js');

      await expect(freshData.loadAllData()).rejects.toThrow();
    });

    it('caches loaded data and does not refetch', async () => {
      fetchMock
        .mockResolvedValueOnce(createFetchResponse(sampleCities))
        .mockResolvedValueOnce(createFetchResponse(sampleCompanies))
        .mockResolvedValueOnce(createFetchResponse(sampleCargo))
        .mockResolvedValueOnce(createFetchResponse(sampleTrailers))
        .mockResolvedValueOnce(createFetchResponse(sampleCityCompanies))
        .mockResolvedValueOnce(createFetchResponse(sampleCompanyCargo))
        .mockResolvedValueOnce(createFetchResponse(sampleCargoTrailers));

      vi.resetModules();
      vi.stubGlobal('fetch', fetchMock);
      const freshData = await import('./data.js');

      // First call
      await freshData.loadAllData();
      expect(fetchMock).toHaveBeenCalledTimes(7);

      // Second call should use cache
      await freshData.loadAllData();
      expect(fetchMock).toHaveBeenCalledTimes(7); // No additional calls
    });
  });

  describe('buildLookups', () => {
    const testData = {
      cities: sampleCities,
      companies: sampleCompanies,
      cargo: sampleCargo,
      trailers: sampleTrailers,
      cityCompanies: sampleCityCompanies,
      companyCargo: sampleCompanyCargo,
      cargoTrailers: sampleCargoTrailers,
    };

    it('creates citiesById map correctly', () => {
      const lookups = data.buildLookups(testData);

      expect(lookups.citiesById.get(1)).toEqual({ id: 1, name: 'Berlin', country: 'Germany' });
      expect(lookups.citiesById.get(2)).toEqual({ id: 2, name: 'Paris', country: 'France' });
      expect(lookups.citiesById.get(999)).toBeUndefined();
    });

    it('creates companiesById map correctly', () => {
      const lookups = data.buildLookups(testData);

      expect(lookups.companiesById.get(1)).toEqual({ id: 1, name: 'EuroGoodies' });
      expect(lookups.companiesById.get(2)).toEqual({ id: 2, name: 'Posped' });
    });

    it('creates cargoById map correctly', () => {
      const lookups = data.buildLookups(testData);

      expect(lookups.cargoById.get(1).name).toBe('Electronics');
      expect(lookups.cargoById.get(2).name).toBe('Glass');
      expect(lookups.cargoById.size).toBe(4);
    });

    it('creates trailersById map correctly', () => {
      const lookups = data.buildLookups(testData);

      expect(lookups.trailersById.get(1).name).toBe('Curtainsider');
      expect(lookups.trailersById.get(3).ownable).toBe(false);
    });

    it('creates cityCompanyMap with company counts', () => {
      const lookups = data.buildLookups(testData);

      const berlinCompanies = lookups.cityCompanyMap.get(1);
      expect(berlinCompanies).toHaveLength(2);
      expect(berlinCompanies).toContainEqual({ companyId: 1, count: 2 });
      expect(berlinCompanies).toContainEqual({ companyId: 2, count: 1 });

      const parisCompanies = lookups.cityCompanyMap.get(2);
      expect(parisCompanies).toHaveLength(1);
      expect(parisCompanies[0]).toEqual({ companyId: 1, count: 1 });
    });

    it('creates companyCargoMap correctly', () => {
      const lookups = data.buildLookups(testData);

      const euroGoodiesCargo = lookups.companyCargoMap.get(1);
      expect(euroGoodiesCargo).toContain(1);
      expect(euroGoodiesCargo).toContain(2);

      const pospedCargo = lookups.companyCargoMap.get(2);
      expect(pospedCargo).toContain(3);
      expect(pospedCargo).toContain(4);
    });

    it('creates trailerCargoMap as Set', () => {
      const lookups = data.buildLookups(testData);

      const curtainsiderCargo = lookups.trailerCargoMap.get(1);
      expect(curtainsiderCargo).toBeInstanceOf(Set);
      expect(curtainsiderCargo.has(1)).toBe(true);
      expect(curtainsiderCargo.has(2)).toBe(true);

      const refrigeratedCargo = lookups.trailerCargoMap.get(2);
      expect(refrigeratedCargo.has(1)).toBe(true);
      expect(refrigeratedCargo.has(4)).toBe(true);
    });

    it('creates cargoTrailerMap as Set', () => {
      const lookups = data.buildLookups(testData);

      const electronicsTrailers = lookups.cargoTrailerMap.get(1);
      expect(electronicsTrailers).toBeInstanceOf(Set);
      expect(electronicsTrailers.has(1)).toBe(true);
      expect(electronicsTrailers.has(2)).toBe(true);

      const glassTrailers = lookups.cargoTrailerMap.get(2);
      expect(glassTrailers.has(1)).toBe(true);
      expect(glassTrailers.size).toBe(1);
    });

    it('handles empty data arrays', () => {
      const emptyData = {
        cities: [],
        companies: [],
        cargo: [],
        trailers: [],
        cityCompanies: [],
        companyCargo: [],
        cargoTrailers: [],
      };

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
    const testData = {
      cities: sampleCities,
      companies: sampleCompanies,
      cargo: sampleCargo,
      trailers: sampleTrailers,
      cityCompanies: sampleCityCompanies,
      companyCargo: sampleCompanyCargo,
      cargoTrailers: sampleCargoTrailers,
    };

    it('returns cargo pool for a city', () => {
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool(1, testData, lookups);

      // Berlin has EuroGoodies (count 2) with Electronics and Glass
      // and Posped (count 1) with Excluded Cargo and Premium Glass
      // Excluded cargo should not appear
      expect(pool.length).toBe(3); // Electronics, Glass, Premium Glass

      const cargoNames = pool.map((p) => p.cargoName);
      expect(cargoNames).toContain('Electronics');
      expect(cargoNames).toContain('Glass');
      expect(cargoNames).toContain('Premium Glass');
      expect(cargoNames).not.toContain('Excluded Cargo');
    });

    it('excludes cargo marked as excluded', () => {
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool(1, testData, lookups);

      const excludedCargo = pool.find((p) => p.cargoName === 'Excluded Cargo');
      expect(excludedCargo).toBeUndefined();
    });

    it('applies 30% bonus for high_value cargo', () => {
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool(1, testData, lookups);

      const electronics = pool.find((p) => p.cargoName === 'Electronics');
      // Electronics: value 100, high_value=true -> 100 * 1.3 = 130
      expect(electronics.value).toBe(130);
    });

    it('applies 30% bonus for fragile cargo', () => {
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool(1, testData, lookups);

      const glass = pool.find((p) => p.cargoName === 'Glass');
      // Glass: value 80, fragile=true -> 80 * 1.3 = 104
      expect(glass.value).toBe(104);
    });

    it('stacks bonuses for fragile AND high_value cargo (60%)', () => {
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool(1, testData, lookups);

      const premiumGlass = pool.find((p) => p.cargoName === 'Premium Glass');
      // Premium Glass: value 120, fragile=true, high_value=true -> 120 * 1.6 = 192
      expect(premiumGlass.value).toBe(192);
    });

    it('includes depot count in pool entries', () => {
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool(1, testData, lookups);

      // EuroGoodies has count 2 in Berlin
      const electronics = pool.find((p) => p.cargoName === 'Electronics');
      expect(electronics.depotCount).toBe(2);

      // Posped has count 1 in Berlin
      const premiumGlass = pool.find((p) => p.cargoName === 'Premium Glass');
      expect(premiumGlass.depotCount).toBe(1);
    });

    it('returns empty array for city with no companies', () => {
      const lookups = data.buildLookups(testData);
      const pool = data.getCityCargoPool(999, testData, lookups);

      expect(pool).toEqual([]);
    });

    it('returns empty array for city with companies but no cargo', () => {
      const dataWithEmptyCargo = {
        ...testData,
        companyCargo: [],
      };
      const lookups = data.buildLookups(dataWithEmptyCargo);
      const pool = data.getCityCargoPool(1, dataWithEmptyCargo, lookups);

      expect(pool).toEqual([]);
    });
  });

  describe('getOwnableTrailers', () => {
    const testData = {
      trailers: sampleTrailers,
    };

    it('returns only ownable trailers', () => {
      const ownable = data.getOwnableTrailers(testData);

      expect(ownable).toHaveLength(2);
      expect(ownable.every((t) => t.ownable)).toBe(true);
    });

    it('excludes non-ownable trailers', () => {
      const ownable = data.getOwnableTrailers(testData);

      const specialTrailer = ownable.find((t) => t.name === 'Special Trailer');
      expect(specialTrailer).toBeUndefined();
    });

    it('returns empty array when no trailers are ownable', () => {
      const dataWithNoOwnable = {
        trailers: [
          { id: 1, name: 'Trailer A', ownable: false },
          { id: 2, name: 'Trailer B', ownable: false },
        ],
      };

      const ownable = data.getOwnableTrailers(dataWithNoOwnable);
      expect(ownable).toEqual([]);
    });

    it('returns all trailers when all are ownable', () => {
      const dataWithAllOwnable = {
        trailers: [
          { id: 1, name: 'Trailer A', ownable: true },
          { id: 2, name: 'Trailer B', ownable: true },
        ],
      };

      const ownable = data.getOwnableTrailers(dataWithAllOwnable);
      expect(ownable).toHaveLength(2);
    });
  });
});
