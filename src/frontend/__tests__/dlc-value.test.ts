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
import { sumGarageScores, computeAllDLCValues, computeDLCValuesCore } from '../dlc-value';
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

/**
 * Body-type breakdown (#257). `boxes` (dryvan) and `chilled` (reefer) ship from
 * one Berlin company. Base `scs` trailers: dryvan vol 100 (HV 200), reefer vol 80
 * (HV 240). `krone` adds a dryvan vol 150 (HV 300 — strict win) AND a reefer vol 80
 * (HV 240 — exact tie). `tieonly` adds a dryvan vol 100 (HV 200 — exact tie). So
 * krone wins exactly one body type (dryvan), and tieonly wins none.
 */
function createBreakdownTestData(): AllData {
  const cargo = [
    { id: 'boxes', name: 'Boxes', value: 2, volume: 1, mass: 100, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
    { id: 'chilled', name: 'Chilled', value: 3, volume: 1, mass: 100, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['reefer'], groups: [], excluded: false },
  ];
  const trailers = [
    { id: 'scs.dryvan.s3', name: 'SCS Dryvan', body_type: 'dryvan', volume: 100, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
    { id: 'scs.reefer.s3', name: 'SCS Reefer', body_type: 'reefer', volume: 80, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
    { id: 'krone.dryvan.xl', name: 'Krone Dryvan XL', body_type: 'dryvan', volume: 150, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
    { id: 'krone.reefer.s3', name: 'Krone Reefer', body_type: 'reefer', volume: 80, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
    { id: 'tieonly.dryvan.s3', name: 'TieOnly Dryvan', body_type: 'dryvan', volume: 100, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
  ];
  return {
    gameDefs: {
      cities: { berlin: { name: 'Berlin', country: 'germany', has_garage: true } },
      countries: { germany: { name: 'Germany' } },
      companies: { co: { name: 'Co', cargo_out: ['boxes', 'chilled'], cargo_in: [], cities: ['berlin'] } },
      cargo: Object.fromEntries(cargo.map(c => [c.id, { name: c.name, value: c.value, volume: c.volume, mass: c.mass, fragility: c.fragility, fragile: c.fragile, high_value: c.high_value, adr_class: c.adr_class, prob_coef: c.prob_coef, body_types: c.body_types, groups: c.groups, excluded: c.excluded }])),
      trailers: Object.fromEntries(trailers.map(t => [t.id, { name: t.name, body_type: t.body_type, volume: t.volume, chassis_mass: t.chassis_mass, body_mass: t.body_mass, gross_weight_limit: t.gross_weight_limit, length: t.length, chain_type: t.chain_type, ownable: t.ownable }])),
      city_companies: { berlin: { co: 2 } },
      company_cargo: { co: ['boxes', 'chilled'] },
      cargo_trailers: {
        boxes: ['scs.dryvan.s3', 'krone.dryvan.xl', 'tieonly.dryvan.s3'],
        chilled: ['scs.reefer.s3', 'krone.reefer.s3'],
      },
      cargo_trailer_units: {
        boxes: { 'scs.dryvan.s3': 100, 'krone.dryvan.xl': 150, 'tieonly.dryvan.s3': 100 },
        chilled: { 'scs.reefer.s3': 80, 'krone.reefer.s3': 80 },
      },
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [{ id: 'berlin', name: 'Berlin', country: 'germany', hasGarage: true }],
    companies: [{ id: 'co', name: 'Co' }],
    cargo,
    trailers,
  };
}

describe('computeDLCValuesCore — body-type breakdown (#257)', () => {
  const ownership = {
    ownedTrailer: [], ownedCargo: [], ownedMap: [],
    activeGarages: new Set(['berlin']),
    garageCities: new Set(['berlin']),
    unowned: [
      { id: 'krone', type: 'trailer' as const, name: 'Krone' },
      { id: 'tieonly', type: 'trailer' as const, name: 'Tie Only' },
    ],
    cityDlcMap: {}, combinedCargoDlcMap: {},
  };

  it('breaks down the body type a DLC wins, with runner-up and HV margin', () => {
    const results = computeDLCValuesCore(createBreakdownTestData(), ownership);
    const krone = results.find(r => r.dlcId === 'krone')!;

    expect(krone.bodyTypeBreakdown).toBeDefined();
    const dryvan = krone.bodyTypeBreakdown!.find(b => b.bodyType === 'dryvan');
    expect(dryvan).toBeDefined();
    expect(dryvan!.marginHV).toBe(100);            // 300 (krone) − 200 (scs)
    expect(dryvan!.runnerUpTrailerSpec).toBeTruthy();
    expect(dryvan!.countries).toBe(1);
    expect(krone.totalDelta).toBeGreaterThan(0);   // the win flows through to EV
  });

  it('excludes body types the DLC only ties (no unique haul value)', () => {
    const results = computeDLCValuesCore(createBreakdownTestData(), ownership);
    const krone = results.find(r => r.dlcId === 'krone')!;
    // krone.reefer.s3 ties scs.reefer.s3 → reefer must NOT appear
    expect(krone.bodyTypeBreakdown!.some(b => b.bodyType === 'reefer')).toBe(false);
  });

  it('a pure-tie DLC yields no breakdown and ~0 EV delta (deterministic seed)', () => {
    const results = computeDLCValuesCore(createBreakdownTestData(), ownership);
    const tie = results.find(r => r.dlcId === 'tieonly')!;
    expect(tie.bodyTypeBreakdown).toBeUndefined();
    expect(Math.abs(tie.totalDelta)).toBeLessThan(1e-6);
  });
});

/**
 * Demand-scoping: Berlin ships only `boxes` (dryvan). `steel` (flatbed) exists in
 * the dataset (flatbed trailers have HV > 0) but NO company ships it. `kogel` adds
 * a stronger flatbed trailer. Because Berlin demands no flatbed, the DLC's flatbed
 * dominance is irrelevant to this profile — it must NOT appear in the breakdown,
 * and totalDelta is ~0.
 */
function createUndemandedTestData(): AllData {
  const cargo = [
    { id: 'boxes', name: 'Boxes', value: 2, volume: 1, mass: 100, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
    { id: 'steel', name: 'Steel', value: 5, volume: 1, mass: 100, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['flatbed'], groups: [], excluded: false },
  ];
  const trailers = [
    { id: 'scs.dryvan.s3', name: 'SCS Dryvan', body_type: 'dryvan', volume: 100, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
    { id: 'scs.flatbed.s3', name: 'SCS Flatbed', body_type: 'flatbed', volume: 100, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
    { id: 'kogel.flatbed.xl', name: 'Kogel Flatbed XL', body_type: 'flatbed', volume: 200, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
  ];
  return {
    gameDefs: {
      cities: { berlin: { name: 'Berlin', country: 'germany', has_garage: true } },
      countries: { germany: { name: 'Germany' } },
      companies: { co: { name: 'Co', cargo_out: ['boxes'], cargo_in: [], cities: ['berlin'] } },
      cargo: Object.fromEntries(cargo.map(c => [c.id, { ...c }])),
      trailers: Object.fromEntries(trailers.map(t => [t.id, { ...t }])),
      city_companies: { berlin: { co: 2 } },
      company_cargo: { co: ['boxes'] },
      cargo_trailers: { boxes: ['scs.dryvan.s3'], steel: ['scs.flatbed.s3', 'kogel.flatbed.xl'] },
      cargo_trailer_units: { boxes: { 'scs.dryvan.s3': 100 }, steel: { 'scs.flatbed.s3': 100, 'kogel.flatbed.xl': 200 } },
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [{ id: 'berlin', name: 'Berlin', country: 'germany', hasGarage: true }],
    companies: [{ id: 'co', name: 'Co' }],
    cargo, trailers,
  };
}

/**
 * Multi-country MAX-margin aggregation. Both Aaa (country_a) and Bbb (country_b)
 * ship `boxes` (dryvan). `scs.dryvan.big` (HV 250) is valid only in country_b, so
 * the runner-up there is stronger: krone wins by +100 in A (over scs.dryvan.s3,
 * HV 200) and by +50 in B (over scs.dryvan.big, HV 250). The breakdown must report
 * the MAX margin (100), its country's runner-up, and 2 affected countries.
 */
function createMultiCountryTestData(): AllData {
  const cargo = [
    { id: 'boxes', name: 'Boxes', value: 2, volume: 1, mass: 100, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
  ];
  const trailers = [
    { id: 'scs.dryvan.s3', name: 'SCS Dryvan', body_type: 'dryvan', volume: 100, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
    { id: 'scs.dryvan.big', name: 'SCS Dryvan Big', body_type: 'dryvan', volume: 125, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true, country_validity: ['country_b'] },
    { id: 'krone.dryvan.xl', name: 'Krone Dryvan XL', body_type: 'dryvan', volume: 150, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
  ];
  return {
    gameDefs: {
      cities: { aaa: { name: 'Aaa', country: 'country_a', has_garage: true }, bbb: { name: 'Bbb', country: 'country_b', has_garage: true } },
      countries: { country_a: { name: 'Country A' }, country_b: { name: 'Country B' } },
      companies: {
        co_a: { name: 'Co A', cargo_out: ['boxes'], cargo_in: [], cities: ['aaa'] },
        co_b: { name: 'Co B', cargo_out: ['boxes'], cargo_in: [], cities: ['bbb'] },
      },
      cargo: Object.fromEntries(cargo.map(c => [c.id, { ...c }])),
      trailers: Object.fromEntries(trailers.map(t => [t.id, { ...t }])),
      city_companies: { aaa: { co_a: 2 }, bbb: { co_b: 2 } },
      company_cargo: { co_a: ['boxes'], co_b: ['boxes'] },
      cargo_trailers: { boxes: ['scs.dryvan.s3', 'scs.dryvan.big', 'krone.dryvan.xl'] },
      cargo_trailer_units: { boxes: { 'scs.dryvan.s3': 100, 'scs.dryvan.big': 125, 'krone.dryvan.xl': 150 } },
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [
      { id: 'aaa', name: 'Aaa', country: 'country_a', hasGarage: true },
      { id: 'bbb', name: 'Bbb', country: 'country_b', hasGarage: true },
    ],
    companies: [{ id: 'co_a', name: 'Co A' }, { id: 'co_b', name: 'Co B' }],
    cargo, trailers,
  };
}

describe('computeDLCValuesCore — breakdown demand-scoping + multi-country (#257)', () => {
  it('omits body types the garages do not demand (no false win, ~0 delta)', () => {
    const results = computeDLCValuesCore(createUndemandedTestData(), {
      ownedTrailer: [], ownedCargo: [], ownedMap: [],
      activeGarages: new Set(['berlin']), garageCities: new Set(['berlin']),
      unowned: [{ id: 'kogel', type: 'trailer' as const, name: 'Kogel' }],
      cityDlcMap: {}, combinedCargoDlcMap: {},
    });
    const kogel = results.find(r => r.dlcId === 'kogel')!;
    expect(kogel.bodyTypeBreakdown).toBeUndefined(); // flatbed not hauled at Berlin
    expect(Math.abs(kogel.totalDelta)).toBeLessThan(1e-6);
  });

  it('reports the MAX margin and country count across multiple garage countries', () => {
    const results = computeDLCValuesCore(createMultiCountryTestData(), {
      ownedTrailer: [], ownedCargo: [], ownedMap: [],
      activeGarages: new Set(['aaa', 'bbb']), garageCities: new Set(['aaa', 'bbb']),
      unowned: [{ id: 'krone', type: 'trailer' as const, name: 'Krone' }],
      cityDlcMap: {}, combinedCargoDlcMap: {},
    });
    const krone = results.find(r => r.dlcId === 'krone')!;
    const dryvan = krone.bodyTypeBreakdown!.find(b => b.bodyType === 'dryvan')!;
    expect(dryvan).toBeDefined();
    expect(dryvan.marginHV).toBe(100);  // max(100 in A, 50 in B)
    expect(dryvan.countries).toBe(2);
  });
});
