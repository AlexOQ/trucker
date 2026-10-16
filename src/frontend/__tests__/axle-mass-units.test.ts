import { describe, it, expect } from 'vitest';
import { buildLookups } from '../lookups';
import {
  buildCityDepotProfiles,
  analyticalFirstPickEVForRep,
  computeProfileTrailerInfoForCountry,
} from '../optimizer';
import type { AllData, Cargo } from '../types';

// #340 — country axle-mass loading limit. Fixtures use value=1 and no bonuses so a
// cargo's bodyHV on a body type equals the units carried, which is what we assert.
//
// lb4: a 4-axle lowboy, 24 t tare, no validity → combination = 2 (4x2 truck) + 4 = 6 axles.
//   germany limit at 6 axles clamps to the array's last entry, 40 t; mass free = 40−7−24 = 9 t.
//   finland at 6 axles = 60 t; mass free = 60−7−24 = 29 t.
// Three lowboy cargo: heavy (21.8 t, no permit), permit (54 t, overweight: true), light (2.75 t).

const common = { fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, excluded: false, groups: [] as string[] };

function cargo(overweightOn: boolean): Record<string, Omit<Cargo, 'id'>> {
  return {
    heavy:  { name: 'Heavy',  value: 1, volume: 10, mass: 21800, body_types: ['lowboy'], ...common },
    permit: { name: 'Permit', value: 1, volume: 10, mass: 54000, body_types: ['lowboy'], ...common, overweight: overweightOn },
    light:  { name: 'Light',  value: 1, volume: 10, mass: 2750,  body_types: ['lowboy'], ...common },
    zone:   { name: 'Zone',   value: 1, volume: 10, mass: 1000,  body_types: ['special'], ...common },
  };
}

const TRAILERS = {
  lb4:    { name: 'Lowboy 4ax', body_type: 'lowboy',  volume: 95, chassis_mass: 24000, body_mass: 0, gross_weight_limit: 79000, length: 20, axles: 4, chain_type: 'single', ownable: true, price: 1, level_floor: 0 },
  // Only legal in finland — exercises the zone bound.
  sp_fi:  { name: 'Special FI', body_type: 'special', volume: 95, chassis_mass: 5000,  body_mass: 0, gross_weight_limit: 79000, length: 20, axles: 3, chain_type: 'single', ownable: true, price: 1, level_floor: 0, country_validity: ['finland'] },
};

/** Base units are given explicitly (5 each) so the only thing that moves them is the mass cap. */
const UNITS = {
  heavy:  { lb4: 5 },
  permit: { lb4: 5 },
  light:  { lb4: 5 },
  zone:   { sp_fi: 5 },
};

function build(overweightOn = true): AllData {
  const c = cargo(overweightOn);
  const gameDefs = {
    cities: {
      de_city: { name: 'DE', country: 'germany' },
      fi_city: { name: 'FI', country: 'finland' },
    },
    countries: {
      germany: { name: 'Germany', mass_limit_per_axle_count: [18000, 26000, 36000, 40000] },
      finland: { name: 'Finland', mass_limit_per_axle_count: [18000, 26000, 36000, 44000, 56000, 60000, 68000, 74000, 84000, 105000] },
    },
    companies: { co: { name: 'Co', cargo_out: ['heavy', 'permit', 'light', 'zone'], cargo_in: [], cities: ['de_city', 'fi_city'] } },
    cargo: c,
    trailers: TRAILERS,
    city_companies: { de_city: { co: 1 }, fi_city: { co: 1 } },
    company_cargo: { co: ['heavy', 'permit', 'light', 'zone'] },
    cargo_trailers: { heavy: ['lb4'], permit: ['lb4'], light: ['lb4'], zone: ['sp_fi'] },
    cargo_trailer_units: UNITS,
    economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
    trucks: [],
  } as unknown as AllData['gameDefs'];

  return {
    gameDefs,
    observations: null,
    cities: [
      { id: 'de_city', name: 'DE', displayName: 'DE', country: 'germany', countryName: 'Germany', hasGarage: true },
      { id: 'fi_city', name: 'FI', displayName: 'FI', country: 'finland', countryName: 'Finland', hasGarage: true },
    ],
    companies: [{ id: 'co', name: 'Co' }],
    cargo: Object.entries(c).map(([id, v]) => ({ id, ...v })),
    trailers: Object.entries(TRAILERS).map(([id, v]) => ({ id, ...v })),
  };
}

/** bodyHV for a (city, cargo, body type) — equals units carried under this fixture. */
function hv(data: AllData, cityId: string, cargoId: string, bodyType: string): number | undefined {
  const lookups = buildLookups(data);
  const depots = buildCityDepotProfiles(cityId, lookups);
  const item = depots?.[0]?.cargo.find((x) => x.cargoId === cargoId);
  return item?.bodyHV[bodyType];
}

describe('#340 axle-mass unit cap', () => {
  it('activates only when the dataset carries overweight permit flags', () => {
    expect(buildLookups(build(true)).massLimitsActive).toBe(true);
    expect(buildLookups(build(false)).massLimitsActive).toBe(false);
  });

  it('kills a dead run: heavy cargo over the limit carries 0 units', () => {
    // germany: 9 t free / 21.8 t per unit = 0 units.
    expect(hv(build(), 'de_city', 'heavy', 'lowboy')).toBe(0);
  });

  it('keeps the dead cargo in the draw pool so it still dilutes the board', () => {
    const lookups = buildLookups(build());
    const depots = buildCityDepotProfiles('de_city', lookups)!;
    // heavy is present (prob_coef retained) even though it hauls nothing.
    expect(depots[0].cargo.some((x) => x.cargoId === 'heavy')).toBe(true);
  });

  it('partial fill: light cargo is capped below its volume units', () => {
    // germany: 9 t free / 2.75 t = 3 units (volume would allow 5).
    expect(hv(build(), 'de_city', 'light', 'lowboy')).toBe(3);
  });

  it('exempts overweight-permit cargo from the cap', () => {
    // permit is 54 t — far over the limit — but rides at its full base units.
    expect(hv(build(), 'de_city', 'permit', 'lowboy')).toBe(5);
  });

  it('is country-dependent: the same cargo/trailer loads more where the limit is higher', () => {
    // finland: 29 t free → heavy = 1 unit, light = full 5.
    expect(hv(build(), 'fi_city', 'heavy', 'lowboy')).toBe(1);
    expect(hv(build(), 'fi_city', 'light', 'lowboy')).toBe(5);
  });

  it('inert gate leaves units at the volume/weight baseline (ATS path)', () => {
    // No overweight flags anywhere → cap off → heavy loads its full base 5 even in germany.
    expect(hv(build(false), 'de_city', 'heavy', 'lowboy')).toBe(5);
  });

  it('analyticalFirstPickEVForRep is country-aware', () => {
    const data = build();
    const lookups = buildLookups(data);
    const deDepots = buildCityDepotProfiles('de_city', lookups)!;
    const fiDepots = buildCityDepotProfiles('fi_city', lookups)!;
    // Heavier loads in finland → higher first-pick EV for the same rep trailer.
    const deEV = analyticalFirstPickEVForRep(deDepots, 'lb4', lookups, 'germany');
    const fiEV = analyticalFirstPickEVForRep(fiDepots, 'lb4', lookups, 'finland');
    expect(fiEV).toBeGreaterThan(deEV);
  });
});

describe('#340 zone bound', () => {
  it('admits a validity-limited trailer only inside its zone', () => {
    const data = build();
    const lookups = buildLookups(data);
    const de = computeProfileTrailerInfoForCountry('germany', data, lookups);
    const fi = computeProfileTrailerInfoForCountry('finland', data, lookups);
    // sp_fi (country_validity: finland) realises the 'special' profile — present in FI, absent in DE.
    expect([...fi.values()].some((p) => p.bodyTypes.includes('special'))).toBe(true);
    expect([...de.values()].some((p) => p.bodyTypes.includes('special'))).toBe(false);
  });
});
