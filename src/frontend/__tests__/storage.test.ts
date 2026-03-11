import { describe, it, expect, beforeEach, vi } from 'vitest';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

const storage = await import('../storage.ts');

describe('storage', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('loadState', () => {
    it('returns default state on empty storage', () => {
      const state = storage.loadState();

      expect(state).toEqual({
        settings: { driverCount: 5 },
        ownedGarages: [],
        garageFilterMode: 'all',
        selectedCountries: [],
        cityTrailers: {},
        ownedTrailerDLCs: storage.ALL_DLC_IDS,
        ownedCargoDLCs: storage.ALL_CARGO_DLC_IDS,
      });
    });

    it('merges stored state with defaults for new fields', () => {
      localStorageMock.setItem(
        'ets2-trucker-advisor',
        JSON.stringify({
          settings: { driverCount: 3 },
          ownedGarages: ['berlin', 'paris'],
        }),
      );

      const state = storage.loadState();

      expect(state.settings.driverCount).toBe(3);
      expect(state.ownedGarages).toEqual(['berlin', 'paris']);
      expect(state.garageFilterMode).toBe('all');
      expect(state.cityTrailers).toEqual({});
    });

    it('returns defaults on invalid JSON', () => {
      localStorageMock.setItem('ets2-trucker-advisor', 'not valid json');
      const state = storage.loadState();
      expect(state.settings.driverCount).toBe(5);
    });
  });

  describe('saveState/loadState round-trip', () => {
    it('persists and retrieves state correctly', () => {
      const testState = {
        settings: { driverCount: 3 },
        ownedGarages: ['berlin', 'paris', 'london'],
        garageFilterMode: 'owned',
        selectedCountries: ['Germany'],
        cityTrailers: { berlin: ['curtainside', 'dryvan'] },
      };

      storage.saveState(testState);
      const loaded = storage.loadState();

      expect(loaded.settings).toEqual(testState.settings);
      expect(loaded.ownedGarages).toEqual(testState.ownedGarages);
      expect(loaded.garageFilterMode).toBe(testState.garageFilterMode);
      expect(loaded.cityTrailers).toEqual(testState.cityTrailers);
    });
  });

  describe('resetToDefaults', () => {
    it('preserves owned garages when resetting settings', () => {
      storage.saveState({
        settings: { driverCount: 3 },
        ownedGarages: ['berlin', 'paris'],
        garageFilterMode: 'owned',
        selectedCountries: ['Germany'],
        cityTrailers: { berlin: ['curtainside'] },
      });

      const resetSettings = storage.resetToDefaults();
      expect(resetSettings.driverCount).toBe(5);

      const state = storage.loadState();
      expect(state.ownedGarages).toEqual(['berlin', 'paris']);
    });

    it('returns default settings values', () => {
      const settings = storage.resetToDefaults();
      expect(settings.driverCount).toBe(5);
    });
  });

  describe('updateSettings', () => {
    it('updates specific settings while preserving others', () => {
      const updated = storage.updateSettings({ driverCount: 3 });
      expect(updated.driverCount).toBe(3);
    });
  });

  describe('garage management', () => {
    it('adds and removes garages correctly', () => {
      expect(storage.getOwnedGarages()).toEqual([]);

      storage.addOwnedGarage('berlin');
      storage.addOwnedGarage('paris');
      expect(storage.getOwnedGarages()).toEqual(['berlin', 'paris']);

      storage.removeOwnedGarage('berlin');
      expect(storage.getOwnedGarages()).toEqual(['paris']);
    });

    it('toggles garage ownership correctly', () => {
      expect(storage.isOwnedGarage('berlin')).toBe(false);

      const added = storage.toggleOwnedGarage('berlin');
      expect(added).toBe(true);
      expect(storage.isOwnedGarage('berlin')).toBe(true);

      const removed = storage.toggleOwnedGarage('berlin');
      expect(removed).toBe(false);
      expect(storage.isOwnedGarage('berlin')).toBe(false);
    });

    it('does not add duplicate garages', () => {
      storage.addOwnedGarage('berlin');
      storage.addOwnedGarage('berlin');
      expect(storage.getOwnedGarages()).toEqual(['berlin']);
    });
  });

  describe('filter mode', () => {
    it('gets and sets filter mode', () => {
      expect(storage.getFilterMode()).toBe('all');
      storage.setFilterMode('owned');
      expect(storage.getFilterMode()).toBe('owned');
    });
  });

  describe('city trailers', () => {
    it('manages per-city trailer sets', () => {
      expect(storage.getCityTrailers('berlin')).toEqual([]);

      storage.addCityTrailer('berlin', 'curtainside');
      storage.addCityTrailer('berlin', 'dryvan');
      expect(storage.getCityTrailers('berlin')).toEqual(['curtainside', 'dryvan']);

      storage.removeCityTrailer('berlin', 0);
      expect(storage.getCityTrailers('berlin')).toEqual(['dryvan']);

      storage.setCityTrailers('berlin', ['flatbed', 'lowbed']);
      expect(storage.getCityTrailers('berlin')).toEqual(['flatbed', 'lowbed']);
    });
  });
});
