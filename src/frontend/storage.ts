/**
 * LocalStorage wrapper for ETS2 Trucker Advisor
 * Persists user settings and future game state
 */

const STORAGE_KEY = 'ets2-trucker-advisor';

interface Settings {
  maxTrailers: number;
  diminishingFactor: number;
}

interface AppState {
  settings: Settings;
  ownedGarages: string[];
  garageFilterMode: string;
  selectedCountries: string[];
  ownedTrailers: Record<string, any>;
}

const LEGACY_COUNTRIES_KEY = 'ets2-selected-countries';

const defaultState: AppState = {
  settings: {
    maxTrailers: 10,
    diminishingFactor: 75,
  },
  ownedGarages: [],
  garageFilterMode: 'all',
  selectedCountries: [],
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
      const state = {
        ...defaultState,
        ...parsed,
        settings: {
          ...defaultState.settings,
          ...parsed.settings,
        },
      };
      // Migrate legacy country filter key into unified state
      if (!parsed.selectedCountries) {
        const legacy = localStorage.getItem(LEGACY_COUNTRIES_KEY);
        if (legacy) {
          state.selectedCountries = JSON.parse(legacy);
          localStorage.removeItem(LEGACY_COUNTRIES_KEY);
          saveState(state);
        }
      }
      return state;
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
  state.selectedCountries = [];
  saveState(state);
  return defaultState.settings;
}

// ============================================
// Garage Management Functions
// ============================================

/**
 * Get list of owned garage city IDs
 */
export function getOwnedGarages(): string[] {
  return loadState().ownedGarages || [];
}

/**
 * Add a city to owned garages
 */
export function addOwnedGarage(cityId: string): string[] {
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
export function removeOwnedGarage(cityId: string): string[] {
  const state = loadState();
  state.ownedGarages = state.ownedGarages.filter((id) => id !== cityId);
  saveState(state);
  return state.ownedGarages;
}

/**
 * Check if a city is an owned garage
 */
export function isOwnedGarage(cityId: string): boolean {
  return getOwnedGarages().includes(cityId);
}

/**
 * Toggle a city's owned garage status
 * @returns {boolean} New state (true = now owned)
 */
export function toggleOwnedGarage(cityId: string): boolean {
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
  return loadState().selectedCountries || [];
}

/**
 * Set selected countries list
 */
export function setSelectedCountries(countries: string[]): void {
  const state = loadState();
  state.selectedCountries = countries;
  saveState(state);
}
