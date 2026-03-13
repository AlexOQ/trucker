import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AllData } from '../types';
import { buildLookups } from '../lookups';

/**
 * Build minimal AllData for optimizer-client fallback tests.
 */
function createMockData(): AllData {
  return {
    gameDefs: {
      cities: {
        berlin: { name: 'Berlin', country: 'germany', has_garage: true },
      },
      countries: { germany: { name: 'Germany' } },
      companies: {
        logistics_co: {
          name: 'Logistics Co',
          cargo_out: ['electronics'],
          cargo_in: [],
          cities: ['berlin'],
        },
      },
      cargo: {
        electronics: { name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
      },
      trailers: {
        'scs.curtainside.single_3': { name: 'SCS Curtainside', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      },
      city_companies: { berlin: { logistics_co: 2 } },
      company_cargo: { logistics_co: ['electronics'] },
      cargo_trailers: { electronics: ['scs.curtainside.single_3'] },
      cargo_trailer_units: { electronics: { 'scs.curtainside.single_3': 90 } },
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [{ id: 'berlin', name: 'Berlin', country: 'germany', hasGarage: true }],
    companies: [{ id: 'logistics_co', name: 'Logistics Co' }],
    cargo: [
      { id: 'electronics', name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
    ],
    trailers: [
      { id: 'scs.curtainside.single_3', name: 'SCS Curtainside', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
    ],
  };
}

describe('optimizer-client sync fallback', () => {
  // In jsdom test environment, Worker is undefined.
  // optimizer-client should fall back to synchronous imports.

  beforeEach(() => {
    vi.resetModules();
  });

  it('computeFleetAsync falls back to sync when Worker unavailable', async () => {
    // Dynamic import to get fresh module state after resetModules
    const { computeFleetAsync } = await import('../optimizer-client');
    const data = createMockData();
    const lookups = buildLookups(data);

    const fleet = await computeFleetAsync('berlin', data, lookups);

    expect(fleet).not.toBeNull();
    expect(fleet!.drivers.length).toBeGreaterThan(0);
    expect(fleet!.totalTrailers).toBeGreaterThan(0);
    for (const driver of fleet!.drivers) {
      expect(driver.ev).toBeGreaterThan(0);
      expect(driver.bodyType).toBeTruthy();
    }
  });

  it('computeFleetAsync returns null for city with no depots', async () => {
    const { computeFleetAsync } = await import('../optimizer-client');
    const data = createMockData();
    // Add empty city
    data.cities.push({ id: 'empty', name: 'Empty', country: 'germany', hasGarage: true });
    data.gameDefs!.cities['empty'] = { name: 'Empty', country: 'germany', has_garage: true };
    const lookups = buildLookups(data);

    const fleet = await computeFleetAsync('empty', data, lookups);
    expect(fleet).toBeNull();
  });

  it('computeRankingsAsync falls back to sync when Worker unavailable', async () => {
    const { computeRankingsAsync } = await import('../optimizer-client');
    const data = createMockData();
    const lookups = buildLookups(data);

    const rankings = await computeRankingsAsync(data, lookups);

    expect(rankings.length).toBeGreaterThan(0);
    for (const r of rankings) {
      expect(r.id).toBeTruthy();
      expect(r.name).toBeTruthy();
      expect(r.score).toBeGreaterThan(0);
      expect(r.depotCount).toBeGreaterThan(0);
    }
  });

  it('computeRankingsAsync sorts cities by score descending', async () => {
    const { computeRankingsAsync } = await import('../optimizer-client');
    const data = createMockData();
    // Add a second city with fewer depots
    data.cities.push({ id: 'paris', name: 'Paris', country: 'france', hasGarage: true });
    data.gameDefs!.cities['paris'] = { name: 'Paris', country: 'france', has_garage: true };
    data.gameDefs!.countries!['france'] = { name: 'France' };
    data.gameDefs!.city_companies['paris'] = { logistics_co: 1 };
    const lookups = buildLookups(data);

    const rankings = await computeRankingsAsync(data, lookups);

    for (let i = 0; i < rankings.length - 1; i++) {
      expect(rankings[i].score).toBeGreaterThanOrEqual(rankings[i + 1].score);
    }
  });

  it('terminateWorker is safe to call when no worker exists', async () => {
    const { terminateWorker } = await import('../optimizer-client');
    // Should not throw when worker is null
    expect(() => terminateWorker()).not.toThrow();
  });
});
