/**
 * LocalStorage wrapper for ETS2 Trucker Advisor
 * Persists user settings, garage state, and per-city trailer sets
 */

const STORAGE_KEY = 'ets2-trucker-advisor';

interface Settings {
  driverCount: number;
}

interface AppState {
  settings: Settings;
  ownedGarages: string[];
  garageFilterMode: string;
  selectedCountries: string[];
  cityTrailers: Record<string, string[]>;  // cityId -> array of body type IDs
}

const LEGACY_COUNTRIES_KEY = 'ets2-selected-countries';

const defaultState: AppState = {
  settings: {
    driverCount: 5,
  },
  ownedGarages: [],
  garageFilterMode: 'all',
  selectedCountries: [],
  cityTrailers: {},
};

/**
 * Load state from localStorage
 */
export function loadState(): AppState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const state: AppState = {
        ...defaultState,
        ...parsed,
        settings: {
          ...defaultState.settings,
          ...parsed.settings,
        },
        cityTrailers: parsed.cityTrailers ?? {},
      };
      // Migrate legacy settings
      if (parsed.settings?.maxTrailers && !parsed.settings?.driverCount) {
        state.settings.driverCount = defaultState.settings.driverCount;
      }
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

export function getOwnedGarages(): string[] {
  return loadState().ownedGarages || [];
}

export function addOwnedGarage(cityId: string): string[] {
  const state = loadState();
  if (!state.ownedGarages.includes(cityId)) {
    state.ownedGarages = [...state.ownedGarages, cityId];
    saveState(state);
  }
  return state.ownedGarages;
}

export function removeOwnedGarage(cityId: string): string[] {
  const state = loadState();
  state.ownedGarages = state.ownedGarages.filter((id) => id !== cityId);
  saveState(state);
  return state.ownedGarages;
}

export function isOwnedGarage(cityId: string): boolean {
  return getOwnedGarages().includes(cityId);
}

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

// ============================================
// Garage Filter Functions
// ============================================

export function getFilterMode(): string {
  return loadState().garageFilterMode || 'all';
}

export function setFilterMode(mode: string): string {
  const state = loadState();
  state.garageFilterMode = mode;
  saveState(state);
  return mode;
}

// ============================================
// Country Filter Functions
// ============================================

export function getSelectedCountries(): string[] {
  return loadState().selectedCountries || [];
}

export function setSelectedCountries(countries: string[]): void {
  const state = loadState();
  state.selectedCountries = countries;
  saveState(state);
}

// ============================================
// Per-City Trailer Management
// ============================================

/**
 * Get trailer set (body type IDs) for a city
 */
export function getCityTrailers(cityId: string): string[] {
  return loadState().cityTrailers[cityId] || [];
}

/**
 * Add a trailer (body type) to a city's set
 */
export function addCityTrailer(cityId: string, bodyType: string): string[] {
  const state = loadState();
  if (!state.cityTrailers[cityId]) {
    state.cityTrailers[cityId] = [];
  }
  state.cityTrailers[cityId].push(bodyType);
  saveState(state);
  return state.cityTrailers[cityId];
}

/**
 * Remove a trailer at index from a city's set
 */
export function removeCityTrailer(cityId: string, index: number): string[] {
  const state = loadState();
  const trailers = state.cityTrailers[cityId] || [];
  if (index >= 0 && index < trailers.length) {
    trailers.splice(index, 1);
    state.cityTrailers[cityId] = trailers;
    saveState(state);
  }
  return state.cityTrailers[cityId] || [];
}

/**
 * Set entire trailer set for a city
 */
export function setCityTrailers(cityId: string, trailers: string[]): void {
  const state = loadState();
  state.cityTrailers[cityId] = trailers;
  saveState(state);
}
