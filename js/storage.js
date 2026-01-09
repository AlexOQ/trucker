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
  // Future expansion
  ownedGarages: [],
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
