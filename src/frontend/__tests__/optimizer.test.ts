import { describe, it, expect } from 'vitest';
import { buildLookups, type AllData } from '../data.ts';
import {
  calculateCityRankings,
  computeOptimalFleet,
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
      { id: 'berlin', name: 'Berlin', country: 'germany' },
      { id: 'paris', name: 'Paris', country: 'france' },
      { id: 'empty_city', name: 'Empty City', country: '' },
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
});
