import { describe, it, expect } from 'vitest';
import { getBodyTypeProfiles, getChassisMergeMap } from '../body-types';
import { buildLookups } from '../lookups';
import type { AllData, Trailer } from '../types';

/**
 * Build minimal AllData with gameDefs for body type profiling tests.
 * Uses realistic trailer ID conventions: brand.body_type.chain_variant
 */
function createBodyTypeTestData(): AllData {
  return {
    gameDefs: {
      cities: {
        berlin: { name: 'Berlin', country: 'germany', has_garage: true },
      },
      countries: { germany: { name: 'Germany' } },
      companies: {
        logistics_co: { name: 'Logistics Co', cargo_out: ['electronics', 'machinery', 'glass', 'cement'], cargo_in: [], cities: ['berlin'] },
      },
      cargo: {
        electronics: { name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['curtainside'], groups: [], excluded: false },
        machinery: { name: 'Machinery', value: 3.0, volume: 1, mass: 800, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['flatbed'], groups: [], excluded: false },
        glass: { name: 'Glass', value: 2.0, volume: 1, mass: 600, fragility: 0.6, fragile: true, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['curtainside', 'flatbed'], groups: [], excluded: false },
        cement: { name: 'Cement', value: 1.5, volume: 1, mass: 1000, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['silo'], groups: [], excluded: false },
      },
      trailers: {
        // Curtainside body type trailers
        'scs.curtainside.single_3': { name: 'SCS Curtainside 3-axle', body_type: 'curtainside', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        'scs.curtainside.double_3_2': { name: 'SCS Curtainside Double', body_type: 'curtainside', volume: 135, chassis_mass: 7000, body_mass: 4000, gross_weight_limit: 50000, length: 20, chain_type: 'double', country_validity: ['sweden', 'finland'], ownable: true },
        // Flatbed body type trailers
        'scs.flatbed.single_3': { name: 'SCS Flatbed 3-axle', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        // Silo body type trailers
        'scs.silo.single_3': { name: 'SCS Silo 3-axle', body_type: 'silo', volume: 32, chassis_mass: 4500, body_mass: 2500, gross_weight_limit: 40000, length: 12, chain_type: 'single', ownable: true },
        // Non-ownable trailer
        'scs.special.single_3': { name: 'SCS Special', body_type: 'special', volume: 50, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: false },
      },
      city_companies: { berlin: { logistics_co: 2 } },
      company_cargo: { logistics_co: ['electronics', 'machinery', 'glass', 'cement'] },
      cargo_trailers: {
        electronics: ['scs.curtainside.single_3', 'scs.curtainside.double_3_2'],
        machinery: ['scs.flatbed.single_3'],
        glass: ['scs.curtainside.single_3', 'scs.curtainside.double_3_2', 'scs.flatbed.single_3'],
        cement: ['scs.silo.single_3'],
      },
      cargo_trailer_units: {
        electronics: { 'scs.curtainside.single_3': 90, 'scs.curtainside.double_3_2': 135 },
        machinery: { 'scs.flatbed.single_3': 1 },
        glass: { 'scs.curtainside.single_3': 90, 'scs.curtainside.double_3_2': 135, 'scs.flatbed.single_3': 80 },
        cement: { 'scs.silo.single_3': 32 },
      },
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [
      { id: 'berlin', name: 'Berlin', country: 'germany', hasGarage: true },
    ],
    companies: [{ id: 'logistics_co', name: 'Logistics Co' }],
    cargo: [
      { id: 'electronics', name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['curtainside'], groups: [], excluded: false },
      { id: 'machinery', name: 'Machinery', value: 3.0, volume: 1, mass: 800, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['flatbed'], groups: [], excluded: false },
      { id: 'glass', name: 'Glass', value: 2.0, volume: 1, mass: 600, fragility: 0.6, fragile: true, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['curtainside', 'flatbed'], groups: [], excluded: false },
      { id: 'cement', name: 'Cement', value: 1.5, volume: 1, mass: 1000, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['silo'], groups: [], excluded: false },
    ],
    trailers: [
      { id: 'scs.curtainside.single_3', name: 'SCS Curtainside 3-axle', body_type: 'curtainside', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'scs.curtainside.double_3_2', name: 'SCS Curtainside Double', body_type: 'curtainside', volume: 135, chassis_mass: 7000, body_mass: 4000, gross_weight_limit: 50000, length: 20, chain_type: 'double', country_validity: ['sweden', 'finland'], ownable: true },
      { id: 'scs.flatbed.single_3', name: 'SCS Flatbed 3-axle', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'scs.silo.single_3', name: 'SCS Silo 3-axle', body_type: 'silo', volume: 32, chassis_mass: 4500, body_mass: 2500, gross_weight_limit: 40000, length: 12, chain_type: 'single', ownable: true },
      { id: 'scs.special.single_3', name: 'SCS Special', body_type: 'special', volume: 50, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: false },
    ],
  };
}

describe('getBodyTypeProfiles', () => {
  it('returns profiles only for body types with ownable trailers', () => {
    const data = createBodyTypeTestData();
    const lookups = buildLookups(data);
    const profiles = getBodyTypeProfiles(data, lookups);

    const bodyTypes = profiles.map((p) => p.bodyType);
    expect(bodyTypes).toContain('curtainside');
    expect(bodyTypes).toContain('flatbed');
    expect(bodyTypes).toContain('silo');
    // special is non-ownable, should not appear
    expect(bodyTypes).not.toContain('special');
  });

  it('counts distinct cargo per body type', () => {
    const data = createBodyTypeTestData();
    const lookups = buildLookups(data);
    const profiles = getBodyTypeProfiles(data, lookups);

    const curtainside = profiles.find((p) => p.bodyType === 'curtainside');
    // curtainside can haul: electronics, glass
    expect(curtainside!.cargoCount).toBe(2);

    const flatbed = profiles.find((p) => p.bodyType === 'flatbed');
    // flatbed can haul: machinery, glass
    expect(flatbed!.cargoCount).toBe(2);

    const silo = profiles.find((p) => p.bodyType === 'silo');
    // silo can haul: cement only
    expect(silo!.cargoCount).toBe(1);
  });

  it('detects doubles availability from trailer IDs', () => {
    const data = createBodyTypeTestData();
    const lookups = buildLookups(data);
    const profiles = getBodyTypeProfiles(data, lookups);

    const curtainside = profiles.find((p) => p.bodyType === 'curtainside');
    expect(curtainside!.hasDoubles).toBe(true);
    expect(curtainside!.doublesCountries.length).toBeGreaterThan(0);

    const flatbed = profiles.find((p) => p.bodyType === 'flatbed');
    expect(flatbed!.hasDoubles).toBe(false);
  });

  it('populates bestTrailerId and bestTotalHV', () => {
    const data = createBodyTypeTestData();
    const lookups = buildLookups(data);
    const profiles = getBodyTypeProfiles(data, lookups);

    for (const profile of profiles) {
      expect(profile.bestTrailerId).toBeTruthy();
      expect(profile.bestTotalHV).toBeGreaterThan(0);
      expect(profile.bestTrailerName).toBeTruthy();
    }
  });

  it('sorts profiles by bestTotalHV descending', () => {
    const data = createBodyTypeTestData();
    const lookups = buildLookups(data);
    const profiles = getBodyTypeProfiles(data, lookups);

    for (let i = 0; i < profiles.length - 1; i++) {
      expect(profiles[i].bestTotalHV).toBeGreaterThanOrEqual(profiles[i + 1].bestTotalHV);
    }
  });

  it('generates display names from body type IDs', () => {
    const data = createBodyTypeTestData();
    const lookups = buildLookups(data);
    const profiles = getBodyTypeProfiles(data, lookups);

    const curtainside = profiles.find((p) => p.bodyType === 'curtainside');
    expect(curtainside!.displayName).toContain('Curtainside');

    const silo = profiles.find((p) => p.bodyType === 'silo');
    expect(silo!.displayName).toContain('Silo');
  });

  it('detects dominated body types (subset cargo)', () => {
    // Create data where silo cargo is a subset of curtainside cargo
    const data = createBodyTypeTestData();
    // Add cement to curtainside's compatible trailers
    data.gameDefs!.cargo_trailers['cement'].push('scs.curtainside.single_3');
    data.gameDefs!.cargo_trailer_units['cement']['scs.curtainside.single_3'] = 32;

    const lookups = buildLookups(data);
    const profiles = getBodyTypeProfiles(data, lookups);

    // Silo can haul only cement; curtainside can haul electronics + glass + cement
    // So silo should be dominated by curtainside
    const silo = profiles.find((p) => p.bodyType === 'silo');
    if (silo) {
      expect(silo.dominatedBy).toBe('curtainside');
    }
  });
});

describe('getChassisMergeMap', () => {
  it('returns empty map when no chassis merges needed', () => {
    // Simple data: each body type on different chassis model
    const data: AllData = {
      gameDefs: null,
      observations: null,
      cities: [],
      companies: [],
      cargo: [],
      trailers: [
        { id: 'scs.curtainside.single_3', name: 'CS', body_type: 'curtainside', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        { id: 'scs.flatbed.single_3', name: 'FB', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      ],
    };

    const mergeMap = getChassisMergeMap(data);
    expect(mergeMap.size).toBe(0);
  });

  it('detects chassis merges when two body types share a chassis model', () => {
    // scs.flatbed.single_3 and scs.flatbed.container_3 share scs.flatbed chassis
    const data: AllData = {
      gameDefs: null,
      observations: null,
      cities: [],
      companies: [],
      cargo: [],
      trailers: [
        { id: 'scs.flatbed.single_3', name: 'FB', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        { id: 'scs.flatbed.container_3', name: 'Container', body_type: 'container', volume: 60, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      ],
    };

    const mergeMap = getChassisMergeMap(data);
    // container should merge into flatbed (flatbed matches the chassis family name)
    expect(mergeMap.get('container')).toBe('flatbed');
  });

  it('skips non-ownable trailers', () => {
    const data: AllData = {
      gameDefs: null,
      observations: null,
      cities: [],
      companies: [],
      cargo: [],
      trailers: [
        { id: 'scs.flatbed.single_3', name: 'FB', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        { id: 'scs.flatbed.container_3', name: 'Container', body_type: 'container', volume: 60, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: false },
      ],
    };

    const mergeMap = getChassisMergeMap(data);
    // container is non-ownable, so no merge should happen
    expect(mergeMap.size).toBe(0);
  });

  it('prefers body type matching the chassis family name as survivor', () => {
    const data: AllData = {
      gameDefs: null,
      observations: null,
      cities: [],
      companies: [],
      cargo: [],
      trailers: [
        { id: 'scs.flatbed.alpha_3', name: 'Alpha', body_type: 'alpha_body', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        { id: 'scs.flatbed.flatbed_3', name: 'Flatbed', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      ],
    };

    const mergeMap = getChassisMergeMap(data);
    // 'flatbed' matches the family name (scs.flatbed), so alpha_body should merge into flatbed
    expect(mergeMap.get('alpha_body')).toBe('flatbed');
    expect(mergeMap.has('flatbed')).toBe(false); // survivor should not be in the map
  });

  it('handles trailers with single-segment IDs gracefully', () => {
    const data: AllData = {
      gameDefs: null,
      observations: null,
      cities: [],
      companies: [],
      cargo: [],
      trailers: [
        { id: 'simple', name: 'Simple', body_type: 'basic', volume: 50, chassis_mass: 3000, body_mass: 2000, gross_weight_limit: 30000, length: 10, chain_type: 'single', ownable: true },
      ],
    };

    const mergeMap = getChassisMergeMap(data);
    expect(mergeMap.size).toBe(0);
  });
});
