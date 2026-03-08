import { describe, it, expect } from 'vitest';
import { buildLookups, type AllData } from '../data.ts';
import { optimizeTrailerSet, calculateCityRankings } from '../optimizer.ts';

describe('optimizer', () => {
  // Build AllData with observations-based structure and uniform spawn weights
  // Trailers need body_type for the body-type-based optimizer
  const createMockData = (): AllData => {
    const observations = {
      meta: { saves_parsed: 1, total_jobs: 100 },
      cities: ['berlin', 'paris', 'empty_city'],
      companies: ['logistics_co', 'transport_inc'],
      cargo: ['electronics', 'machinery', 'chemicals', 'furniture', 'excluded_cargo'],
      trailers: ['box_trailer', 'flatbed', 'tanker', 'non_ownable'],
      city_companies: {
        berlin: { logistics_co: 3, transport_inc: 2 },
        paris: { logistics_co: 1 },
        // empty_city has no companies
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
      // All equal frequency so global weights are all 1.0
      cargo_frequency: {
        electronics: 10,
        machinery: 10,
        chemicals: 10,
        furniture: 10,
        excluded_cargo: 10,
      },
      cargo_spawn_weight: {},
      cargo_trailer_units: {},
      company_cargo_frequency: {},
    };

    const titleCase = (id: string) =>
      id
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    return {
      observations,
      cities: observations.cities.map((id) => ({
        id,
        name: titleCase(id),
        country: '',
      })),
      companies: observations.companies.map((id) => ({
        id,
        name: titleCase(id),
      })),
      cargo: [
        { id: 'electronics', name: 'Electronics', value: 2.5, fragile: false, high_value: false, excluded: false },
        { id: 'machinery', name: 'Machinery', value: 3.0, fragile: false, high_value: false, excluded: false },
        { id: 'chemicals', name: 'Chemicals', value: 4.0, fragile: true, high_value: false, excluded: false },
        { id: 'furniture', name: 'Furniture', value: 1.5, fragile: false, high_value: false, excluded: false },
        { id: 'excluded_cargo', name: 'Excluded Cargo', value: 10.0, fragile: false, high_value: false, excluded: true },
      ],
      trailers: [
        { id: 'box_trailer', name: 'Box Trailer', body_type: 'dryvan', volume: 90, chassis_mass: 0, body_mass: 0, gross_weight_limit: 0, length: 13.6, chain_type: 'single', ownable: true },
        { id: 'flatbed', name: 'Flatbed', body_type: 'flatbed', volume: 80, chassis_mass: 0, body_mass: 0, gross_weight_limit: 0, length: 13.6, chain_type: 'single', ownable: true },
        { id: 'tanker', name: 'Tanker', body_type: 'tanker', volume: 32, chassis_mass: 0, body_mass: 0, gross_weight_limit: 0, length: 12, chain_type: 'single', ownable: true },
        { id: 'non_ownable', name: 'Non Ownable', body_type: 'dryvan', volume: 90, chassis_mass: 0, body_mass: 0, gross_weight_limit: 0, length: 13.6, chain_type: 'single', ownable: false },
      ],
    };
  };

  describe('optimizeTrailerSet', () => {
    it('returns empty recommendations for city with no depots', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('empty_city', data, lookups);

      expect(result.cityId).toBe('empty_city');
      expect(result.totalDepots).toBe(0);
      expect(result.totalCargoInstances).toBe(0);
      expect(result.totalValue).toBe(0);
      expect(result.recommendations).toEqual([]);
    });

    it('optimizes trailer set for city with cargo', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      expect(result.cityId).toBe('berlin');
      expect(result.totalDepots).toBe(5); // 3 + 2 depots
      expect(result.totalCargoInstances).toBeGreaterThan(0);
      expect(result.totalValue).toBeGreaterThan(0);
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.length).toBeLessThanOrEqual(10);
    });

    it('excludes non-ownable trailers from recommendations', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      const nonOwnableRec = result.recommendations.find((r) => r.trailerId === 'non_ownable');
      expect(nonOwnableRec).toBeUndefined();
    });

    it('excludes excluded cargo from value calculations', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      // City 1 has (all spawn weights = 1.0):
      // - Electronics (2.5) x 3 depots = 7.5
      // - Machinery (3.0) x 5 depots = 15.0 (logistics_co: 3, transport_inc: 2)
      // - Chemicals (4.0 * 1.3 fragile bonus) x 3 depots = 15.6
      // - Furniture (1.5) x 2 depots = 3.0
      // Total: 7.5 + 15.0 + 15.6 + 3.0 = 41.1
      expect(result.totalValue).toBe(41.1);
    });

    it('respects maxTrailers option', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result3 = optimizeTrailerSet('berlin', data, lookups, { maxTrailers: 3 });
      const result10 = optimizeTrailerSet('berlin', data, lookups, { maxTrailers: 10 });

      const totalCount3 = result3.recommendations.reduce((sum, r) => sum + r.count, 0);
      const totalCount10 = result10.recommendations.reduce((sum, r) => sum + r.count, 0);

      expect(totalCount3).toBe(3);
      expect(totalCount10).toBe(10);
    });

    it('handles maxTrailers: 1 correctly', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups, { maxTrailers: 1 });

      expect(result.recommendations.length).toBe(1);
      expect(result.recommendations[0].count).toBe(1);
    });

    it('handles maxTrailers: 20 correctly', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups, { maxTrailers: 20 });

      const totalCount = result.recommendations.reduce((sum, r) => sum + r.count, 0);
      expect(totalCount).toBe(20);
    });

    it('applies diminishingFactor: 0 (no penalty for duplicates)', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups, { diminishingFactor: 0, maxTrailers: 10 });

      // With factor 0 (dim = 0^count), only first copy of each body type gets selected
      // because 0^1 = 0 for subsequent copies
      // Actually dim=0/100=0, pow(0, 0)=1, pow(0, 1)=0 — only first copy matters
      expect(result.recommendations.length).toBe(3); // 3 body types
    });

    it('applies diminishingFactor: 100 (allows duplicates)', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups, { diminishingFactor: 100, maxTrailers: 10 });

      // With factor 100 (dim = 1.0^count = 1.0 always), top body type fills all slots
      expect(result.recommendations.length).toBe(1);
      expect(result.recommendations[0].count).toBe(10);
    });

    it('includes correct metadata in each recommendation', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      for (const rec of result.recommendations) {
        expect(rec).toHaveProperty('trailerId');
        expect(rec).toHaveProperty('trailerName');
        expect(rec).toHaveProperty('count');
        expect(rec).toHaveProperty('coveragePct');
        expect(rec).toHaveProperty('avgValue');
        expect(rec).toHaveProperty('score');
        expect(rec).toHaveProperty('topCargoes');

        expect(typeof rec.trailerId).toBe('string');
        expect(typeof rec.trailerName).toBe('string');
        expect(rec.count).toBeGreaterThan(0);
        expect(rec.coveragePct).toBeGreaterThanOrEqual(0);
        expect(rec.avgValue).toBeGreaterThan(0);
        expect(rec.score).toBeGreaterThan(0);
        expect(Array.isArray(rec.topCargoes)).toBe(true);
        expect(rec.topCargoes.length).toBeLessThanOrEqual(5);
      }
    });

    it('sorts recommendations by count DESC, then score DESC', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups, { maxTrailers: 10 });

      for (let i = 0; i < result.recommendations.length - 1; i++) {
        const curr = result.recommendations[i];
        const next = result.recommendations[i + 1];

        if (curr.count === next.count) {
          expect(curr.score).toBeGreaterThanOrEqual(next.score);
        } else {
          expect(curr.count).toBeGreaterThan(next.count);
        }
      }
    });

    it('preserves options in result', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const options = {
        maxTrailers: 15,
        diminishingFactor: 30,
      };

      const result = optimizeTrailerSet('berlin', data, lookups, options);

      expect(result.options).toEqual(options);
    });

    it('uses default options when not provided', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      expect(result.options.maxTrailers).toBe(10);
      expect(result.options.diminishingFactor).toBe(75);
    });

    it('applies fragile cargo bonus correctly', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      // Chemicals are fragile, value 4.0 * 1.3 = 5.2
      // tanker body type handles chemicals and machinery
      const tankerRec = result.recommendations.find((r) => r.trailerId === 'tanker');
      expect(tankerRec).toBeDefined();
      expect(result.totalValue).toBeGreaterThan(41.0);
    });

    it('recommends body types not individual trailer IDs', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      // Recommendations should be body types: dryvan, flatbed, tanker
      const bodyTypes = result.recommendations.map((r) => r.trailerId);
      for (const bt of bodyTypes) {
        expect(['dryvan', 'flatbed', 'tanker']).toContain(bt);
      }
    });

    it('eliminates dominated body types', () => {
      const data = createMockData();
      // Add a curtainside trailer that hauls everything dryvan can plus more
      data.trailers.push({
        id: 'curtainside_trailer', name: 'Curtainside', body_type: 'curtainside', ownable: true,
      });
      // curtainside hauls everything box_trailer (dryvan) hauls plus chemicals
      data.observations!.cargo_trailers.electronics.push('curtainside_trailer');
      data.observations!.cargo_trailers.furniture.push('curtainside_trailer');
      data.observations!.cargo_trailers.chemicals.push('curtainside_trailer');
      data.observations!.trailers.push('curtainside_trailer');

      const lookups = buildLookups(data);
      const result = optimizeTrailerSet('berlin', data, lookups);

      // dryvan is now dominated by curtainside (subset of its cargoes)
      const dryvanRec = result.recommendations.find((r) => r.trailerId === 'dryvan');
      expect(dryvanRec).toBeUndefined();
    });

    it('applies tier multipliers for double trailers', () => {
      const data = createMockData();
      // Add a double version of dryvan
      data.trailers.push({
        id: 'scs.box.double_3_2.dryvan', name: 'Double Dryvan', body_type: 'dryvan', ownable: true,
        country_validity: ['germany'],
      });
      data.observations!.cargo_trailers.electronics.push('scs.box.double_3_2.dryvan');
      data.observations!.cargo_trailers.furniture.push('scs.box.double_3_2.dryvan');
      data.observations!.trailers.push('scs.box.double_3_2.dryvan');

      // Set berlin's country to germany
      data.cities[0].country = 'germany';

      const lookups = buildLookups(data);
      const result = optimizeTrailerSet('berlin', data, lookups);

      // Should have both standard dryvan and double dryvan
      const doubleRec = result.recommendations.find((r) => r.trailerId === 'dryvan_double');
      expect(doubleRec).toBeDefined();
      expect(doubleRec!.trailerName).toContain('Double');
    });
  });

  describe('calculateCityRankings', () => {
    it('returns ranked cities by profitability score', () => {
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

    it('includes correct metadata for each city', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const rankings = calculateCityRankings(data, lookups);

      for (const rank of rankings) {
        expect(rank).toHaveProperty('id');
        expect(rank).toHaveProperty('name');
        expect(rank).toHaveProperty('country');
        expect(rank).toHaveProperty('depotCount');
        expect(rank).toHaveProperty('jobs');
        expect(rank).toHaveProperty('totalValue');
        expect(rank).toHaveProperty('avgValuePerJob');
        expect(rank).toHaveProperty('score');

        expect(typeof rank.id).toBe('string');
        expect(typeof rank.name).toBe('string');
        expect(typeof rank.country).toBe('string');
        expect(rank.depotCount).toBeGreaterThan(0);
        expect(rank.jobs).toBeGreaterThan(0);
        expect(rank.totalValue).toBeGreaterThan(0);
        expect(rank.avgValuePerJob).toBeGreaterThan(0);
        expect(rank.score).toBeGreaterThan(0);
      }
    });

    it('calculates score as geometric mean of jobs and value', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const rankings = calculateCityRankings(data, lookups);

      for (const rank of rankings) {
        const expectedScore = Math.round(Math.sqrt(rank.jobs * rank.totalValue) * 10) / 10;
        expect(rank.score).toBe(expectedScore);
      }
    });
  });

  describe('edge cases', () => {
    it('handles city with single depot type', () => {
      const data = createMockData();
      data.observations!.city_companies = { berlin: { logistics_co: 1 } };
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      expect(result.totalDepots).toBe(1);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('handles city where all cargo is excluded', () => {
      const data = createMockData();
      data.cargo.forEach((c) => {
        c.excluded = true;
      });
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      expect(result.totalCargoInstances).toBe(0);
      expect(result.recommendations).toEqual([]);
    });

    it('handles city with single compatible body type', () => {
      const data = createMockData();
      data.trailers = [
        { id: 'box_trailer', name: 'Box Trailer', body_type: 'dryvan', ownable: true },
        { id: 'flatbed', name: 'Flatbed', body_type: 'flatbed', ownable: false },
        { id: 'tanker', name: 'Tanker', body_type: 'tanker', ownable: false },
      ];
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups, { maxTrailers: 10 });

      expect(result.recommendations.length).toBe(1);
      expect(result.recommendations[0].trailerId).toBe('dryvan');
      expect(result.recommendations[0].count).toBe(10);
    });

    it('handles cargo with both fragile and high_value bonuses', () => {
      const data = createMockData();
      data.observations!.cargo.push('precious_goods');
      data.cargo.push({
        id: 'precious_goods',
        name: 'Precious Goods',
        value: 5.0,
        excluded: false,
        fragile: true,
        high_value: true,
      });
      data.observations!.company_cargo.logistics_co.push('precious_goods');
      data.observations!.cargo_trailers.precious_goods = ['box_trailer'];
      data.observations!.cargo_frequency.precious_goods = 10;
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups);

      // Precious Goods: 5.0 * 1.6 = 8.0 per depot, 3 depots = 24.0
      // Previous 41.1 + 24.0 = 65.1
      expect(result.totalValue).toBeGreaterThan(65.0);
    });

    it('handles very large maxTrailers value', () => {
      const data = createMockData();
      const lookups = buildLookups(data);

      const result = optimizeTrailerSet('berlin', data, lookups, { maxTrailers: 100 });

      const totalCount = result.recommendations.reduce((sum, r) => sum + r.count, 0);
      expect(totalCount).toBe(100);
    });
  });
});
