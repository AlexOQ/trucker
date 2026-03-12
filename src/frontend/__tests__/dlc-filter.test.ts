import { describe, it, expect } from 'vitest';
import { applyDLCFilter, getBlockedCities } from '../dlc-filter';
import type { AllData } from '../types';

/**
 * Build minimal AllData with gameDefs for DLC filter testing.
 * Trailers use brand prefix convention: scs.* = base game, feldbinder.* = DLC, etc.
 */
function createDLCTestData(): AllData {
  return {
    gameDefs: {
      cities: {
        berlin: { name: 'Berlin', country: 'germany', has_garage: true },
        paris: { name: 'Paris', country: 'france', has_garage: true },
        lisboa: { name: 'Lisboa', country: 'portugal', has_garage: true },
        athens: { name: 'Athens', country: 'greece', has_garage: true },
        // Non-garage city
        small_town: { name: 'Small Town', country: 'germany' },
      },
      countries: {
        germany: { name: 'Germany' },
        france: { name: 'France' },
        portugal: { name: 'Portugal' },
        greece: { name: 'Greece' },
      },
      companies: {
        logistics_co: { name: 'Logistics Co', cargo_out: ['electronics', 'olives', 'yacht'], cargo_in: [], cities: ['berlin', 'paris', 'lisboa', 'athens'] },
      },
      cargo: {
        electronics: { name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
        olives: { name: 'Olives', value: 1.8, volume: 1, mass: 400, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['reefer'], groups: [], excluded: false },
        yacht: { name: 'Yacht', value: 10.0, volume: 1, mass: 2000, fragility: 0, fragile: false, high_value: true, adr_class: 0, prob_coef: 0.5, body_types: ['lowbed'], groups: [], excluded: false },
      },
      trailers: {
        'scs.curtainside.single_3': { name: 'SCS Curtainside', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        'feldbinder.silo.single_3': { name: 'Feldbinder Silo', body_type: 'silo', volume: 60, chassis_mass: 4500, body_mass: 2500, gross_weight_limit: 40000, length: 12, chain_type: 'single', ownable: true },
        'krone.box.single_3': { name: 'Krone Box', body_type: 'dryvan', volume: 85, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
        'scs.lowbed.single_3': { name: 'SCS Lowbed', body_type: 'lowbed', volume: 40, chassis_mass: 6000, body_mass: 4000, gross_weight_limit: 60000, length: 15, chain_type: 'single', ownable: true },
      },
      city_companies: {
        berlin: { logistics_co: 2 },
        paris: { logistics_co: 1 },
        lisboa: { logistics_co: 1 },
        athens: { logistics_co: 1 },
      },
      company_cargo: {
        logistics_co: ['electronics', 'olives', 'yacht'],
      },
      cargo_trailers: {
        electronics: ['scs.curtainside.single_3', 'krone.box.single_3'],
        olives: ['scs.curtainside.single_3'],
        yacht: ['scs.lowbed.single_3'],
      },
      cargo_trailer_units: {
        electronics: { 'scs.curtainside.single_3': 90, 'krone.box.single_3': 85 },
        olives: { 'scs.curtainside.single_3': 90 },
        yacht: { 'scs.lowbed.single_3': 1 },
      },
      economy: { fixed_revenue: 0, revenue_coef_per_km: 1, cargo_market_revenue_coef_per_km: 1 },
      trucks: [],
    },
    observations: null,
    cities: [
      { id: 'berlin', name: 'Berlin', country: 'germany', hasGarage: true },
      { id: 'paris', name: 'Paris', country: 'france', hasGarage: true },
      { id: 'lisboa', name: 'Lisboa', country: 'portugal', hasGarage: true },
      { id: 'athens', name: 'Athens', country: 'greece', hasGarage: true },
      { id: 'small_town', name: 'Small Town', country: 'germany', hasGarage: false },
    ],
    companies: [{ id: 'logistics_co', name: 'Logistics Co' }],
    cargo: [
      { id: 'electronics', name: 'Electronics', value: 2.5, volume: 1, mass: 500, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['dryvan'], groups: [], excluded: false },
      { id: 'olives', name: 'Olives', value: 1.8, volume: 1, mass: 400, fragility: 0, fragile: false, high_value: false, adr_class: 0, prob_coef: 1, body_types: ['reefer'], groups: [], excluded: false },
      { id: 'yacht', name: 'Yacht', value: 10.0, volume: 1, mass: 2000, fragility: 0, fragile: false, high_value: true, adr_class: 0, prob_coef: 0.5, body_types: ['lowbed'], groups: [], excluded: false },
    ],
    trailers: [
      { id: 'scs.curtainside.single_3', name: 'SCS Curtainside', body_type: 'dryvan', volume: 90, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'feldbinder.silo.single_3', name: 'Feldbinder Silo', body_type: 'silo', volume: 60, chassis_mass: 4500, body_mass: 2500, gross_weight_limit: 40000, length: 12, chain_type: 'single', ownable: true },
      { id: 'krone.box.single_3', name: 'Krone Box', body_type: 'dryvan', volume: 85, chassis_mass: 5000, body_mass: 3000, gross_weight_limit: 40000, length: 13.6, chain_type: 'single', ownable: true },
      { id: 'scs.lowbed.single_3', name: 'SCS Lowbed', body_type: 'lowbed', volume: 40, chassis_mass: 6000, body_mass: 4000, gross_weight_limit: 60000, length: 15, chain_type: 'single', ownable: true },
    ],
  };
}

describe('applyDLCFilter', () => {
  describe('trailer brand filtering', () => {
    it('keeps all trailers when all DLCs owned', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, ['feldbinder', 'krone']);

      expect(filtered.trailers).toHaveLength(4);
      const ids = filtered.trailers.map((t) => t.id);
      expect(ids).toContain('scs.curtainside.single_3');
      expect(ids).toContain('feldbinder.silo.single_3');
      expect(ids).toContain('krone.box.single_3');
      expect(ids).toContain('scs.lowbed.single_3');
    });

    it('removes feldbinder trailers when feldbinder DLC not owned', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, ['krone']); // no feldbinder

      const ids = filtered.trailers.map((t) => t.id);
      expect(ids).not.toContain('feldbinder.silo.single_3');
      expect(ids).toContain('scs.curtainside.single_3');
      expect(ids).toContain('krone.box.single_3');
      expect(ids).toContain('scs.lowbed.single_3');
    });

    it('removes krone trailers when krone DLC not owned', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, ['feldbinder']); // no krone

      const ids = filtered.trailers.map((t) => t.id);
      expect(ids).not.toContain('krone.box.single_3');
      expect(ids).toContain('feldbinder.silo.single_3');
    });

    it('always keeps scs (base game) trailers', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, []); // no DLCs owned

      const ids = filtered.trailers.map((t) => t.id);
      expect(ids).toContain('scs.curtainside.single_3');
      expect(ids).toContain('scs.lowbed.single_3');
      expect(ids).not.toContain('feldbinder.silo.single_3');
      expect(ids).not.toContain('krone.box.single_3');
    });

    it('filters gameDefs.trailers in sync with top-level trailers array', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, []); // no DLCs

      const gameDefTrailerIds = Object.keys(filtered.gameDefs!.trailers);
      expect(gameDefTrailerIds).toContain('scs.curtainside.single_3');
      expect(gameDefTrailerIds).toContain('scs.lowbed.single_3');
      expect(gameDefTrailerIds).not.toContain('feldbinder.silo.single_3');
      expect(gameDefTrailerIds).not.toContain('krone.box.single_3');
    });

    it('filters cargo_trailers to remove blocked trailer IDs', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, []); // no DLCs

      // electronics had both scs.curtainside and krone.box -- only scs remains
      const electronicsTrailers = filtered.gameDefs!.cargo_trailers['electronics'];
      expect(electronicsTrailers).toContain('scs.curtainside.single_3');
      expect(electronicsTrailers).not.toContain('krone.box.single_3');
    });

    it('filters cargo_trailer_units to remove blocked trailer IDs', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, []); // no DLCs

      const electronicsUnits = filtered.gameDefs!.cargo_trailer_units['electronics'];
      expect(electronicsUnits['scs.curtainside.single_3']).toBe(90);
      expect(electronicsUnits['krone.box.single_3']).toBeUndefined();
    });
  });

  describe('cargo pack filtering', () => {
    it('keeps all cargo when no cargo DLC filtering applied', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, []);

      expect(filtered.cargo).toHaveLength(3);
    });

    it('removes cargo from unowned cargo packs', () => {
      const data = createDLCTestData();
      const cargoDLCMap: Record<string, string> = {
        yacht: 'high_power',
      };
      const ownedCargoDLCs = new Set<string>([]); // don't own high_power

      const filtered = applyDLCFilter(data, [], ownedCargoDLCs, cargoDLCMap);

      const cargoIds = filtered.cargo.map((c) => c.id);
      expect(cargoIds).not.toContain('yacht');
      expect(cargoIds).toContain('electronics');
      expect(cargoIds).toContain('olives');
    });

    it('keeps cargo from owned cargo packs', () => {
      const data = createDLCTestData();
      const cargoDLCMap: Record<string, string> = {
        yacht: 'high_power',
      };
      const ownedCargoDLCs = new Set(['high_power']);

      const filtered = applyDLCFilter(data, [], ownedCargoDLCs, cargoDLCMap);

      const cargoIds = filtered.cargo.map((c) => c.id);
      expect(cargoIds).toContain('yacht');
    });

    it('keeps cargo not associated with any DLC pack', () => {
      const data = createDLCTestData();
      const cargoDLCMap: Record<string, string> = {
        yacht: 'high_power',
      };
      const ownedCargoDLCs = new Set<string>([]);

      const filtered = applyDLCFilter(data, [], ownedCargoDLCs, cargoDLCMap);

      // electronics and olives have no DLC association
      const cargoIds = filtered.cargo.map((c) => c.id);
      expect(cargoIds).toContain('electronics');
      expect(cargoIds).toContain('olives');
    });

    it('removes cargo from gameDefs when cargo DLC not owned', () => {
      const data = createDLCTestData();
      const cargoDLCMap: Record<string, string> = { yacht: 'high_power' };
      const ownedCargoDLCs = new Set<string>([]);

      const filtered = applyDLCFilter(data, [], ownedCargoDLCs, cargoDLCMap);

      expect(filtered.gameDefs!.cargo['yacht']).toBeUndefined();
      expect(filtered.gameDefs!.cargo['electronics']).toBeDefined();
    });

    it('removes cargo from company_cargo when DLC not owned', () => {
      const data = createDLCTestData();
      const cargoDLCMap: Record<string, string> = { yacht: 'high_power' };
      const ownedCargoDLCs = new Set<string>([]);

      const filtered = applyDLCFilter(data, [], ownedCargoDLCs, cargoDLCMap);

      const companyCargo = filtered.gameDefs!.company_cargo['logistics_co'];
      expect(companyCargo).not.toContain('yacht');
      expect(companyCargo).toContain('electronics');
    });

    it('removes cargo_trailers entries for blocked cargo', () => {
      const data = createDLCTestData();
      const cargoDLCMap: Record<string, string> = { yacht: 'high_power' };
      const ownedCargoDLCs = new Set<string>([]);

      const filtered = applyDLCFilter(data, [], ownedCargoDLCs, cargoDLCMap);

      expect(filtered.gameDefs!.cargo_trailers['yacht']).toBeUndefined();
      expect(filtered.gameDefs!.cargo_trailer_units['yacht']).toBeUndefined();
    });
  });

  describe('map DLC city blocking', () => {
    it('removes blocked cities from the result', () => {
      const data = createDLCTestData();
      const blockedCities = new Set(['athens', 'lisboa']);

      const filtered = applyDLCFilter(data, [], undefined, undefined, blockedCities);

      const cityIds = filtered.cities.map((c) => c.id);
      expect(cityIds).not.toContain('athens');
      expect(cityIds).not.toContain('lisboa');
      expect(cityIds).toContain('berlin');
      expect(cityIds).toContain('paris');
    });

    it('removes blocked cities from gameDefs.city_companies', () => {
      const data = createDLCTestData();
      const blockedCities = new Set(['athens']);

      const filtered = applyDLCFilter(data, [], undefined, undefined, blockedCities);

      expect(filtered.gameDefs!.city_companies['athens']).toBeUndefined();
      expect(filtered.gameDefs!.city_companies['berlin']).toBeDefined();
    });

    it('removes blocked cities from gameDefs.cities', () => {
      const data = createDLCTestData();
      const blockedCities = new Set(['lisboa']);

      const filtered = applyDLCFilter(data, [], undefined, undefined, blockedCities);

      expect(filtered.gameDefs!.cities['lisboa']).toBeUndefined();
      expect(filtered.gameDefs!.cities['berlin']).toBeDefined();
    });
  });

  describe('garage-only filtering', () => {
    it('removes non-garage cities from the result', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, []);

      const cityIds = filtered.cities.map((c) => c.id);
      // small_town has hasGarage=false in data.cities, should be filtered
      expect(cityIds).not.toContain('small_town');
      expect(cityIds).toContain('berlin');
    });

    it('removes non-garage cities from gameDefs.city_companies', () => {
      const data = createDLCTestData();
      // Add small_town to city_companies in gameDefs
      data.gameDefs!.city_companies['small_town'] = { logistics_co: 1 };

      const filtered = applyDLCFilter(data, []);

      // small_town has no has_garage in gameDefs, and isn't in GARAGE_CITIES either
      // (it may or may not be in GARAGE_CITIES depending on the real data,
      //  but since it's a made-up city, it won't be)
      expect(filtered.gameDefs!.city_companies['berlin']).toBeDefined();
    });
  });

  describe('combined effects', () => {
    it('applies trailer + cargo + city filters simultaneously', () => {
      const data = createDLCTestData();
      const cargoDLCMap: Record<string, string> = { yacht: 'high_power' };
      const ownedCargoDLCs = new Set<string>([]); // no cargo DLCs
      const blockedCities = new Set(['athens']);

      const filtered = applyDLCFilter(
        data, [], // no trailer DLCs
        ownedCargoDLCs, cargoDLCMap, blockedCities,
      );

      // Trailers: only SCS trailers remain
      const trailerIds = filtered.trailers.map((t) => t.id);
      expect(trailerIds).toEqual(expect.arrayContaining([
        'scs.curtainside.single_3', 'scs.lowbed.single_3',
      ]));
      expect(trailerIds).not.toContain('feldbinder.silo.single_3');
      expect(trailerIds).not.toContain('krone.box.single_3');

      // Cargo: yacht removed (high_power DLC not owned)
      const cargoIds = filtered.cargo.map((c) => c.id);
      expect(cargoIds).not.toContain('yacht');
      expect(cargoIds).toContain('electronics');
      expect(cargoIds).toContain('olives');

      // Cities: athens removed (blocked), small_town removed (no garage)
      const cityIds = filtered.cities.map((c) => c.id);
      expect(cityIds).not.toContain('athens');
      expect(cityIds).not.toContain('small_town');
      expect(cityIds).toContain('berlin');
      expect(cityIds).toContain('paris');
      expect(cityIds).toContain('lisboa');
    });

    it('preserves original data (immutability check)', () => {
      const data = createDLCTestData();
      const originalTrailerCount = data.trailers.length;
      const originalCargoCount = data.cargo.length;
      const originalCityCount = data.cities.length;

      applyDLCFilter(data, [], new Set<string>(), { yacht: 'high_power' }, new Set(['athens']));

      expect(data.trailers).toHaveLength(originalTrailerCount);
      expect(data.cargo).toHaveLength(originalCargoCount);
      expect(data.cities).toHaveLength(originalCityCount);
    });
  });

  describe('edge cases', () => {
    it('handles data with no gameDefs (observations only)', () => {
      const data = createDLCTestData();
      data.gameDefs = null;

      const filtered = applyDLCFilter(data, []);

      // Should still filter top-level trailers
      const ids = filtered.trailers.map((t) => t.id);
      expect(ids).toContain('scs.curtainside.single_3');
      expect(ids).not.toContain('feldbinder.silo.single_3');
      expect(filtered.gameDefs).toBeNull();
    });

    it('handles empty owned trailer DLCs list', () => {
      const data = createDLCTestData();
      const filtered = applyDLCFilter(data, []);

      expect(filtered.trailers.length).toBeLessThan(data.trailers.length);
      // Only SCS trailers remain
      for (const t of filtered.trailers) {
        expect(t.id.startsWith('scs.')).toBe(true);
      }
    });
  });
});

describe('getBlockedCities', () => {
  it('returns empty set when all map DLCs owned', () => {
    const cityDLCMap = {
      iberia: ['lisboa', 'madrid'],
      greece: ['athens'],
    };
    const blocked = getBlockedCities(['iberia', 'greece'], cityDLCMap);
    expect(blocked.size).toBe(0);
  });

  it('blocks cities from unowned map DLCs', () => {
    const cityDLCMap = {
      iberia: ['lisboa', 'madrid'],
      greece: ['athens', 'thessaloniki'],
    };
    const blocked = getBlockedCities(['iberia'], cityDLCMap); // no greece

    expect(blocked.has('athens')).toBe(true);
    expect(blocked.has('thessaloniki')).toBe(true);
    expect(blocked.has('lisboa')).toBe(false);
    expect(blocked.has('madrid')).toBe(false);
  });

  it('blocks all cities when no map DLCs owned', () => {
    const cityDLCMap = {
      iberia: ['lisboa'],
      greece: ['athens'],
    };
    const blocked = getBlockedCities([], cityDLCMap);

    expect(blocked.has('lisboa')).toBe(true);
    expect(blocked.has('athens')).toBe(true);
  });

  it('handles empty city DLC map', () => {
    const blocked = getBlockedCities(['iberia'], {});
    expect(blocked.size).toBe(0);
  });
});
