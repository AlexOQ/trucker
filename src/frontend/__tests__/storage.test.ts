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
    storage._resetStateCache();
  });

  describe('loadState', () => {
    it('returns default state on empty storage', () => {
      const state = storage.loadState();

      expect(state).toEqual({
        ownedGarages: [],
        garageFilterMode: 'all',
        selectedCountries: [],
        ownedTrailerDLCs: [],
        ownedCargoDLCs: [],
        ownedMapDLCs: [],
        sortColumn: 'score',
        sortDirection: 'desc',
      });
    });

    it('merges stored state with defaults for new fields', () => {
      localStorageMock.setItem(
        'ets2-trucker-advisor',
        JSON.stringify({
          ownedGarages: ['berlin', 'paris'],
        }),
      );

      const state = storage.loadState();

      expect(state.ownedGarages).toEqual(['berlin', 'paris']);
      expect(state.garageFilterMode).toBe('all');
    });

    it('returns defaults on invalid JSON', () => {
      localStorageMock.setItem('ets2-trucker-advisor', 'not valid json');
      const state = storage.loadState();
      expect(state.garageFilterMode).toBe('all');
    });
  });

  describe('saveState/loadState round-trip', () => {
    it('persists and retrieves state correctly', () => {
      const testState = {
        ownedGarages: ['berlin', 'paris', 'london'],
        garageFilterMode: 'owned',
        selectedCountries: ['Germany'],
        ownedTrailerDLCs: [],
        ownedCargoDLCs: [],
        ownedMapDLCs: [],
        sortColumn: 'score' as const,
        sortDirection: 'desc' as const,
      };

      storage.saveState(testState);
      const loaded = storage.loadState();

      expect(loaded.ownedGarages).toEqual(testState.ownedGarages);
      expect(loaded.garageFilterMode).toBe(testState.garageFilterMode);
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

  describe('first-visit detection', () => {
    it('detects first visit when no state exists', () => {
      expect(storage.isFirstVisit()).toBe(true);
    });

    it('detects returning visitor after state is saved', () => {
      storage.saveState(storage.loadState());
      expect(storage.isFirstVisit()).toBe(false);
    });
  });

  describe('banner dismissal', () => {
    it('banner is not dismissed by default', () => {
      expect(storage.isBannerDismissed()).toBe(false);
    });

    it('remembers banner dismissal', () => {
      storage.dismissBanner();
      expect(storage.isBannerDismissed()).toBe(true);
    });
  });
});
