/**
 * LocalStorage wrapper for ETS2 Trucker Advisor
 * Persists user settings and future game state
 */

const STORAGE_KEY = 'ets2-trucker-advisor'

const defaultState = {
  settings: {
    scoringBalance: 50,
    maxTrailers: 10,
    diminishingFactor: 50,
  },
  // Garage management
  ownedGarages: [],
  garageFilterMode: 'all',
  // Future expansion
  ownedTrailers: {},
}

/**
 * Load state from localStorage
 */
export function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Merge with defaults to handle new fields
      return {
        ...defaultState,
        ...parsed,
        settings: {
          ...defaultState.settings,
          ...parsed.settings,
        },
      }
    }
  } catch (e) {
    console.warn('Failed to load state from localStorage:', e)
  }
  return { ...defaultState }
}

/**
 * Save state to localStorage
 */
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    console.warn('Failed to save state to localStorage:', e)
  }
}

/**
 * Update settings and save
 */
export function updateSettings(settings) {
  const state = loadState()
  state.settings = { ...state.settings, ...settings }
  saveState(state)
  return state.settings
}

/**
 * Get current settings
 */
export function getSettings() {
  return loadState().settings
}

/**
 * Reset to defaults
 */
export function resetToDefaults() {
  saveState({ ...defaultState })
  return defaultState.settings
}

// ============================================
// Garage Management Functions
// ============================================

/**
 * Get list of owned garage city IDs
 */
export function getOwnedGarages() {
  return loadState().ownedGarages || []
}

/**
 * Add a city to owned garages
 */
export function addOwnedGarage(cityId) {
  const state = loadState()
  if (!state.ownedGarages.includes(cityId)) {
    state.ownedGarages = [...state.ownedGarages, cityId]
    saveState(state)
  }
  return state.ownedGarages
}

/**
 * Remove a city from owned garages
 */
export function removeOwnedGarage(cityId) {
  const state = loadState()
  state.ownedGarages = state.ownedGarages.filter((id) => id !== cityId)
  saveState(state)
  return state.ownedGarages
}

/**
 * Check if a city is an owned garage
 */
export function isOwnedGarage(cityId) {
  return getOwnedGarages().includes(cityId)
}

/**
 * Toggle a city's owned garage status
 * @returns {boolean} New state (true = now owned)
 */
export function toggleOwnedGarage(cityId) {
  const state = loadState()
  const isOwned = state.ownedGarages.includes(cityId)
  if (isOwned) {
    state.ownedGarages = state.ownedGarages.filter((id) => id !== cityId)
  } else {
    state.ownedGarages = [...state.ownedGarages, cityId]
  }
  saveState(state)
  return !isOwned
}

/**
 * Get current garage filter mode
 */
export function getFilterMode() {
  return loadState().garageFilterMode || 'all'
}

/**
 * Set garage filter mode
 */
export function setFilterMode(mode) {
  const state = loadState()
  state.garageFilterMode = mode
  saveState(state)
  return mode
}
