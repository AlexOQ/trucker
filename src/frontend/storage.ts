/**
 * LocalStorage wrapper for ETS2 Trucker Advisor
 * Persists user settings and future game state
 */

const STORAGE_KEY = 'ets2-trucker-advisor';

interface Settings {
  scoringBalance: number;
  maxTrailers: number;
  diminishingFactor: number;
}

interface AppState {
  settings: Settings;
  ownedGarages: number[];
  garageFilterMode: string;
  ownedTrailers: Record<string, any>;
}

const defaultState: AppState = {
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
};

/**
 * Load state from localStorage
 */
export function loadState(): AppState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new fields
      return {
        ...defaultState,
        ...parsed,
        settings: {
          ...defaultState.settings,
          ...parsed.settings,
        },
      };
    }
  } catch (e) {
    console.warn('Failed to load state from localStorage:', e);
  }
  return { ...defaultState };
}

/**
 * Save state to localStorage
 */
export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state to localStorage:', e);
  }
}

/**
 * Update settings and save
 */
export function updateSettings(settings: Partial<Settings>): Settings {
  const state = loadState();
  state.settings = { ...state.settings, ...settings };
  saveState(state);
  return state.settings;
}

/**
 * Get current settings
 */
export function getSettings(): Settings {
  return loadState().settings;
}

/**
 * Reset to defaults
 */
export function resetToDefaults(): Settings {
  const state = loadState();
  state.settings = { ...defaultState.settings };
  saveState(state);
  return defaultState.settings;
}

// ============================================
// Garage Management Functions
// ============================================

/**
 * Get list of owned garage city IDs
 */
export function getOwnedGarages(): number[] {
  return loadState().ownedGarages || [];
}

/**
 * Add a city to owned garages
 */
export function addOwnedGarage(cityId: number): number[] {
  const state = loadState();
  if (!state.ownedGarages.includes(cityId)) {
    state.ownedGarages = [...state.ownedGarages, cityId];
    saveState(state);
  }
  return state.ownedGarages;
}

/**
 * Remove a city from owned garages
 */
export function removeOwnedGarage(cityId: number): number[] {
  const state = loadState();
  state.ownedGarages = state.ownedGarages.filter((id) => id !== cityId);
  saveState(state);
  return state.ownedGarages;
}

/**
 * Check if a city is an owned garage
 */
export function isOwnedGarage(cityId: number): boolean {
  return getOwnedGarages().includes(cityId);
}

/**
 * Toggle a city's owned garage status
 * @returns {boolean} New state (true = now owned)
 */
export function toggleOwnedGarage(cityId: number): boolean {
  const state = loadState();
  const isOwned = state.ownedGarages.includes(cityId);
  if (isOwned) {
    state.ownedGarages = state.ownedGarages.filter((id) => id !== cityId);
  } else {
    state.ownedGarages = [...state.ownedGarages, cityId];
  }
  saveState(state);
  return !isOwned;
}

/**
 * Get current garage filter mode
 */
export function getFilterMode(): string {
  return loadState().garageFilterMode || 'all';
}

/**
 * Set garage filter mode
 */
export function setFilterMode(mode: string): string {
  const state = loadState();
  state.garageFilterMode = mode;
  saveState(state);
  return mode;
}

// ============================================
// Country Filter Functions
// ============================================

/**
 * Get list of selected countries
 */
export function getSelectedCountries(): string[] {
  try {
    const saved = localStorage.getItem('ets2-selected-countries');
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.warn('Failed to load selected countries:', e);
    return [];
  }
}

/**
 * Set selected countries list
 */
export function setSelectedCountries(countries: string[]): void {
  try {
    localStorage.setItem('ets2-selected-countries', JSON.stringify(countries));
  } catch (e) {
    console.warn('Failed to save selected countries:', e);
  }
}
