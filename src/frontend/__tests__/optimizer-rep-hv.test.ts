import { describe, it, expect } from 'vitest';
import { buildLookups } from '../lookups';
import { buildCityDepotProfiles, analyticalFirstPickEVForRep } from '../optimizer';
import type { AllData } from '../types';

// Fixture: two lowboy trailers competing in one city for three lowboy cargoes.
// SLL .cont (multi-body lowboy+container, gwl=59t) — bodyVolumes.lowboy=95 lifts
// its lowboy volume above the native container slot's 40, but its weight cap
// excludes the heavy cargo. SCS 4-axle (pure lowboy, gwl=79t) — carries everything.
// Verifies analyticalFirstPickEVForRep reflects per-rep weight clamping:
// SLL's EV credits 0 HV for heavy cargo; SCS's EV credits heavy properly.
//
// Closed-form EV assertions (173/27, 249/27) assume JOBS_PER_DEPOT=3. If that
// constant moves, recompute the expected values — don't chase the math as a bug.
// Heavy cargo mass=60000 exaggerates the clamp margin for clarity; real ETS2
// max-mass lowboy cargo (log_stacker at 54t) still clamps but more tightly.
function build(): AllData {
  const common = { chassis_mass: 5000, body_mass: 3000, length: 13.68, level_floor: 0 };
  const cargo = {
    light: { name: 'Light', value: 2,  volume: 20, mass: 1000,  fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['lowboy'], groups: [], excluded: false },
    mid:   { name: 'Mid',   value: 3,  volume: 50, mass: 1000,  fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['lowboy'], groups: [], excluded: false },
    heavy: { name: 'Heavy', value: 10, volume: 30, mass: 60000, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['lowboy'], groups: [], excluded: false },
  };
  // SCS 4-axle: 79t gwl → cargo cap 71t → carries heavy (60t) at 1 unit.
  // light volume-units = floor(95/20)=4, mid = floor(95/50)=1, heavy = floor(95/30)=3
  // weight-units for heavy = floor(71000/60000)=1 → final = 1.
  const parserUnits = {
    light: { scs_4ax: 4 },
    mid:   { scs_4ax: 1 },
    heavy: { scs_4ax: 1 },
  };
  return {
    gameDefs: {
      cities: { test_city: { name: 'Test', country: 'test_country' } },
      countries: { test_country: { name: 'Test' } },
      companies: { co: { name: 'Co', cargo_out: ['light', 'mid', 'heavy'], cargo_in: [], cities: ['test_city'] } },
      cargo,
      trailers: {
        sll_cont: { name: 'SLL .cont', body_type: 'lowboy', volume: 40, gross_weight_limit: 59000, chain_type: 'single', ownable: true, ...common },
        scs_4ax:  { name: 'SCS 4-axle', body_type: 'lowboy', volume: 95, gross_weight_limit: 79000, chain_type: 'single', ownable: true, ...common },
      },
      city_companies: { test_city: { co: 1 } },
      company_cargo: { co: ['light', 'mid', 'heavy'] },
      cargo_trailers: { light: ['scs_4ax'], mid: ['scs_4ax'], heavy: ['scs_4ax'] },
      cargo_trailer_units: parserUnits,
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [{ id: 'test_city', name: 'Test', country: 'test_country', hasGarage: true }],
    companies: [{ id: 'co', name: 'Co' }],
    cargo: [
      { id: 'light', ...cargo.light },
      { id: 'mid',   ...cargo.mid },
      { id: 'heavy', ...cargo.heavy },
    ],
    trailers: [
      // SLL .cont has extra_body_types=['container'] so the lookups fan-out applies bodyVolumes.lowboy=95
      // when computing per-cargo units. Weight clamp excludes heavy cargo (60t > 51t cargo cap).
      { id: 'sll_cont', name: 'SLL .cont', body_type: 'lowboy', extra_body_types: ['container'], bodyVolumes: { lowboy: 95 }, volume: 40, gross_weight_limit: 59000, chain_type: 'single', ownable: true, ...common },
      { id: 'scs_4ax',  name: 'SCS 4-axle', body_type: 'lowboy', volume: 95, gross_weight_limit: 79000, chain_type: 'single', ownable: true, ...common },
    ],
  };
}

describe('analyticalFirstPickEVForRep — rep-specific HV with weight clamp', () => {
  it('weight-clamped rep contributes 0 HV for cargo it cannot carry', () => {
    const data = build();
    const lookups = buildLookups(data);

    // Fan-out registers SLL .cont for light + mid (volume-fit at vol=95) but
    // skips heavy because the 51t cargo cap < 60t cargo mass. SCS 4-axle's
    // parser-set units (provided in gameDefs.cargo_trailer_units) cover all three.
    expect(lookups.cargoTrailerUnits.get('light:sll_cont')).toBe(4);
    expect(lookups.cargoTrailerUnits.get('mid:sll_cont')).toBe(1);
    expect(lookups.cargoTrailerUnits.get('heavy:sll_cont')).toBeUndefined();
    expect(lookups.cargoTrailerUnits.get('heavy:scs_4ax')).toBe(1);
  });

  it('rep EV reflects weight clamping — SCS 4-axle beats SLL .cont when heavy cargo is present', () => {
    const data = build();
    const lookups = buildLookups(data);
    const depots = buildCityDepotProfiles('test_city', lookups);
    expect(depots).not.toBeNull();

    const sllEV = analyticalFirstPickEVForRep(depots!, 'sll_cont', lookups);
    const scsEV = analyticalFirstPickEVForRep(depots!, 'scs_4ax', lookups);

    // Closed-form expected values for the fixture (1 depot, 3 jobs, 3 equiprobable cargo):
    //   SLL.cont: hvSet = {0 (heavy clamped), 3 (mid), 8 (light)}
    //     totalCDF(0) = (1/3)^3 = 1/27, totalCDF(3) = (2/3)^3 = 8/27, totalCDF(8) = 1
    //     E[max] = 3 × (8 − 1)/27 + 8 × (27 − 8)/27 = 21/27 + 152/27 = 173/27 ≈ 6.407
    //   SCS 4-axle: hvSet = {3 (mid), 8 (light), 10 (heavy)}
    //     totalCDF(0) = 0, totalCDF(3) = 1/27, totalCDF(8) = 8/27, totalCDF(10) = 1
    //     E[max] = 3 × 1/27 + 8 × 7/27 + 10 × 19/27 = (3 + 56 + 190)/27 = 249/27 ≈ 9.222
    expect(sllEV).toBeCloseTo(173 / 27, 5);
    expect(scsEV).toBeCloseTo(249 / 27, 5);
    expect(scsEV).toBeGreaterThan(sllEV);
  });
});
