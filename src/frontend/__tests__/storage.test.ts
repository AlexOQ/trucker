import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

// Set up global localStorage mock before importing the module
vi.stubGlobal('localStorage', localStorageMock);

// Dynamic import after mocking
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
        settings: {
          maxTrailers: 10,
          diminishingFactor: 75,
        },
        ownedGarages: [],
        garageFilterMode: 'all',
        selectedCountries: [],
        ownedTrailers: {},
      });
    });

    it('merges stored state with defaults for new fields', () => {
      localStorageMock.setItem(
        'ets2-trucker-advisor',
        JSON.stringify({
          settings: { maxTrailers: 15 },
          ownedGarages: ['berlin', 'paris', 'hamburg'],
        }),
      );

      const state = storage.loadState();

      expect(state.settings.maxTrailers).toBe(15);
      expect(state.settings.diminishingFactor).toBe(75); // Default
      expect(state.ownedGarages).toEqual(['berlin', 'paris', 'hamburg']);
      expect(state.garageFilterMode).toBe('all'); // Default
    });

    it('returns defaults on invalid JSON', () => {
      localStorageMock.setItem('ets2-trucker-advisor', 'not valid json');

      const state = storage.loadState();

      expect(state.settings.maxTrailers).toBe(10);
    });
  });

  describe('saveState/loadState round-trip', () => {
    it('persists and retrieves state correctly', () => {
      const testState = {
        settings: {
          maxTrailers: 15,
          diminishingFactor: 30,
        },
        ownedGarages: ['berlin', 'paris', 'london'],
        garageFilterMode: 'owned',
        ownedTrailers: { scs_dry: 2, scs_gosck20: 4 },
      };

      storage.saveState(testState);
      const loaded = storage.loadState();

      expect(loaded.settings).toEqual(testState.settings);
      expect(loaded.ownedGarages).toEqual(testState.ownedGarages);
      expect(loaded.garageFilterMode).toBe(testState.garageFilterMode);
      expect(loaded.ownedTrailers).toEqual(testState.ownedTrailers);
    });

    it('handles empty arrays and objects', () => {
      const testState = {
        settings: {
          maxTrailers: 10,
          diminishingFactor: 75,
        },
        ownedGarages: [],
        garageFilterMode: 'all',
        ownedTrailers: {},
      };

      storage.saveState(testState);
      const loaded = storage.loadState();

      expect(loaded.ownedGarages).toEqual([]);
      expect(loaded.ownedTrailers).toEqual({});
    });
  });

  describe('resetToDefaults', () => {
    it('preserves owned garages when resetting settings', () => {
      const customState = {
        settings: {
          maxTrailers: 20,
          diminishingFactor: 80,
        },
        ownedGarages: ['berlin', 'paris', 'hamburg', 'london', 'rome'],
        garageFilterMode: 'owned',
        ownedTrailers: {},
      };
      storage.saveState(customState);

      const resetSettings = storage.resetToDefaults();

      expect(resetSettings).toEqual({
        maxTrailers: 10,
        diminishingFactor: 75,
      });

      const state = storage.loadState();
      expect(state.ownedGarages).toEqual(['berlin', 'paris', 'hamburg', 'london', 'rome']);
    });

    it('returns default settings values', () => {
      const settings = storage.resetToDefaults();

      expect(settings.maxTrailers).toBe(10);
      expect(settings.diminishingFactor).toBe(75);
    });
  });

  describe('updateSettings', () => {
    it('updates specific settings while preserving others', () => {
      storage.saveState({
        settings: {
          maxTrailers: 10,
          diminishingFactor: 75,
        },
        ownedGarages: [],
        garageFilterMode: 'all',
        ownedTrailers: {},
      });

      const updated = storage.updateSettings({ maxTrailers: 15 });

      expect(updated.maxTrailers).toBe(15);
      expect(updated.diminishingFactor).toBe(75);
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
});
