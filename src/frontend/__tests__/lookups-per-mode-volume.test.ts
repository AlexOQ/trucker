import { describe, it, expect } from 'vitest';
import { buildLookups } from '../lookups';
import type { AllData } from '../types';

// Multi-body trailer: container mode vol=40, lowboy mode vol=95 (via bodyVolumes).
// Verifies the lookups fan-out picks per-mode volume per cargo.
function makeFixture(bodyVolumes?: Record<string, number>): AllData {
  const trailer = {
    id: 'sll_cont',
    name: 'SLL .cont',
    body_type: 'lowboy',
    extra_body_types: ['container'],
    bodyVolumes,
    volume: 40,
    chassis_mass: 5000,
    body_mass: 3000,
    gross_weight_limit: 60000,
    length: 13.68,
    chain_type: 'single' as const,
    ownable: true,
    price: 0,
    level_floor: 0,
  };
  return {
    gameDefs: {
      cities: { berlin: { name: 'Berlin', country: 'germany' } },
      countries: { germany: { name: 'Germany' } },
      companies: {},
      cargo: {
        small_low: { name: 'Small Low', value: 1, volume: 10, mass: 1000, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['lowboy'], groups: [], excluded: false },
        big_low:   { name: 'Big Low',   value: 1, volume: 70, mass: 1000, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['lowboy'], groups: [], excluded: false },
        cont_iso:  { name: 'Container',  value: 1, volume: 40, mass: 1000, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['container'], groups: [], excluded: false },
      },
      trailers: { sll_cont: { name: 'SLL .cont', body_type: 'lowboy', volume: 40, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 60000, length: 13.68, chain_type: 'single', ownable: true } },
      city_companies: {},
      company_cargo: {},
      cargo_trailers: {},
      cargo_trailer_units: {},
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [{ id: 'berlin', name: 'Berlin', country: 'germany', hasGarage: true }],
    companies: [],
    cargo: [
      { id: 'small_low', name: 'Small Low', value: 1, volume: 10, mass: 1000, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['lowboy'], groups: [], excluded: false },
      { id: 'big_low',   name: 'Big Low',   value: 1, volume: 70, mass: 1000, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['lowboy'], groups: [], excluded: false },
      { id: 'cont_iso',  name: 'Container', value: 1, volume: 40, mass: 1000, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['container'], groups: [], excluded: false },
    ],
    trailers: [trailer],
  };
}

describe('lookups per-mode volume', () => {
  it('without bodyVolumes: falls back to trailer.volume (regression — old behaviour)', () => {
    const data = makeFixture();
    const lookups = buildLookups(data);
    // small_low fits: floor(40/10) = 4 units
    expect(lookups.cargoTrailerUnits.get('small_low:sll_cont')).toBe(4);
    // big_low at vol=40 → floor(40/70)=0, clamped to 1 (legacy fallback)
    expect(lookups.cargoTrailerUnits.get('big_low:sll_cont')).toBe(1);
  });

  it('with bodyVolumes.lowboy: uses 95 m³ bed for lowboy cargo', () => {
    const data = makeFixture({ lowboy: 95 });
    const lookups = buildLookups(data);
    // small_low at vol=95: floor(95/10) = 9 units
    expect(lookups.cargoTrailerUnits.get('small_low:sll_cont')).toBe(9);
    // big_low at vol=95: floor(95/70) = 1 unit (real fit, not clamp)
    expect(lookups.cargoTrailerUnits.get('big_low:sll_cont')).toBe(1);
  });
});
