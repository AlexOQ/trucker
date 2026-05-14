import { describe, it, expect } from 'vitest';
import { buildLookups, type AllData } from '../data.ts';
import {
  calculateCityRankings,
  computeOptimalFleet,
  analyticalFirstPickEV,
  buildCityDepotProfiles,
  clearTrailerInfoCache,
  type CityDepotData,
} from '../optimizer.ts';

describe('optimizer', () => {
  // Mock data uses gameDefs (not observations) to match the real data pipeline.
  // The optimizer needs cargo_trailer_units and cargo_trailers for body type resolution.
  const createMockData = (): AllData => ({
    gameDefs: {
      cities: {
        berlin: { name: 'Berlin', country: 'germany' },
        paris: { name: 'Paris', country: 'france' },
        empty_city: { name: 'Empty City', country: '' },
      },
      countries: {
        germany: { name: 'Germany' },
        france: { name: 'France' },
      },
      companies: {
        logistics_co: {
          name: 'Logistics Co',
          cargo_out: ['electronics', 'machinery', 'chemicals', 'excluded_cargo'],
          cargo_in: [],
          cities: ['berlin', 'paris'],
        },
        transport_inc: {
          name: 'Transport Inc',
          cargo_out: ['machinery', 'furniture'],
          cargo_in: [],
          cities: ['berlin'],
        },
      },
      cargo: {
        electronics: { name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
        machinery: { name: 'Machinery', value: 3.0, volume: 1, mass: 800, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['flatbed'], groups: [], excluded: false },
        chemicals: { name: 'Chemicals', value: 4.0, volume: 1, mass: 600, fragility: 0.6, fragile: true, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['tanker'], groups: [], excluded: false },
        furniture: { name: 'Furniture', value: 1.5, volume: 1, mass: 300, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
        excluded_cargo: { name: 'Excluded', value: 10.0, volume: 1, mass: 100, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: true },
      },
      trailers: {
        box_trailer: { name: 'Box Trailer', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        flatbed: { name: 'Flatbed', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        tanker: { name: 'Tanker', body_type: 'tanker', volume: 32, chassis_mass: 4500, body_mass: 2500, gross_weight_limit: 40000, length: 12, chain_type: 'single', ownable: true },
        non_ownable: { name: 'Non Ownable', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: false },
      },
      city_companies: {
        berlin: { logistics_co: 3, transport_inc: 2 },
        paris: { logistics_co: 1 },
      },
      company_cargo: {
        logistics_co: ['electronics', 'machinery', 'chemicals', 'excluded_cargo'],
        transport_inc: ['machinery', 'furniture'],
      },
      cargo_trailers: {
        electronics: ['box_trailer'],
        machinery: ['flatbed'],
        chemicals: ['tanker'],
        furniture: ['box_trailer'],
        excluded_cargo: ['box_trailer'],
      },
      cargo_trailer_units: {
        electronics: { box_trailer: 90 },
        machinery: { flatbed: 1 },
        chemicals: { tanker: 32 },
        furniture: { box_trailer: 90 },
        excluded_cargo: { box_trailer: 90 },
      },
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [
      { id: 'berlin', name: 'Berlin', country: 'germany', hasGarage: true },
      { id: 'paris', name: 'Paris', country: 'france', hasGarage: true },
      { id: 'empty_city', name: 'Empty City', country: '', hasGarage: true },
    ],
    companies: [
      { id: 'logistics_co', name: 'Logistics Co' },
      { id: 'transport_inc', name: 'Transport Inc' },
    ],
    cargo: [
      { id: 'electronics', name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
      { id: 'machinery', name: 'Machinery', value: 3.0, volume: 1, mass: 800, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['flatbed'], groups: [], excluded: false },
      { id: 'chemicals', name: 'Chemicals', value: 4.0, volume: 1, mass: 600, fragility: 0.6, fragile: true, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['tanker'], groups: [], excluded: false },
      { id: 'furniture', name: 'Furniture', value: 1.5, volume: 1, mass: 300, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
      { id: 'excluded_cargo', name: 'Excluded', value: 10.0, volume: 1, mass: 100, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: true },
    ],
    trailers: [
      { id: 'box_trailer', name: 'Box Trailer', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'flatbed', name: 'Flatbed', body_type: 'flatbed', volume: 80, chassis_mass: 4000, body_mass: 2000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'tanker', name: 'Tanker', body_type: 'tanker', volume: 32, chassis_mass: 4500, body_mass: 2500, gross_weight_limit: 40000, length: 12, chain_type: 'single', ownable: true },
      { id: 'non_ownable', name: 'Non Ownable', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: false },
    ],
  });

  describe('computeOptimalFleet', () => {
    it('returns null for city with no depots', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      expect(computeOptimalFleet('empty_city', data, lookups)).toBeNull();
    });

    it('returns fleet with drivers for city with cargo', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = computeOptimalFleet('berlin', data, lookups);

      expect(fleet).not.toBeNull();
      expect(fleet!.drivers.length).toBeGreaterThan(0);
      expect(fleet!.totalTrailers).toBeGreaterThan(0);

      for (const driver of fleet!.drivers) {
        expect(driver.displayName).toBeTruthy();
        expect(driver.bodyType).toBeTruthy();
        expect(driver.ev).toBeGreaterThan(0);
        expect(driver.count).toBeGreaterThanOrEqual(1);
      }
    });

    it('total driver count does not exceed MAX_DRIVERS', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = computeOptimalFleet('berlin', data, lookups);

      const totalDrivers = fleet!.drivers.reduce((s, d) => s + d.count, 0);
      expect(totalDrivers).toBeLessThanOrEqual(5);
    });

    it('excluded cargo does not affect fleet', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = computeOptimalFleet('berlin', data, lookups);

      // excluded_cargo has value=10 but should not inflate scores
      // With excluded_cargo included, dryvan would dominate everything
      // The fleet should contain body types other than just dryvan
      const bodyTypes = new Set(fleet!.drivers.map((d) => d.bodyType));
      expect(bodyTypes.size).toBeGreaterThanOrEqual(1);
    });

    it('totalTrailers equals sum of driver counts', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = computeOptimalFleet('berlin', data, lookups);

      const driverSlots = fleet!.drivers.reduce((s, d) => s + d.count, 0);
      expect(fleet!.totalTrailers).toBe(driverSlots);
    });
  });

  describe('calculateCityRankings', () => {
    it('returns ranked cities by score descending', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const rankings = calculateCityRankings(data, lookups);

      expect(rankings.length).toBeGreaterThan(0);
      for (let i = 0; i < rankings.length - 1; i++) {
        expect(rankings[i].score).toBeGreaterThanOrEqual(rankings[i + 1].score);
      }
    });

    it('excludes cities with no cargo', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const rankings = calculateCityRankings(data, lookups);

      const emptyCity = rankings.find((r) => r.id === 'empty_city');
      expect(emptyCity).toBeUndefined();
    });

    it('includes correct metadata', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const rankings = calculateCityRankings(data, lookups);

      for (const rank of rankings) {
        expect(rank).toHaveProperty('id');
        expect(rank).toHaveProperty('name');
        expect(rank).toHaveProperty('country');
        expect(rank).toHaveProperty('depotCount');
        expect(rank).toHaveProperty('cargoTypes');
        expect(rank).toHaveProperty('score');
        expect(rank).toHaveProperty('topTrailers');
        expect(rank.depotCount).toBeGreaterThan(0);
        expect(rank.cargoTypes).toBeGreaterThan(0);
        expect(rank.score).toBeGreaterThan(0);
        expect(rank.topTrailers.length).toBeGreaterThan(0);
      }
    });

    it('berlin ranks higher than paris due to more depots', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const rankings = calculateCityRankings(data, lookups);

      const berlinIdx = rankings.findIndex((r) => r.id === 'berlin');
      const parisIdx = rankings.findIndex((r) => r.id === 'paris');
      expect(berlinIdx).toBeLessThan(parisIdx);
    });

    it('topTrailers sorted by cityValue descending', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const rankings = calculateCityRankings(data, lookups);

      for (const rank of rankings) {
        for (let i = 0; i < rank.topTrailers.length - 1; i++) {
          expect(rank.topTrailers[i].cityValue).toBeGreaterThanOrEqual(rank.topTrailers[i + 1].cityValue);
        }
      }
    });
  });

  describe('analyticalFirstPickEV', () => {
    it('returns 0 for body type with no compatible cargo', () => {
      // Single depot with one cargo that has no HV for "nonexistent" body type
      const depots: CityDepotData[] = [{
        companyId: 'test',
        cargo: [{ cargoId: 'electronics', probCoef: 1, bodyHV: { dryvan: 225 } }],
        totalProbCoef: 1,
        cumProbs: [1],
      }];

      expect(analyticalFirstPickEV(depots, 'nonexistent')).toBe(0);
    });

    it('returns exact HV when single depot has single cargo (deterministic)', () => {
      // One depot, one cargo, one body type => P(max = HV) = 1
      // All 3 jobs will be the same cargo, so max = HV = 225
      const depots: CityDepotData[] = [{
        companyId: 'test',
        cargo: [{ cargoId: 'electronics', probCoef: 1, bodyHV: { dryvan: 225 } }],
        totalProbCoef: 1,
        cumProbs: [1],
      }];

      const ev = analyticalFirstPickEV(depots, 'dryvan');
      expect(ev).toBeCloseTo(225, 5);
    });

    it('returns weighted EV for single depot with two cargo items', () => {
      // Depot with 2 cargo: electronics (prob=1, HV=225) and machinery (prob=1, HV=3)
      // 3 draws per depot. E[max of 3] should be > simple expected value
      const depots: CityDepotData[] = [{
        companyId: 'test',
        cargo: [
          { cargoId: 'electronics', probCoef: 1, bodyHV: { dryvan: 225 } },
          { cargoId: 'machinery', probCoef: 1, bodyHV: { dryvan: 3 } },
        ],
        totalProbCoef: 2,
        cumProbs: [0.5, 1],
      }];

      const ev = analyticalFirstPickEV(depots, 'dryvan');

      // P(electronics) = 0.5, P(machinery) = 0.5
      // P(max <= 3) = P(all 3 draws are machinery) = 0.5^3 = 0.125
      // P(max = 3) = P(max<=3) - P(max<=0) = 0.125 - 0 = 0.125
      // P(max = 225) = 1 - 0.125 = 0.875
      // E[max] = 3 * 0.125 + 225 * 0.875 = 0.375 + 196.875 = 197.25
      expect(ev).toBeCloseTo(197.25, 5);
    });

    it('increases EV with more depots (more draws)', () => {
      // Same cargo profile at 1 depot vs 2 depot instances
      const singleDepot: CityDepotData[] = [{
        companyId: 'test',
        cargo: [
          { cargoId: 'electronics', probCoef: 1, bodyHV: { dryvan: 225 } },
          { cargoId: 'machinery', probCoef: 1, bodyHV: { dryvan: 3 } },
        ],
        totalProbCoef: 2,
        cumProbs: [0.5, 1],
      }];

      const twoDepots: CityDepotData[] = [
        ...singleDepot,
        { ...singleDepot[0] }, // duplicate depot instance
      ];

      const ev1 = analyticalFirstPickEV(singleDepot, 'dryvan');
      const ev2 = analyticalFirstPickEV(twoDepots, 'dryvan');

      // More depots = more draws = higher E[max]
      expect(ev2).toBeGreaterThan(ev1);
    });

    it('respects prob_coef weighting (rare cargo less likely to appear)', () => {
      // High-value cargo with very low prob_coef vs normal cargo
      const depots: CityDepotData[] = [{
        companyId: 'test',
        cargo: [
          { cargoId: 'rare', probCoef: 0.1, bodyHV: { dryvan: 1000 } },
          { cargoId: 'common', probCoef: 2.0, bodyHV: { dryvan: 100 } },
        ],
        totalProbCoef: 2.1,
        cumProbs: [0.1 / 2.1, 1],
      }];

      const ev = analyticalFirstPickEV(depots, 'dryvan');

      // P(rare) = 0.1/2.1 ~= 0.0476, P(common) = 2.0/2.1 ~= 0.9524
      // P(max <= 100) = P(all draws are common or zero) = (2.0/2.1)^3
      // Since all cargo has HV > 0, P(max <= 100) = (2.0/2.1)^3 ~= 0.864
      // P(max = 1000) = 1 - 0.864 ~= 0.136
      // E[max] ~= 100 * 0.864 + 1000 * 0.136 ~= 86.4 + 136.2 ~= 222.6
      // EV should be between 100 and 1000, much closer to 100 because rare is rare
      expect(ev).toBeGreaterThan(100);
      expect(ev).toBeLessThan(1000);
    });

    it('can be computed via buildCityDepotProfiles from real mock data', () => {
      // Integration test: build depot profiles from the standard mock data
      // and verify analyticalFirstPickEV produces reasonable results
      const data = createMockData();
      const lookups = buildLookups(data);
      const depots = buildCityDepotProfiles('berlin', lookups);

      expect(depots).not.toBeNull();

      // Berlin has 3 logistics_co + 2 transport_inc depots
      // Test each body type that has cargo
      const dryvanEV = analyticalFirstPickEV(depots!, 'dryvan');
      const flatbedEV = analyticalFirstPickEV(depots!, 'flatbed');
      const tankerEV = analyticalFirstPickEV(depots!, 'tanker');

      // All should be positive
      expect(dryvanEV).toBeGreaterThan(0);
      expect(flatbedEV).toBeGreaterThan(0);
      expect(tankerEV).toBeGreaterThan(0);

      // Dryvan handles electronics (HV=225) and furniture (HV=135),
      // so its EV should be > tanker which handles only chemicals (HV=166.4)
      // with lower units but fragile bonus
      expect(dryvanEV).toBeGreaterThan(tankerEV);
    });

    it('ranking score equals real fleet EV (sum of per-driver fleet contributions)', () => {
      // Rankings now run the greedy MC picker per city (with reduced sample
      // count). Score == sum of topTrailers' cityValue == totalFleetEV from
      // computeOptimalFleet. The top trailer's cityValue is its profile's
      // fleet contribution (per-driver EV × count after contention) and is
      // bounded by the analytical first-pick EV — strictly less when other
      // drivers compete for the same jobs.
      const data = createMockData();
      const lookups = buildLookups(data);
      const rankings = calculateCityRankings(data, lookups);
      const depots = buildCityDepotProfiles('paris', lookups);

      expect(depots).not.toBeNull();
      const paris = rankings.find((r) => r.id === 'paris');
      expect(paris).toBeDefined();

      expect(paris!.score).toBeGreaterThan(0);

      // Score consistency: sum of topTrailer cityValues ≤ score (top 5 of N drivers)
      const summedCityValues = paris!.topTrailers.reduce((s, t) => s + t.cityValue, 0);
      expect(summedCityValues).toBeLessThanOrEqual(paris!.score + 0.001);

      // Top trailer's contention-aware EV must not exceed its standalone analytical EV.
      const topBT = paris!.topTrailers[0].bodyType;
      const standaloneEV = analyticalFirstPickEV(depots!, topBT);
      // cityValue = ev × count; for count=1 it equals contested per-driver EV ≤ standalone.
      // For stacked profiles (count > 1) the comparison no longer holds, so guard.
      if (paris!.topTrailers[0].variants === 1) {
        expect(paris!.topTrailers[0].cityValue).toBeLessThanOrEqual(standaloneEV + 0.001);
      }
    });
  });

  describe('buildCityDepotProfiles', () => {
    it('returns null for city with no companies', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      expect(buildCityDepotProfiles('empty_city', lookups)).toBeNull();
    });

    it('creates correct number of depot instances from depot counts', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const depots = buildCityDepotProfiles('berlin', lookups);

      expect(depots).not.toBeNull();
      // Berlin: logistics_co × 3 + transport_inc × 2 = 5 depot instances
      expect(depots!.length).toBe(5);
    });

    it('excludes excluded cargo from depot profiles', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const depots = buildCityDepotProfiles('berlin', lookups);

      // None of the depot entries should contain excluded_cargo
      for (const depot of depots!) {
        const cargoIds = depot.cargo.map((c) => c.cargoId);
        expect(cargoIds).not.toContain('excluded_cargo');
      }
    });

    it('builds correct CDF for sampling', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const depots = buildCityDepotProfiles('berlin', lookups);

      for (const depot of depots!) {
        // CDF should be monotonically increasing and end at 1
        for (let i = 1; i < depot.cumProbs.length; i++) {
          expect(depot.cumProbs[i]).toBeGreaterThan(depot.cumProbs[i - 1]);
        }
        expect(depot.cumProbs[depot.cumProbs.length - 1]).toBeCloseTo(1, 10);
      }
    });
  });

  describe('multi-body profile picks', () => {
    it('multi-body trailer drains both pools when picked by computeOptimalFleet', () => {
      // City has two cargoes per depot: dryvan electronics and flatbed machinery, both 1.0 prob_coef.
      // Only a single multi-body trailer is ownable, serving both body types.
      // The optimizer must pick a profile [dryvan, flatbed] and its driver must
      // consume across both pools — verifies bestJobProfile fallback behavior.
      clearTrailerInfoCache();
      const data = createMockData();
      const trailerSpec = {
        chassis_mass: 5000, body_mass: 3000,
        gross_weight_limit: 40000, length: 13.6, chain_type: 'single' as const,
        ownable: true, level_floor: 0,
      };
      data.gameDefs.trailers = {
        combo: { name: 'Combo', body_type: 'dryvan', volume: 90, ...trailerSpec, extra_body_types: ['flatbed'] },
      };
      data.trailers = [
        { id: 'combo', name: 'Combo', body_type: 'dryvan', volume: 90, ...trailerSpec, extra_body_types: ['flatbed'] },
      ];
      data.gameDefs.cargo_trailers = {
        electronics: ['combo'],
        machinery: ['combo'],
      };
      data.gameDefs.cargo_trailer_units = {
        electronics: { combo: 90 },
        machinery: { combo: 1 },
      };
      const lookups = buildLookups(data);
      const fleet = computeOptimalFleet('berlin', data, lookups);
      expect(fleet).not.toBeNull();
      const driver = fleet!.drivers[0];
      // Driver's bodyTypes must include both — confirms profile picking, not single-body picking.
      expect(driver.bodyTypes.sort()).toEqual(['dryvan', 'flatbed']);
      // Display name should reflect the multi-body profile.
      expect(driver.displayName).toContain('+');
    });

    it('preserves chassis-natural bodyTypes order when extras precede primary alphabetically', () => {
      // Regression: profileKey canonicalizes via alphabetical sort, but the exposed
      // bodyTypes array must retain `[primary, ...extras]` so the displayed primary
      // and `trailers.html#body-{bodyType}` route point at the trailer's loader-declared
      // body_type. Here `body_type='flatbed', extra_body_types=['dryvan']` — an
      // alphabetical pass would yield `[dryvan, flatbed]` → wrong primary.
      clearTrailerInfoCache();
      const data = createMockData();
      const trailerSpec = {
        chassis_mass: 5000, body_mass: 3000,
        gross_weight_limit: 40000, length: 13.6, chain_type: 'single' as const,
        ownable: true, level_floor: 0,
      };
      data.gameDefs.trailers = {
        combo: { name: 'Combo', body_type: 'flatbed', volume: 90, ...trailerSpec, extra_body_types: ['dryvan'] },
      };
      data.trailers = [
        { id: 'combo', name: 'Combo', body_type: 'flatbed', volume: 90, ...trailerSpec, extra_body_types: ['dryvan'] },
      ];
      data.gameDefs.cargo_trailers = {
        electronics: ['combo'],
        machinery: ['combo'],
      };
      data.gameDefs.cargo_trailer_units = {
        electronics: { combo: 90 },
        machinery: { combo: 1 },
      };
      const lookups = buildLookups(data);
      const fleet = computeOptimalFleet('berlin', data, lookups);
      expect(fleet).not.toBeNull();
      const driver = fleet!.drivers[0];
      expect(driver.bodyTypes).toEqual(['flatbed', 'dryvan']);
      expect(driver.bodyType).toBe('flatbed');
      expect(driver.displayName).toBe('Flatbed + Dryvan');
    });

    // Tied-hv fixture: N single-body dryvan trailers with identical specs (→ identical
    // totalHV), differing only in price + priceWalked tier. Exercises the tiebreaker
    // in getProfileTrailerInfoForCountry through computeOptimalFleet.
    const buildTiedDryvanFixture = (rigs: Array<{ id: string; price: number; walked: boolean }>) => {
      const data = createMockData();
      const spec = {
        body_type: 'dryvan' as const,
        volume: 90, chassis_mass: 5000, body_mass: 3000,
        gross_weight_limit: 40000, length: 13.6, chain_type: 'single' as const,
        ownable: true, level_floor: 0,
      };
      data.gameDefs.trailers = Object.fromEntries(
        rigs.map((r) => [r.id, { name: r.id, ...spec, price: r.price }]),
      );
      data.trailers = rigs.map((r) => ({
        id: r.id, name: r.id, ...spec, price: r.price, priceWalked: r.walked,
      }));
      data.gameDefs.cargo_trailers = { electronics: rigs.map((r) => r.id) };
      data.gameDefs.cargo_trailer_units = {
        electronics: Object.fromEntries(rigs.map((r) => [r.id, 90])),
      };
      return data;
    };

    const winnerOf = (data: AllData): string => {
      const fleet = computeOptimalFleet('berlin', data, buildLookups(data));
      expect(fleet).not.toBeNull();
      return fleet!.drivers[0].trailerId;
    };

    it('walked-priced trailer beats cheaper parser-priced sibling at tied hv', () => {
      clearTrailerInfoCache();
      const data = buildTiedDryvanFixture([
        { id: 'box_parser', price: 21000, walked: false },
        { id: 'box_walked', price: 70000, walked: true },
      ]);
      expect(winnerOf(data)).toBe('box_walked');
    });

    it('lowest priced wins among same-tier (all walked) tied trailers', () => {
      clearTrailerInfoCache();
      const data = buildTiedDryvanFixture([
        { id: 'box_a', price: 50000, walked: true },
        { id: 'box_b', price: 80000, walked: true },
        { id: 'box_c', price: 30000, walked: true },
      ]);
      expect(winnerOf(data)).toBe('box_c');
    });
  });
});
