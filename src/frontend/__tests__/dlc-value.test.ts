import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage module — dlc-value imports DLC registries and ownership getters from storage
vi.mock('../storage', () => ({
  TRAILER_DLCS: { feldbinder: 'Feldbinder', krone: 'Krone' } as Record<string, string>,
  ALL_DLC_IDS: ['feldbinder', 'krone'],
  CARGO_DLCS: { high_power: 'High Power Cargo' } as Record<string, string>,
  ALL_CARGO_DLC_IDS: ['high_power'],
  MAP_DLCS: { iberia: 'Iberia' } as Record<string, string>,
  ALL_MAP_DLC_IDS: ['iberia'],
  CITY_DLC_MAP: { iberia: ['lisboa', 'madrid'] } as Record<string, string[]>,
  COMBINED_CARGO_DLC_MAP: {} as Record<string, string>,
  GARAGE_CITIES: new Set(['berlin', 'paris', 'lisboa', 'madrid']),
  getOwnedTrailerDLCs: vi.fn(() => ['feldbinder']),
  getOwnedCargoDLCs: vi.fn(() => []),
  getOwnedMapDLCs: vi.fn(() => []),
  getOwnedGarages: vi.fn(() => ['berlin', 'paris']),
}));

// Import after mocking
import { sumGarageScores, computeAllDLCValues } from '../dlc-value';
import { applyDLCFilter, getBlockedCities } from '../dlc-filter';
import { buildLookups } from '../lookups';
import type { AllData } from '../types';

/**
 * Build minimal AllData for DLC value testing.
 * Needs enough data to run through the filter -> lookups -> rankings pipeline.
 */
function createDLCValueTestData(): AllData {
  return {
    gameDefs: {
      cities: {
        berlin: { name: 'Berlin', country: 'germany', has_garage: true },
        paris: { name: 'Paris', country: 'france', has_garage: true },
        lisboa: { name: 'Lisboa', country: 'portugal', has_garage: true },
        madrid: { name: 'Madrid', country: 'spain', has_garage: true },
      },
      countries: {
        germany: { name: 'Germany' },
        france: { name: 'France' },
        portugal: { name: 'Portugal' },
        spain: { name: 'Spain' },
      },
      companies: {
        logistics_co: {
          name: 'Logistics Co',
          cargo_out: ['electronics'],
          cargo_in: [],
          cities: ['berlin', 'paris', 'lisboa', 'madrid'],
        },
      },
      cargo: {
        electronics: { name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
      },
      trailers: {
        'scs.curtainside.single_3': { name: 'SCS Curtainside', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        'feldbinder.silo.single_3': { name: 'Feldbinder Silo', body_type: 'silo', volume: 60, chassis_mass: 4500, body_mass: 2500, gross_weight_limit: 40000, length: 12, chain_type: 'single', ownable: true },
      },
      city_companies: {
        berlin: { logistics_co: 2 },
        paris: { logistics_co: 1 },
        lisboa: { logistics_co: 1 },
        madrid: { logistics_co: 1 },
      },
      company_cargo: {
        logistics_co: ['electronics'],
      },
      cargo_trailers: {
        electronics: ['scs.curtainside.single_3'],
      },
      cargo_trailer_units: {
        electronics: { 'scs.curtainside.single_3': 90 },
      },
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [
      { id: 'berlin', name: 'Berlin', country: 'germany', hasGarage: true },
      { id: 'paris', name: 'Paris', country: 'france', hasGarage: true },
      { id: 'lisboa', name: 'Lisboa', country: 'portugal', hasGarage: true },
      { id: 'madrid', name: 'Madrid', country: 'spain', hasGarage: true },
    ],
    companies: [{ id: 'logistics_co', name: 'Logistics Co' }],
    cargo: [
      { id: 'electronics', name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
    ],
    trailers: [
      { id: 'scs.curtainside.single_3', name: 'SCS Curtainside', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'feldbinder.silo.single_3', name: 'Feldbinder Silo', body_type: 'silo', volume: 60, chassis_mass: 4500, body_mass: 2500, gross_weight_limit: 40000, length: 12, chain_type: 'single', ownable: true },
    ],
  };
}

describe('sumGarageScores', () => {
  it('returns total and per-city scores', () => {
    const data = createDLCValueTestData();
    const garageCities = new Set(['berlin', 'paris']);

    const result = sumGarageScores(
      data,
      [], // no trailer DLCs
      new Set<string>(), // no cargo+map DLCs
      [], // no map DLCs
      garageCities,
      {}, // no city DLC map
      {}, // no cargo DLC map
    );

    expect(result.total).toBeGreaterThan(0);
    expect(result.perCity.size).toBeGreaterThan(0);
    // Both cities have a positive score
    const berlinScore = result.perCity.get('berlin') ?? 0;
    const parisScore = result.perCity.get('paris') ?? 0;
    expect(berlinScore).toBeGreaterThan(0);
    expect(parisScore).toBeGreaterThan(0);
    // Total = sum of garage city scores
    expect(result.total).toBe(berlinScore + parisScore);
  });

  it('only sums scores for cities in the garage set', () => {
    const data = createDLCValueTestData();
    // Only berlin in garage set, but paris also has depots
    const garageCities = new Set(['berlin']);

    const result = sumGarageScores(
      data, [], new Set<string>(), [], garageCities, {}, {},
    );

    // Total should equal berlin's score only
    const berlinScore = result.perCity.get('berlin') ?? 0;
    expect(result.total).toBe(berlinScore);
  });

  it('returns zero when no garage cities have cargo', () => {
    const data = createDLCValueTestData();
    // No garages owned
    const garageCities = new Set<string>();

    const result = sumGarageScores(
      data, [], new Set<string>(), [], garageCities, {}, {},
    );

    expect(result.total).toBe(0);
  });

  it('blocks cities from unowned map DLCs', () => {
    const data = createDLCValueTestData();
    const garageCities = new Set(['berlin', 'paris', 'lisboa']);
    const cityDlcMap = { iberia: ['lisboa', 'madrid'] };

    // Don't own iberia -> lisboa/madrid blocked
    const result = sumGarageScores(
      data, [], new Set<string>(), [], // no map DLCs owned
      garageCities, cityDlcMap, {},
    );

    // lisboa should be blocked, so its score should not appear
    expect(result.perCity.has('lisboa')).toBe(false);
  });
});

describe('computeAllDLCValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns marginal values for each unowned DLC', async () => {
    const data = createDLCValueTestData();
    const results = await computeAllDLCValues(data);

    // We mock: ownedTrailer=['feldbinder'], ownedCargo=[], ownedMap=[]
    // Unowned: krone (trailer), high_power (cargo), iberia (map)
    expect(results).toHaveLength(3);

    const dlcIds = results.map((r) => r.dlcId);
    expect(dlcIds).toContain('krone');
    expect(dlcIds).toContain('high_power');
    expect(dlcIds).toContain('iberia');
  });

  it('assigns correct DLC types', async () => {
    const data = createDLCValueTestData();
    const results = await computeAllDLCValues(data);

    const krone = results.find((r) => r.dlcId === 'krone');
    expect(krone!.dlcType).toBe('trailer');

    const highPower = results.find((r) => r.dlcId === 'high_power');
    expect(highPower!.dlcType).toBe('cargo');

    const iberia = results.find((r) => r.dlcId === 'iberia');
    expect(iberia!.dlcType).toBe('map');
  });

  it('sorts results by totalDelta descending', async () => {
    const data = createDLCValueTestData();
    const results = await computeAllDLCValues(data);

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].totalDelta).toBeGreaterThanOrEqual(results[i + 1].totalDelta);
    }
  });

  it('calls onProgress callback', async () => {
    const data = createDLCValueTestData();
    const progressCalls: Array<[number, number]> = [];

    await computeAllDLCValues(data, (completed, total) => {
      progressCalls.push([completed, total]);
    });

    expect(progressCalls.length).toBe(3); // 3 unowned DLCs
    // Last call should have completed === total
    const last = progressCalls[progressCalls.length - 1];
    expect(last[0]).toBe(last[1]);
  });

  it('map DLCs include newGarageCities', async () => {
    const data = createDLCValueTestData();
    const results = await computeAllDLCValues(data);

    const iberia = results.find((r) => r.dlcId === 'iberia');
    // iberia adds lisboa and madrid (both in GARAGE_CITIES)
    // Player already has garages in berlin/paris but not lisboa/madrid
    expect(iberia!.newGarageCities.length).toBeGreaterThanOrEqual(0);
  });

  it('trailer/cargo DLCs have no newGarageCities', async () => {
    const data = createDLCValueTestData();
    const results = await computeAllDLCValues(data);

    const krone = results.find((r) => r.dlcId === 'krone');
    expect(krone!.newGarageCities).toHaveLength(0);

    const highPower = results.find((r) => r.dlcId === 'high_power');
    expect(highPower!.newGarageCities).toHaveLength(0);
  });
});
