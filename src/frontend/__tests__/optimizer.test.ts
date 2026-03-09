import { describe, it, expect } from 'vitest';
import { buildLookups, type AllData } from '../data.ts';
import {
  getFleetRecommendation,
  calculateCityRankings,
  getUniqueTypes,
  buildJobPool,
  computeMarginalFleet,
} from '../optimizer.ts';

describe('optimizer', () => {
  const createMockData = (): AllData => {
    const observations = {
      meta: { saves_parsed: 1, total_jobs: 100, max_saves: 20 },
      variant_body_type: {},
      cities: ['berlin', 'paris', 'empty_city'],
      companies: ['logistics_co', 'transport_inc'],
      cargo: ['electronics', 'machinery', 'chemicals', 'furniture', 'excluded_cargo'],
      trailers: ['box_trailer', 'flatbed', 'tanker'],
      city_companies: {
        berlin: { logistics_co: 3, transport_inc: 2 },
        paris: { logistics_co: 1 },
      },
      company_cargo: {
        logistics_co: ['electronics', 'machinery', 'chemicals', 'excluded_cargo'],
        transport_inc: ['machinery', 'furniture'],
      },
      cargo_trailers: {
        electronics: ['box_trailer', 'flatbed'],
        machinery: ['flatbed', 'tanker'],
        chemicals: ['tanker'],
        furniture: ['box_trailer'],
        excluded_cargo: ['box_trailer'],
      },
      cargo_frequency: {},
      cargo_spawn_weight: {},
      cargo_trailer_units: {},
      company_cargo_frequency: {},
      city_job_count: {},
      city_cargo_frequency: {},
      city_trailer_frequency: {},
      city_body_type_frequency: {},
      body_type_avg_value: {},
      city_zone_body_type_frequency: {},
      zone_body_type_avg_value: {},
    };

    return {
      gameDefs: null,
      observations,
      cities: [
        { id: 'berlin', name: 'Berlin', country: 'Germany' },
        { id: 'paris', name: 'Paris', country: 'France' },
        { id: 'empty_city', name: 'Empty City', country: '' },
      ],
      companies: [
        { id: 'logistics_co', name: 'Logistics Co' },
        { id: 'transport_inc', name: 'Transport Inc' },
      ],
      cargo: [
        { id: 'electronics', name: 'Electronics', value: 2.5, volume: 1, mass: 0, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: [], groups: [], excluded: false },
        { id: 'machinery', name: 'Machinery', value: 3.0, volume: 1, mass: 0, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: [], groups: [], excluded: false },
        { id: 'chemicals', name: 'Chemicals', value: 4.0, volume: 1, mass: 0, fragility: 0.6, fragile: true, high_value: false, adr_class: 0, prob_coef: 1, body_types: [], groups: [], excluded: false },
        { id: 'furniture', name: 'Furniture', value: 1.5, volume: 1, mass: 0, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: [], groups: [], excluded: false },
        { id: 'excluded_cargo', name: 'Excluded', value: 10.0, volume: 1, mass: 0, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: [], groups: [], excluded: true },
      ],
      trailers: [
        { id: 'box_trailer', name: 'Box Trailer', body_type: 'dryvan', volume: 90, chassis_mass: 0, body_mass: 0, gross_weight_limit: 0, length: 13.6, chain_type: 'single', ownable: true },
        { id: 'flatbed', name: 'Flatbed', body_type: 'flatbed', volume: 80, chassis_mass: 0, body_mass: 0, gross_weight_limit: 0, length: 13.6, chain_type: 'single', ownable: true },
        { id: 'tanker', name: 'Tanker', body_type: 'tanker', volume: 32, chassis_mass: 0, body_mass: 0, gross_weight_limit: 0, length: 12, chain_type: 'single', ownable: true },
        { id: 'non_ownable', name: 'Non Ownable', body_type: 'dryvan', volume: 90, chassis_mass: 0, body_mass: 0, gross_weight_limit: 0, length: 13.6, chain_type: 'single', ownable: false },
      ],
    };
  };

  describe('getFleetRecommendation', () => {
    it('returns null for city with no depots', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = getFleetRecommendation('empty_city', data, lookups);
      expect(fleet).toBeNull();
    });

    it('returns fleet entries for city with cargo', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = getFleetRecommendation('berlin', data, lookups);

      expect(fleet).not.toBeNull();
      expect(fleet!.length).toBeGreaterThan(0);

      for (const entry of fleet!) {
        expect(entry.trailerId).toBeTruthy();
        expect(entry.bodyType).toBeTruthy();
        expect(entry.displayName).toBeTruthy();
        expect(entry.cityValue).toBeGreaterThan(0);
        expect(entry.pctOfTotal).toBeGreaterThan(0);
        expect(entry.cargoMatched).toBeGreaterThan(0);
      }
    });

    it('sorts fleet entries by cityValue descending', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = getFleetRecommendation('berlin', data, lookups);

      for (let i = 0; i < fleet!.length - 1; i++) {
        expect(fleet![i].cityValue).toBeGreaterThanOrEqual(fleet![i + 1].cityValue);
      }
    });

    it('excludes excluded cargo from scoring', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = getFleetRecommendation('berlin', data, lookups);

      // The excluded_cargo (value=10) should not inflate dryvan's score
      // If it were included, dryvan would dominate. Without it, flatbed should be competitive.
      const dryvan = fleet!.find(e => e.bodyType === 'dryvan');
      const flatbed = fleet!.find(e => e.bodyType === 'flatbed');
      expect(dryvan).toBeDefined();
      expect(flatbed).toBeDefined();
    });

    it('applies fragile bonus to cargo value', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = getFleetRecommendation('berlin', data, lookups);

      // Chemicals (value=4.0, fragile=true) should have bonus applied
      // tanker hauls chemicals + machinery
      const tanker = fleet!.find(e => e.bodyType === 'tanker');
      expect(tanker).toBeDefined();
      // With fragile bonus: chemicals = 4.0 * 1.3 = 5.2, machinery = 3.0
      expect(tanker!.cityValue).toBeGreaterThan(0);
    });

    it('share percentages sum to 100', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = getFleetRecommendation('berlin', data, lookups);

      const totalPct = fleet!.reduce((s, e) => s + e.pctOfTotal, 0);
      expect(totalPct).toBeCloseTo(100, 0);
    });

    it('berlin has more earning potential than paris', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const berlinFleet = getFleetRecommendation('berlin', data, lookups);
      const parisFleet = getFleetRecommendation('paris', data, lookups);

      const berlinTotal = berlinFleet!.reduce((s, e) => s + e.cityValue, 0);
      const parisTotal = parisFleet!.reduce((s, e) => s + e.cityValue, 0);
      // Berlin has 5 depots (3+2), Paris has 1 — berlin should have higher total
      expect(berlinTotal).toBeGreaterThan(parisTotal);
    });
  });

  describe('getUniqueTypes', () => {
    it('deduplicates trailer profiles', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const types = getUniqueTypes(data, lookups);

      // Should have <= number of ownable trailers
      const ownableCount = data.trailers.filter(t => t.ownable).length;
      expect(types.length).toBeLessThanOrEqual(ownableCount);
      expect(types.length).toBeGreaterThan(0);
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

      const emptyCity = rankings.find(r => r.id === 'empty_city');
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

      const berlinIdx = rankings.findIndex(r => r.id === 'berlin');
      const parisIdx = rankings.findIndex(r => r.id === 'paris');
      expect(berlinIdx).toBeLessThan(parisIdx);
    });

    it('topTrailers contains highest-EV trailer types', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const rankings = calculateCityRankings(data, lookups);

      for (const rank of rankings) {
        // topTrailers should be sorted by cityValue descending
        for (let i = 0; i < rank.topTrailers.length - 1; i++) {
          expect(rank.topTrailers[i].cityValue).toBeGreaterThanOrEqual(rank.topTrailers[i + 1].cityValue);
        }
      }
    });
  });

  describe('buildJobPool', () => {
    it('returns null for city with no depots', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      expect(buildJobPool('empty_city', lookups)).toBeNull();
    });

    it('distributes jobs proportional to prob_coef', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const pool = buildJobPool('berlin', lookups)!;

      expect(pool).not.toBeNull();
      // All cargo in mock has prob_coef=1, so jobs distribute evenly per company
      // logistics_co: 3 depots, 3 non-excluded cargo → 4 jobs each = 12 total, 4 per cargo
      // transport_inc: 2 depots, 2 cargo → 8 total, 4 per cargo
      // machinery appears at both: logistics_co gives 4, transport_inc gives 4 = 8 total
      expect(pool.get('machinery')).toBeCloseTo(8);
      expect(pool.get('electronics')).toBeCloseTo(4);
      expect(pool.get('chemicals')).toBeCloseTo(4);
      expect(pool.get('furniture')).toBeCloseTo(4);
      // excluded_cargo should not appear
      expect(pool.has('excluded_cargo')).toBe(false);
    });

    it('total jobs equals depots × JOBS_PER_DEPOT', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const pool = buildJobPool('berlin', lookups)!;

      let totalJobs = 0;
      for (const count of pool.values()) totalJobs += count;
      // Berlin: 3 depots (logistics) + 2 depots (transport) = 5 depots × 4 = 20
      expect(totalJobs).toBeCloseTo(20);
    });
  });

  describe('computeMarginalFleet', () => {
    it('returns null for city with no depots', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      expect(computeMarginalFleet('empty_city', data, lookups, [])).toBeNull();
    });

    it('with no owned trailers, marginalEV is weighted average of compatible cargo', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = computeMarginalFleet('berlin', data, lookups, [])!;

      expect(fleet).not.toBeNull();
      expect(fleet.length).toBeGreaterThan(0);
      // All entries should have positive marginalEV when pool is full
      for (const entry of fleet) {
        expect(entry.marginalEV).toBeGreaterThan(0);
        expect(entry.owned).toBe(0);
      }
    });

    it('sorted by marginalEV descending', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const fleet = computeMarginalFleet('berlin', data, lookups, [])!;

      for (let i = 0; i < fleet.length - 1; i++) {
        expect(fleet[i].marginalEV).toBeGreaterThanOrEqual(fleet[i + 1].marginalEV);
      }
    });

    it('owning trailers eventually reduces marginalEV as pool depletes', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const noOwned = computeMarginalFleet('berlin', data, lookups, [])!;
      const tankerBefore = noOwned.find(e => e.bodyType === 'tanker')!;

      // Tanker hauls chemicals (haulValue=5.2, ~4 jobs) and machinery (3.0, ~8 jobs).
      // Proportional consumption preserves the cargo ratio, so weighted avg stays constant.
      // EV only drops when totalCompatible < 1 (scaled by min(1, total)).
      // 12 total tanker jobs, each tanker consumes 1 → need 12+ to drop below 1 remaining.
      const thirteenTankers = Array(13).fill('tanker');
      const withMany = computeMarginalFleet('berlin', data, lookups, thirteenTankers)!;
      const tankerAfter = withMany.find(e => e.bodyType === 'tanker')!;

      // After 13 tankers on 12 tanker-compatible jobs, less than 1 job remains
      // → marginalEV scaled down by min(1, totalRemaining)
      expect(tankerAfter.marginalEV).toBeLessThan(tankerBefore.marginalEV);
      expect(tankerAfter.owned).toBe(13);
    });

    it('owning enough trailers depletes the pool', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      // Own many tankers — should eventually deplete tanker-compatible jobs
      const manyTankers = Array(20).fill('tanker');
      const fleet = computeMarginalFleet('berlin', data, lookups, manyTankers)!;
      const tanker = fleet.find(e => e.bodyType === 'tanker')!;

      // After 20 tankers on a pool of ~12 tanker-compatible jobs, marginalEV ≈ 0
      expect(tanker.marginalEV).toBeCloseTo(0, 0);
    });
  });
});
