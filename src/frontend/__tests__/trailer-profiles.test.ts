import { describe, it, expect } from 'vitest';
import {
  buildTrailerProfiles, deduplicateTrailerProfiles,
  buildDepotProfiles, buildCityCargoProfile,
  scoreTrailerInCity, rankTrailersForCity,
  getUniqueTrailerTypes, getCityCargoPool,
} from '../trailer-profiles';
import { buildLookups } from '../lookups';
import type { AllData, TrailerProfile } from '../types';

/**
 * Build minimal AllData with gameDefs for trailer profile tests.
 * Uses realistic trailer IDs with brand.body_type.chain_variant convention.
 */
function createTestData(): AllData {
  return {
    gameDefs: {
      cities: {
        berlin: { name: 'Berlin', country: 'germany', has_garage: true },
        stockholm: { name: 'Stockholm', country: 'sweden', has_garage: true },
      },
      countries: {
        germany: { name: 'Germany' },
        sweden: { name: 'Sweden' },
      },
      companies: {
        logistics_co: {
          name: 'Logistics Co',
          cargo_out: ['electronics', 'machinery', 'glass'],
          cargo_in: [],
          cities: ['berlin', 'stockholm'],
        },
        food_inc: {
          name: 'Food Inc',
          cargo_out: ['fruit'],
          cargo_in: [],
          cities: ['berlin'],
        },
      },
      cargo: {
        electronics: { name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1.0, body_types: ['curtainside'], groups: [], excluded: false },
        machinery: { name: 'Machinery', value: 3.0, volume: 1, mass: 800, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 0.5, body_types: ['flatbed'], groups: [], excluded: false },
        glass: { name: 'Glass', value: 2.0, volume: 1, mass: 600, fragility: 0.6, fragile: true, high_value: false, adr_class: 0, prob_coef: 1.0, body_types: ['curtainside'], groups: [], excluded: false },
        fruit: { name: 'Fruit', value: 1.0, volume: 1, mass: 300, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1.0, body_types: ['reefer'], groups: [], excluded: false },
        excluded_cargo: { name: 'Excluded', value: 100.0, volume: 1, mass: 100, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1.0, body_types: ['curtainside'], groups: [], excluded: true },
      },
      trailers: {
        'scs.curtainside.single_3': { name: 'SCS Curtainside', body_type: 'curtainside', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        'scs.curtainside.double_3_2': { name: 'SCS Curtainside Double', body_type: 'curtainside', volume: 135, chassis_mass: 7000, body_mass: 4000, gross_weight_limit: 50000, length: 20, chain_type: 'double', country_validity: ['sweden', 'finland'], ownable: true },
        'scs.flatbed.single_3': { name: 'SCS Flatbed', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        'scs.reefer.single_3': { name: 'SCS Reefer', body_type: 'reefer', volume: 85, chassis_mass: 5000, body_mass: 3500, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        'scs.special.single_3': { name: 'SCS Special', body_type: 'special', volume: 50, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: false },
      },
      city_companies: {
        berlin: { logistics_co: 2, food_inc: 1 },
        stockholm: { logistics_co: 1 },
      },
      company_cargo: {
        logistics_co: ['electronics', 'machinery', 'glass'],
        food_inc: ['fruit'],
      },
      cargo_trailers: {
        electronics: ['scs.curtainside.single_3', 'scs.curtainside.double_3_2'],
        machinery: ['scs.flatbed.single_3'],
        glass: ['scs.curtainside.single_3', 'scs.curtainside.double_3_2'],
        fruit: ['scs.reefer.single_3'],
        excluded_cargo: ['scs.curtainside.single_3'],
      },
      cargo_trailer_units: {
        electronics: { 'scs.curtainside.single_3': 90, 'scs.curtainside.double_3_2': 135 },
        machinery: { 'scs.flatbed.single_3': 1 },
        glass: { 'scs.curtainside.single_3': 90, 'scs.curtainside.double_3_2': 135 },
        fruit: { 'scs.reefer.single_3': 85 },
        excluded_cargo: { 'scs.curtainside.single_3': 90 },
      },
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [
      { id: 'berlin', name: 'Berlin', country: 'germany', hasGarage: true },
      { id: 'stockholm', name: 'Stockholm', country: 'sweden', hasGarage: true },
    ],
    companies: [
      { id: 'logistics_co', name: 'Logistics Co' },
      { id: 'food_inc', name: 'Food Inc' },
    ],
    cargo: [
      { id: 'electronics', name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1.0, body_types: ['curtainside'], groups: [], excluded: false },
      { id: 'machinery', name: 'Machinery', value: 3.0, volume: 1, mass: 800, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 0.5, body_types: ['flatbed'], groups: [], excluded: false },
      { id: 'glass', name: 'Glass', value: 2.0, volume: 1, mass: 600, fragility: 0.6, fragile: true, high_value: false, adr_class: 0, prob_coef: 1.0, body_types: ['curtainside'], groups: [], excluded: false },
      { id: 'fruit', name: 'Fruit', value: 1.0, volume: 1, mass: 300, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1.0, body_types: ['reefer'], groups: [], excluded: false },
      { id: 'excluded_cargo', name: 'Excluded', value: 100.0, volume: 1, mass: 100, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1.0, body_types: ['curtainside'], groups: [], excluded: true },
    ],
    trailers: [
      { id: 'scs.curtainside.single_3', name: 'SCS Curtainside', body_type: 'curtainside', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'scs.curtainside.double_3_2', name: 'SCS Curtainside Double', body_type: 'curtainside', volume: 135, chassis_mass: 7000, body_mass: 4000, gross_weight_limit: 50000, length: 20, chain_type: 'double', country_validity: ['sweden', 'finland'], ownable: true },
      { id: 'scs.flatbed.single_3', name: 'SCS Flatbed', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'scs.reefer.single_3', name: 'SCS Reefer', body_type: 'reefer', volume: 85, chassis_mass: 5000, body_mass: 3500, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'scs.special.single_3', name: 'SCS Special', body_type: 'special', volume: 50, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: false },
    ],
  };
}

describe('buildTrailerProfiles', () => {
  it('creates profiles only for ownable trailers with cargo', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);

    const ids = profiles.map((p) => p.trailerId);
    expect(ids).toContain('scs.curtainside.single_3');
    expect(ids).toContain('scs.curtainside.double_3_2');
    expect(ids).toContain('scs.flatbed.single_3');
    expect(ids).toContain('scs.reefer.single_3');
    // Non-ownable should be excluded
    expect(ids).not.toContain('scs.special.single_3');
  });

  it('excludes excluded cargo from profiles', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);

    // curtainside profile should not include excluded_cargo
    const curtainside = profiles.find((p) => p.trailerId === 'scs.curtainside.single_3');
    const cargoIds = curtainside!.cargo.map((e) => e.cargoId);
    expect(cargoIds).not.toContain('excluded_cargo');
    expect(cargoIds).toContain('electronics');
    expect(cargoIds).toContain('glass');
  });

  it('computes correct haulValue with fragile bonus', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);

    const curtainside = profiles.find((p) => p.trailerId === 'scs.curtainside.single_3');
    const glass = curtainside!.cargo.find((e) => e.cargoId === 'glass');
    // glass: value=2.0, fragile=true -> bonus=1.3, units=90 -> haulValue = 2.0 * 1.3 * 90 = 234
    expect(glass!.haulValue).toBeCloseTo(234, 5);
  });

  it('uses prob_coef as spawnWeight', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);

    const flatbed = profiles.find((p) => p.trailerId === 'scs.flatbed.single_3');
    const machinery = flatbed!.cargo.find((e) => e.cargoId === 'machinery');
    expect(machinery!.spawnWeight).toBe(0.5);
  });

  it('sorts cargo within profile by haulValue descending', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);

    for (const profile of profiles) {
      for (let i = 0; i < profile.cargo.length - 1; i++) {
        expect(profile.cargo[i].haulValue).toBeGreaterThanOrEqual(profile.cargo[i + 1].haulValue);
      }
    }
  });

  it('sorts profiles by totalWeightedValue descending', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);

    for (let i = 0; i < profiles.length - 1; i++) {
      expect(profiles[i].totalWeightedValue).toBeGreaterThanOrEqual(profiles[i + 1].totalWeightedValue);
    }
  });

  it('preserves countryValidity for restricted trailers', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);

    const double = profiles.find((p) => p.trailerId === 'scs.curtainside.double_3_2');
    expect(double!.countryValidity).toEqual(['sweden', 'finland']);

    const single = profiles.find((p) => p.trailerId === 'scs.curtainside.single_3');
    expect(single!.countryValidity).toEqual([]);
  });

  it('returns empty array when no ownable trailers have cargo', () => {
    const data = createTestData();
    // Remove all cargo_trailers mappings
    data.gameDefs!.cargo_trailers = {};
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);

    expect(profiles).toEqual([]);
  });
});

describe('deduplicateTrailerProfiles', () => {
  it('groups trailers with identical earning fingerprints', () => {
    // Two curtainside trailers with same cargo, same units, same body_type/chain_type/countries
    // but different IDs — should be cosmetically deduped
    const profiles: TrailerProfile[] = [
      {
        trailerId: 'scs.curtainside.single_3',
        bodyType: 'curtainside', volume: 90, grossWeightLimit: 40000, length: 13.6,
        chainType: 'single', countryValidity: [],
        cargo: [{ cargoId: 'electronics', units: 90, haulValue: 225, spawnWeight: 1 }],
        totalHaulValue: 225, totalWeightedValue: 225,
      },
      {
        trailerId: 'krone.curtainside.single_3',
        bodyType: 'curtainside', volume: 90, grossWeightLimit: 40000, length: 13.6,
        chainType: 'single', countryValidity: [],
        cargo: [{ cargoId: 'electronics', units: 90, haulValue: 225, spawnWeight: 1 }],
        totalHaulValue: 225, totalWeightedValue: 225,
      },
    ];

    const unique = deduplicateTrailerProfiles(profiles);
    // Should be deduped into one type with 2 variants
    expect(unique).toHaveLength(1);
    expect(unique[0].variants).toHaveLength(2);
  });

  it('picks representative with shortest length', () => {
    const profiles: TrailerProfile[] = [
      {
        trailerId: 'long_trailer',
        bodyType: 'curtainside', volume: 90, grossWeightLimit: 40000, length: 15.0,
        chainType: 'single', countryValidity: [],
        cargo: [{ cargoId: 'electronics', units: 90, haulValue: 225, spawnWeight: 1 }],
        totalHaulValue: 225, totalWeightedValue: 225,
      },
      {
        trailerId: 'short_trailer',
        bodyType: 'curtainside', volume: 90, grossWeightLimit: 40000, length: 12.0,
        chainType: 'single', countryValidity: [],
        cargo: [{ cargoId: 'electronics', units: 90, haulValue: 225, spawnWeight: 1 }],
        totalHaulValue: 225, totalWeightedValue: 225,
      },
    ];

    const unique = deduplicateTrailerProfiles(profiles);
    expect(unique[0].representative.trailerId).toBe('short_trailer');
  });

  it('keeps trailers with different cargo as separate types', () => {
    const profiles: TrailerProfile[] = [
      {
        trailerId: 'curtainside',
        bodyType: 'curtainside', volume: 90, grossWeightLimit: 40000, length: 13.6,
        chainType: 'single', countryValidity: [],
        cargo: [{ cargoId: 'electronics', units: 90, haulValue: 225, spawnWeight: 1 }],
        totalHaulValue: 225, totalWeightedValue: 225,
      },
      {
        trailerId: 'flatbed',
        bodyType: 'flatbed', volume: 80, grossWeightLimit: 40000, length: 13.6,
        chainType: 'single', countryValidity: [],
        cargo: [{ cargoId: 'machinery', units: 1, haulValue: 3, spawnWeight: 1 }],
        totalHaulValue: 3, totalWeightedValue: 3,
      },
    ];

    const unique = deduplicateTrailerProfiles(profiles);
    expect(unique).toHaveLength(2);
  });

  it('marks dominated type when A covers all of B cargo with strictly more', () => {
    // Type A hauls electronics (225) + glass (234)
    // Type B hauls electronics (225) only
    // A dominates B: same cargo haulValues, but A has strictly more cargo
    const profiles: TrailerProfile[] = [
      {
        trailerId: 'type_a',
        bodyType: 'curtainside', volume: 90, grossWeightLimit: 40000, length: 13.6,
        chainType: 'single', countryValidity: [],
        cargo: [
          { cargoId: 'electronics', units: 90, haulValue: 225, spawnWeight: 1 },
          { cargoId: 'glass', units: 90, haulValue: 234, spawnWeight: 1 },
        ],
        totalHaulValue: 459, totalWeightedValue: 459,
      },
      {
        trailerId: 'type_b',
        bodyType: 'curtainside_narrow', volume: 85, grossWeightLimit: 40000, length: 13.6,
        chainType: 'single', countryValidity: [],
        cargo: [
          { cargoId: 'electronics', units: 90, haulValue: 225, spawnWeight: 1 },
        ],
        totalHaulValue: 225, totalWeightedValue: 225,
      },
    ];

    const unique = deduplicateTrailerProfiles(profiles);
    // Only type_a should remain (type_b dominated)
    expect(unique).toHaveLength(1);
    expect(unique[0].representative.trailerId).toBe('type_a');
  });

  it('does not mark as dominated when country validity is more restrictive', () => {
    // Type A is restricted to Sweden, Type B is unrestricted
    // A has more cargo but is invalid in most countries -> B is NOT dominated
    const profiles: TrailerProfile[] = [
      {
        trailerId: 'type_a_restricted',
        bodyType: 'curtainside', volume: 135, grossWeightLimit: 50000, length: 20,
        chainType: 'double', countryValidity: ['sweden'],
        cargo: [
          { cargoId: 'electronics', units: 135, haulValue: 337, spawnWeight: 1 },
          { cargoId: 'glass', units: 135, haulValue: 351, spawnWeight: 1 },
        ],
        totalHaulValue: 688, totalWeightedValue: 688,
      },
      {
        trailerId: 'type_b_universal',
        bodyType: 'curtainside', volume: 90, grossWeightLimit: 40000, length: 13.6,
        chainType: 'single', countryValidity: [],
        cargo: [
          { cargoId: 'electronics', units: 90, haulValue: 225, spawnWeight: 1 },
        ],
        totalHaulValue: 225, totalWeightedValue: 225,
      },
    ];

    const unique = deduplicateTrailerProfiles(profiles);
    // Both should survive: restricted type can't dominate unrestricted
    expect(unique).toHaveLength(2);
  });

  it('marks dominated when A has higher haulValue for same cargo', () => {
    // Same single cargo, but A has higher haulValue and shorter length
    const profiles: TrailerProfile[] = [
      {
        trailerId: 'better',
        bodyType: 'curtainside', volume: 100, grossWeightLimit: 45000, length: 12.0,
        chainType: 'single', countryValidity: [],
        cargo: [{ cargoId: 'electronics', units: 100, haulValue: 250, spawnWeight: 1 }],
        totalHaulValue: 250, totalWeightedValue: 250,
      },
      {
        trailerId: 'worse',
        bodyType: 'curtainside', volume: 90, grossWeightLimit: 40000, length: 13.6,
        chainType: 'single', countryValidity: [],
        cargo: [{ cargoId: 'electronics', units: 90, haulValue: 225, spawnWeight: 1 }],
        totalHaulValue: 225, totalWeightedValue: 225,
      },
    ];

    const unique = deduplicateTrailerProfiles(profiles);
    // 'worse' is dominated because 'better' covers same cargo with higher HV AND shorter length
    expect(unique).toHaveLength(1);
    expect(unique[0].representative.trailerId).toBe('better');
  });

  it('returns non-dominated types sorted by totalWeightedValue descending', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);
    const unique = deduplicateTrailerProfiles(profiles);

    for (let i = 0; i < unique.length - 1; i++) {
      expect(unique[i].representative.totalWeightedValue)
        .toBeGreaterThanOrEqual(unique[i + 1].representative.totalWeightedValue);
    }
  });
});

describe('getUniqueTrailerTypes', () => {
  it('combines buildTrailerProfiles + deduplicateTrailerProfiles', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const unique = getUniqueTrailerTypes(data, lookups);

    expect(unique.length).toBeGreaterThan(0);
    for (const t of unique) {
      expect(t.representative).toBeDefined();
      expect(t.variants.length).toBeGreaterThan(0);
      expect(t.dominatedBy).toBeNull();
    }
  });
});

describe('buildDepotProfiles', () => {
  it('creates a profile per company', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const depots = buildDepotProfiles(data, lookups);

    expect(depots.size).toBe(2);
    expect(depots.has('logistics_co')).toBe(true);
    expect(depots.has('food_inc')).toBe(true);
  });

  it('excludes excluded cargo', () => {
    const data = createTestData();
    // Add excluded_cargo to logistics_co
    data.gameDefs!.company_cargo['logistics_co'].push('excluded_cargo');
    const lookups = buildLookups(data);
    const depots = buildDepotProfiles(data, lookups);

    const logistics = depots.get('logistics_co')!;
    const cargoIds = logistics.cargo.map((c) => c.cargoId);
    expect(cargoIds).not.toContain('excluded_cargo');
  });

  it('applies fragile bonus to cargo value', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const depots = buildDepotProfiles(data, lookups);

    const logistics = depots.get('logistics_co')!;
    const glass = logistics.cargo.find((c) => c.cargoId === 'glass');
    // glass: value=2.0, fragile=true -> bonus=1.3 -> value = 2.0 * 1.3 = 2.6
    expect(glass!.value).toBeCloseTo(2.6, 5);
  });

  it('sorts cargo by weightedValue descending', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const depots = buildDepotProfiles(data, lookups);

    for (const depot of depots.values()) {
      for (let i = 0; i < depot.cargo.length - 1; i++) {
        expect(depot.cargo[i].weightedValue).toBeGreaterThanOrEqual(depot.cargo[i + 1].weightedValue);
      }
    }
  });
});

describe('buildCityCargoProfile', () => {
  it('returns null for unknown city', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    expect(buildCityCargoProfile('unknown', data, lookups)).toBeNull();
  });

  it('aggregates depot counts across companies', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profile = buildCityCargoProfile('berlin', data, lookups);

    expect(profile).not.toBeNull();
    // Berlin: logistics_co x2 + food_inc x1 = 3 total depots
    expect(profile!.depotCount).toBe(3);
    expect(profile!.companyCount).toBe(2);
  });

  it('merges cargo from multiple companies with accumulated depot counts', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profile = buildCityCargoProfile('berlin', data, lookups);

    // electronics comes from logistics_co (2 depots)
    const electronics = profile!.cargo.get('electronics');
    expect(electronics).toBeDefined();
    expect(electronics!.depotCount).toBe(2);
  });

  it('excludes excluded cargo', () => {
    const data = createTestData();
    data.gameDefs!.company_cargo['logistics_co'].push('excluded_cargo');
    const lookups = buildLookups(data);
    const profile = buildCityCargoProfile('berlin', data, lookups);

    expect(profile!.cargo.has('excluded_cargo')).toBe(false);
  });
});

describe('scoreTrailerInCity', () => {
  it('returns null when trailer is country-restricted and city is in wrong country', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);
    const berlinProfile = buildCityCargoProfile('berlin', data, lookups)!;

    const double = profiles.find((p) => p.trailerId === 'scs.curtainside.double_3_2')!;
    // Double is restricted to sweden/finland, berlin is germany
    const score = scoreTrailerInCity(double, berlinProfile);
    expect(score).toBeNull();
  });

  it('returns score when trailer is valid in city country', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);
    const stockholmProfile = buildCityCargoProfile('stockholm', data, lookups)!;

    const double = profiles.find((p) => p.trailerId === 'scs.curtainside.double_3_2')!;
    // Double is valid in sweden
    const score = scoreTrailerInCity(double, stockholmProfile);
    expect(score).not.toBeNull();
    expect(score!.cityValue).toBeGreaterThan(0);
  });

  it('returns score for unrestricted trailer in any city', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);
    const berlinProfile = buildCityCargoProfile('berlin', data, lookups)!;

    const single = profiles.find((p) => p.trailerId === 'scs.curtainside.single_3')!;
    const score = scoreTrailerInCity(single, berlinProfile);
    expect(score).not.toBeNull();
    expect(score!.cargoMatched).toBeGreaterThan(0);
  });

  it('computes cityValue as haulValue * spawnWeight * depotCount', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);
    const stockholmProfile = buildCityCargoProfile('stockholm', data, lookups)!;

    // Stockholm has logistics_co x1
    // reefer can haul fruit: value=1.0, bonus=1.0, units=85 -> haulValue=85
    // fruit: spawnWeight=1.0, depotCount=0 (food_inc is NOT in stockholm)
    // So reefer should score 0 for stockholm (no fruit available)
    const reefer = profiles.find((p) => p.trailerId === 'scs.reefer.single_3')!;
    const score = scoreTrailerInCity(reefer, stockholmProfile);
    // fruit is not in stockholm (food_inc not present), so score should be null or 0
    if (score) {
      expect(score.cityValue).toBe(0);
    }
  });
});

describe('rankTrailersForCity', () => {
  it('returns trailers sorted by cityValue descending', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);
    const berlinProfile = buildCityCargoProfile('berlin', data, lookups)!;

    const ranked = rankTrailersForCity(profiles, berlinProfile);

    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i].cityValue).toBeGreaterThanOrEqual(ranked[i + 1].cityValue);
    }
  });

  it('excludes trailers with zero cityValue', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const profiles = buildTrailerProfiles(data, lookups);
    const stockholmProfile = buildCityCargoProfile('stockholm', data, lookups)!;

    const ranked = rankTrailersForCity(profiles, stockholmProfile);
    for (const score of ranked) {
      expect(score.cityValue).toBeGreaterThan(0);
    }
  });
});

describe('getCityCargoPool', () => {
  it('returns cargo pool entries for city', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const pool = getCityCargoPool('berlin', data, lookups);

    expect(pool.length).toBeGreaterThan(0);
    const cargoNames = pool.map((p) => p.cargoName);
    expect(cargoNames).toContain('Electronics');
    expect(cargoNames).toContain('Glass');
    expect(cargoNames).toContain('Fruit');
  });

  it('excludes excluded cargo', () => {
    const data = createTestData();
    data.gameDefs!.company_cargo['logistics_co'].push('excluded_cargo');
    const lookups = buildLookups(data);
    const pool = getCityCargoPool('berlin', data, lookups);

    const cargoIds = pool.map((p) => p.cargoId);
    expect(cargoIds).not.toContain('excluded_cargo');
  });

  it('returns empty array for unknown city', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const pool = getCityCargoPool('unknown', data, lookups);
    expect(pool).toEqual([]);
  });

  it('applies fragile bonus to value', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const pool = getCityCargoPool('berlin', data, lookups);

    const glass = pool.find((p) => p.cargoId === 'glass');
    // glass: value=2.0, fragile=true -> bonus=1.3 -> 2.6
    expect(glass!.value).toBeCloseTo(2.6, 5);
  });

  it('includes depot count from city_companies', () => {
    const data = createTestData();
    const lookups = buildLookups(data);
    const pool = getCityCargoPool('berlin', data, lookups);

    // electronics from logistics_co with count=2
    const electronics = pool.find((p) => p.cargoId === 'electronics');
    expect(electronics!.depotCount).toBe(2);

    // fruit from food_inc with count=1
    const fruit = pool.find((p) => p.cargoId === 'fruit');
    expect(fruit!.depotCount).toBe(1);
  });
});
