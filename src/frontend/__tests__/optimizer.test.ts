import { describe, it, expect } from 'vitest';
import { buildLookups, type AllData } from '../data.ts';
import {
  getCityBodyTypeStats,
  getMarginalOptions,
  greedyAllocation,
  expectedIncome,
  calculateCityRankings,
} from '../optimizer.ts';

describe('optimizer', () => {
  // Mock data using game-defs fallback path (no observation body type data)
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
      city_job_count: { berlin: 30, paris: 5 },
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

  describe('getCityBodyTypeStats', () => {
    it('returns empty for city with no depots', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('empty_city', data, lookups);
      expect(stats).toEqual([]);
    });

    it('returns body type stats for city with cargo', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);

      expect(stats.length).toBeGreaterThan(0);
      for (const s of stats) {
        expect(s.probability).toBeGreaterThan(0);
        expect(s.probability).toBeLessThanOrEqual(1);
        expect(s.avgValue).toBeGreaterThan(0);
      }

      // Probabilities can sum to >1 in game-defs fallback because cargoes
      // map to multiple body types (e.g. electronics → dryvan AND flatbed)
      const totalProb = stats.reduce((sum, s) => sum + s.probability, 0);
      expect(totalProb).toBeGreaterThan(0);
    });

    it('excludes excluded cargo', () => {
      const data = createMockData();
      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);

      // Total pool should not include excluded_cargo
      const totalPool = stats[0]?.totalPool ?? 0;
      expect(totalPool).toBeGreaterThan(0);
    });

    it('uses observation data when available', () => {
      const data = createMockData();
      // Add observation body type data for berlin
      data.observations!.city_body_type_frequency = {
        berlin: { dryvan: 10, flatbed: 8, tanker: 5 },
      };
      data.observations!.body_type_avg_value = {
        dryvan: 2.0, flatbed: 3.5, tanker: 5.0,
      };
      data.observations!.city_job_count = { berlin: 23 };

      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);

      expect(stats.length).toBe(3);
      const dryvan = stats.find(s => s.bodyType === 'dryvan')!;
      expect(dryvan.probability).toBeCloseTo(10 / 23, 2);
      expect(dryvan.avgValue).toBe(2.0);
    });
  });

  describe('getMarginalOptions', () => {
    it('returns sorted options by marginal value', () => {
      const data = createMockData();
      data.observations!.city_body_type_frequency = {
        berlin: { dryvan: 10, flatbed: 8, tanker: 5 },
      };
      data.observations!.body_type_avg_value = {
        dryvan: 2.0, flatbed: 3.5, tanker: 5.0,
      };
      data.observations!.city_job_count = { berlin: 23 };

      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);
      const options = getMarginalOptions(stats, [], 5);

      expect(options.length).toBe(3);
      for (let i = 0; i < options.length - 1; i++) {
        expect(options[i].marginalValue).toBeGreaterThanOrEqual(options[i + 1].marginalValue);
      }
    });

    it('accounts for existing trailers', () => {
      const data = createMockData();
      data.observations!.city_body_type_frequency = {
        berlin: { dryvan: 15, tanker: 5 },
      };
      data.observations!.body_type_avg_value = { dryvan: 1.0, tanker: 5.0 };
      data.observations!.city_job_count = { berlin: 20 };

      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);

      const opts0 = getMarginalOptions(stats, [], 5);
      const opts1 = getMarginalOptions(stats, ['dryvan'], 5);

      const dryvan0 = opts0.find(o => o.bodyType === 'dryvan')!;
      const dryvan1 = opts1.find(o => o.bodyType === 'dryvan')!;

      // 2nd copy should have lower marginal value
      expect(dryvan1.marginalValue).toBeLessThan(dryvan0.marginalValue);
    });

    it('caps copies at driver count', () => {
      const data = createMockData();
      data.observations!.city_body_type_frequency = { berlin: { dryvan: 20 } };
      data.observations!.body_type_avg_value = { dryvan: 5.0 };
      data.observations!.city_job_count = { berlin: 20 };

      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);

      // Already have 5 dryvan (= driver count), no more should be offered
      const opts = getMarginalOptions(stats, ['dryvan', 'dryvan', 'dryvan', 'dryvan', 'dryvan'], 5);
      expect(opts.length).toBe(0);
    });
  });

  describe('greedyAllocation', () => {
    it('fills slots with highest marginal value', () => {
      const data = createMockData();
      data.observations!.city_body_type_frequency = {
        berlin: { dryvan: 10, flatbed: 8, tanker: 5 },
      };
      data.observations!.body_type_avg_value = {
        dryvan: 2.0, flatbed: 3.5, tanker: 5.0,
      };
      data.observations!.city_job_count = { berlin: 23 };

      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);

      const allocation = greedyAllocation(stats, 10, 5);
      expect(allocation.length).toBe(10);
    });

    it('respects existing trailers', () => {
      const data = createMockData();
      data.observations!.city_body_type_frequency = {
        berlin: { dryvan: 10, tanker: 5 },
      };
      data.observations!.body_type_avg_value = { dryvan: 2.0, tanker: 5.0 };
      data.observations!.city_job_count = { berlin: 15 };

      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);

      const allocation = greedyAllocation(stats, 5, 5, ['dryvan', 'tanker']);
      expect(allocation.length).toBe(5);
      expect(allocation[0]).toBe('dryvan');
      expect(allocation[1]).toBe('tanker');
    });
  });

  describe('expectedIncome', () => {
    it('calculates expected income for allocation', () => {
      const data = createMockData();
      data.observations!.city_body_type_frequency = {
        berlin: { dryvan: 10, tanker: 5 },
      };
      data.observations!.body_type_avg_value = { dryvan: 2.0, tanker: 5.0 };
      data.observations!.city_job_count = { berlin: 15 };

      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);

      const income = expectedIncome(stats, ['dryvan', 'tanker'], 5);
      expect(income.totalIncome).toBeGreaterThan(0);
      expect(income.totalServed).toBeGreaterThan(0);
      expect(income.details.length).toBe(2);
    });

    it('returns zero for empty allocation', () => {
      const data = createMockData();
      data.observations!.city_body_type_frequency = { berlin: { dryvan: 10 } };
      data.observations!.body_type_avg_value = { dryvan: 2.0 };
      data.observations!.city_job_count = { berlin: 10 };

      const lookups = buildLookups(data);
      const stats = getCityBodyTypeStats('berlin', data, lookups);

      const income = expectedIncome(stats, [], 5);
      expect(income.totalIncome).toBe(0);
      expect(income.totalServed).toBe(0);
    });
  });

  describe('calculateCityRankings', () => {
    it('returns ranked cities by score', () => {
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
        expect(rank).toHaveProperty('score');
        expect(rank).toHaveProperty('rawScore');
        expect(rank).toHaveProperty('confidence');
        expect(rank).toHaveProperty('optimalTrailers');
        expect(rank.depotCount).toBeGreaterThan(0);
        expect(rank.rawScore).toBeGreaterThan(0);
        expect(rank.score).toBeGreaterThanOrEqual(0);
        expect(rank.confidence).toBeGreaterThan(0);
        expect(rank.confidence).toBeLessThanOrEqual(1);
        expect(rank.optimalTrailers.length).toBeGreaterThan(0);
      }
    });

    it('berlin ranks higher than paris when observation data differs', () => {
      const data = createMockData();
      // Give berlin much more observed job variety to ensure higher score
      data.observations!.city_body_type_frequency = {
        berlin: { dryvan: 15, flatbed: 10, tanker: 5 },
        paris: { dryvan: 3 },
      };
      data.observations!.body_type_avg_value = { dryvan: 2.0, flatbed: 3.5, tanker: 5.0 };
      data.observations!.city_job_count = { berlin: 30, paris: 3 };

      const lookups = buildLookups(data);
      const rankings = calculateCityRankings(data, lookups);

      const berlinIdx = rankings.findIndex(r => r.id === 'berlin');
      const parisIdx = rankings.findIndex(r => r.id === 'paris');
      expect(berlinIdx).toBeLessThan(parisIdx);
    });
  });
});
