import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = value
    }),
    removeItem: vi.fn((key) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

// Set up global localStorage mock before importing the module
vi.stubGlobal('localStorage', localStorageMock)

// Dynamic import after mocking
const storage = await import('./storage.js')

describe('storage', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  describe('loadState', () => {
    it('returns default state on empty storage', () => {
      const state = storage.loadState()

      expect(state).toEqual({
        settings: {
          scoringBalance: 50,
          maxTrailers: 10,
          diminishingFactor: 50,
        },
        ownedGarages: [],
        garageFilterMode: 'all',
        ownedTrailers: {},
      })
    })

    it('merges stored state with defaults for new fields', () => {
      // Store partial state (missing some default fields)
      localStorageMock.setItem(
        'ets2-trucker-advisor',
        JSON.stringify({
          settings: { scoringBalance: 75 },
          ownedGarages: [1, 2, 3],
        })
      )

      const state = storage.loadState()

      expect(state.settings.scoringBalance).toBe(75)
      expect(state.settings.maxTrailers).toBe(10) // Default
      expect(state.settings.diminishingFactor).toBe(50) // Default
      expect(state.ownedGarages).toEqual([1, 2, 3])
      expect(state.garageFilterMode).toBe('all') // Default
    })

    it('returns defaults on invalid JSON', () => {
      localStorageMock.setItem('ets2-trucker-advisor', 'not valid json')

      const state = storage.loadState()

      expect(state.settings.scoringBalance).toBe(50)
    })
  })

  describe('saveState/loadState round-trip', () => {
    it('persists and retrieves state correctly', () => {
      const testState = {
        settings: {
          scoringBalance: 80,
          maxTrailers: 15,
          diminishingFactor: 30,
        },
        ownedGarages: [5, 10, 15],
        garageFilterMode: 'owned',
        ownedTrailers: { 1: 2, 3: 4 },
      }

      storage.saveState(testState)
      const loaded = storage.loadState()

      expect(loaded.settings).toEqual(testState.settings)
      expect(loaded.ownedGarages).toEqual(testState.ownedGarages)
      expect(loaded.garageFilterMode).toBe(testState.garageFilterMode)
      expect(loaded.ownedTrailers).toEqual(testState.ownedTrailers)
    })

    it('handles empty arrays and objects', () => {
      const testState = {
        settings: {
          scoringBalance: 50,
          maxTrailers: 10,
          diminishingFactor: 50,
        },
        ownedGarages: [],
        garageFilterMode: 'all',
        ownedTrailers: {},
      }

      storage.saveState(testState)
      const loaded = storage.loadState()

      expect(loaded.ownedGarages).toEqual([])
      expect(loaded.ownedTrailers).toEqual({})
    })
  })

  describe('resetToDefaults', () => {
    it('preserves owned garages when resetting settings', () => {
      // Set up state with custom settings and garages
      const customState = {
        settings: {
          scoringBalance: 90,
          maxTrailers: 20,
          diminishingFactor: 80,
        },
        ownedGarages: [1, 2, 3, 4, 5],
        garageFilterMode: 'owned',
        ownedTrailers: {},
      }
      storage.saveState(customState)

      // Reset to defaults
      const resetSettings = storage.resetToDefaults()

      // Settings should be reset
      expect(resetSettings).toEqual({
        scoringBalance: 50,
        maxTrailers: 10,
        diminishingFactor: 50,
      })

      // But garages should be preserved
      const state = storage.loadState()
      expect(state.ownedGarages).toEqual([1, 2, 3, 4, 5])
    })

    it('returns default settings values', () => {
      const settings = storage.resetToDefaults()

      expect(settings.scoringBalance).toBe(50)
      expect(settings.maxTrailers).toBe(10)
      expect(settings.diminishingFactor).toBe(50)
    })
  })

  describe('updateSettings', () => {
    it('updates specific settings while preserving others', () => {
      storage.saveState({
        settings: {
          scoringBalance: 50,
          maxTrailers: 10,
          diminishingFactor: 50,
        },
        ownedGarages: [],
        garageFilterMode: 'all',
        ownedTrailers: {},
      })

      const updated = storage.updateSettings({ scoringBalance: 75 })

      expect(updated.scoringBalance).toBe(75)
      expect(updated.maxTrailers).toBe(10)
      expect(updated.diminishingFactor).toBe(50)
    })
  })

  describe('garage management', () => {
    it('adds and removes garages correctly', () => {
      expect(storage.getOwnedGarages()).toEqual([])

      storage.addOwnedGarage(1)
      storage.addOwnedGarage(2)
      expect(storage.getOwnedGarages()).toEqual([1, 2])

      storage.removeOwnedGarage(1)
      expect(storage.getOwnedGarages()).toEqual([2])
    })

    it('toggles garage ownership correctly', () => {
      expect(storage.isOwnedGarage(1)).toBe(false)

      const added = storage.toggleOwnedGarage(1)
      expect(added).toBe(true)
      expect(storage.isOwnedGarage(1)).toBe(true)

      const removed = storage.toggleOwnedGarage(1)
      expect(removed).toBe(false)
      expect(storage.isOwnedGarage(1)).toBe(false)
    })

    it('does not add duplicate garages', () => {
      storage.addOwnedGarage(1)
      storage.addOwnedGarage(1)
      storage.addOwnedGarage(1)

      expect(storage.getOwnedGarages()).toEqual([1])
    })
  })

  describe('filter mode', () => {
    it('gets and sets filter mode', () => {
      expect(storage.getFilterMode()).toBe('all')

      storage.setFilterMode('owned')
      expect(storage.getFilterMode()).toBe('owned')
    })
  })
})
