/**
 * LocalStorage wrapper for ETS2 Trucker Advisor
 * Persists user settings, garage state, and per-city trailer sets.
 *
 * DLC registries and maps live in dlc-data.ts (loaded from game-defs.json).
 * This module re-exports them for backward compatibility.
 */

import {
  ALL_DLC_IDS, ALL_CARGO_DLC_IDS, ALL_MAP_DLC_IDS,
} from './dlc-data';

export {
  TRAILER_DLCS, ALL_DLC_IDS,
  CARGO_DLCS, ALL_CARGO_DLC_IDS,
  MAP_DLCS, ALL_MAP_DLC_IDS,
  GARAGE_CITIES, CITY_DLC_MAP,
  CARGO_DLC_MAP, MAP_DLC_CARGO, COMBINED_CARGO_DLC_MAP,
} from './dlc-data';

const STORAGE_KEY = 'ets2-trucker-advisor';
const BANNER_DISMISSED_KEY = 'ets2-dlc-banner-dismissed';
const ONBOARDING_COLLAPSED_KEY = 'ets2-onboarding-collapsed';
const THEME_KEY = 'ets2-theme';

interface Settings {
  driverCount: number;
}

export type SortColumn = 'name' | 'country' | 'depotCount' | 'cargoTypes' | 'score';
export type SortDirection = 'asc' | 'desc';

interface AppState {
  settings: Settings;
  ownedGarages: string[];
  garageFilterMode: string;
  selectedCountries: string[];
  cityTrailers: Record<string, string[]>;  // cityId -> array of body type IDs
  ownedTrailerDLCs: string[];              // DLC brand IDs the user owns
  ownedCargoDLCs: string[];               // Cargo DLC pack IDs the user owns
  ownedMapDLCs: string[];                 // Map expansion DLC IDs the user owns
  sortColumn: SortColumn;
  sortDirection: SortDirection;
}

const LEGACY_COUNTRIES_KEY = 'ets2-selected-countries';

// Module-level cache — avoids repeated JSON.parse on every loadState() call.
// Invalidated by saveState(). Exported for test reset only.
let _cachedState: AppState | null = null;

/** @internal — reset in-memory cache; for use in tests only */
export function _resetStateCache(): void {
  _cachedState = null;
}

const defaultState: AppState = {
  settings: {
    driverCount: 5,
  },
  ownedGarages: [],
  garageFilterMode: 'all',
  selectedCountries: [],
  cityTrailers: {},
  ownedTrailerDLCs: [],  // none owned by default — first-time visitors configure on DLC page
  ownedCargoDLCs: [],   // none owned by default
  ownedMapDLCs: [],     // none owned by default
  sortColumn: 'score',
  sortDirection: 'desc',
};

/**
 * Load state from localStorage.
 * Result is cached in-memory; cache is invalidated by saveState().
 */
export function loadState(): AppState {
  if (_cachedState !== null) return _cachedState;
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
        ownedTrailerDLCs: parsed.ownedTrailerDLCs ?? [...ALL_DLC_IDS],
        ownedCargoDLCs: parsed.ownedCargoDLCs ?? [...ALL_CARGO_DLC_IDS],
        ownedMapDLCs: parsed.ownedMapDLCs ?? [...ALL_MAP_DLC_IDS],
        sortColumn: parsed.sortColumn ?? defaultState.sortColumn,
        sortDirection: parsed.sortDirection ?? defaultState.sortDirection,
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
      _cachedState = state;
      return state;
    }
  } catch (e) {
    console.warn('Failed to load state from localStorage:', e);
  }
  const fallback = { ...defaultState };
  _cachedState = fallback;
  return fallback;
}

/**
 * Save state to localStorage and invalidate the in-memory cache.
 */
export function saveState(state: AppState): void {
  _cachedState = structuredClone(state);
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
  // Auto-add to owned garages
  if (!state.ownedGarages.includes(cityId)) {
    state.ownedGarages = [...state.ownedGarages, cityId];
  }
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
    // Auto-remove from owned garages if no trailers left
    if (trailers.length === 0) {
      state.ownedGarages = state.ownedGarages.filter((id) => id !== cityId);
    }
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

// ============================================
// Trailer DLC Management
// ============================================

export function getOwnedTrailerDLCs(): string[] {
  return loadState().ownedTrailerDLCs;
}

export function setOwnedTrailerDLCs(dlcs: string[]): void {
  const state = loadState();
  state.ownedTrailerDLCs = dlcs;
  saveState(state);
}

export function toggleTrailerDLC(dlcId: string): boolean {
  const state = loadState();
  const idx = state.ownedTrailerDLCs.indexOf(dlcId);
  if (idx >= 0) {
    state.ownedTrailerDLCs.splice(idx, 1);
  } else {
    state.ownedTrailerDLCs.push(dlcId);
  }
  saveState(state);
  return idx < 0; // returns new owned state
}

export function isDLCOwned(dlcId: string): boolean {
  return getOwnedTrailerDLCs().includes(dlcId);
}

// ============================================
// Cargo DLC Management
// ============================================

export function getOwnedCargoDLCs(): string[] {
  return loadState().ownedCargoDLCs;
}

export function setOwnedCargoDLCs(dlcs: string[]): void {
  const state = loadState();
  state.ownedCargoDLCs = dlcs;
  saveState(state);
}

export function toggleCargoDLC(dlcId: string): boolean {
  const state = loadState();
  const idx = state.ownedCargoDLCs.indexOf(dlcId);
  if (idx >= 0) {
    state.ownedCargoDLCs.splice(idx, 1);
  } else {
    state.ownedCargoDLCs.push(dlcId);
  }
  saveState(state);
  return idx < 0;
}

// ============================================
// Map DLC Management
// ============================================

export function getOwnedMapDLCs(): string[] {
  return loadState().ownedMapDLCs;
}

export function setOwnedMapDLCs(dlcs: string[]): void {
  const state = loadState();
  state.ownedMapDLCs = dlcs;
  saveState(state);
}

export function toggleMapDLC(dlcId: string): boolean {
  const state = loadState();
  const idx = state.ownedMapDLCs.indexOf(dlcId);
  if (idx >= 0) {
    state.ownedMapDLCs.splice(idx, 1);
  } else {
    state.ownedMapDLCs.push(dlcId);
  }
  saveState(state);
  return idx < 0;
}

// ============================================
// Sort Preference Management
// ============================================

export function getSortColumn(): SortColumn {
  return loadState().sortColumn ?? 'score';
}

export function getSortDirection(): SortDirection {
  return loadState().sortDirection ?? 'desc';
}

export function setSortPreference(column: SortColumn, direction: SortDirection): void {
  const state = loadState();
  state.sortColumn = column;
  state.sortDirection = direction;
  saveState(state);
}

// ============================================
// First-Visit Detection
// ============================================

/**
 * Returns true if the user has never saved any state (first visit).
 */
export function isFirstVisit(): boolean {
  return localStorage.getItem(STORAGE_KEY) === null;
}

/**
 * Returns true if the DLC configuration banner has been dismissed.
 */
export function isBannerDismissed(): boolean {
  return localStorage.getItem(BANNER_DISMISSED_KEY) === 'true';
}

/**
 * Mark the DLC configuration banner as dismissed.
 */
export function dismissBanner(): void {
  localStorage.setItem(BANNER_DISMISSED_KEY, 'true');
}

// ============================================
// Onboarding Section Collapsed State
// ============================================

/**
 * Returns true if the Getting Started section should be collapsed.
 * Defaults to expanded for first-time visitors, collapsed for returning visitors.
 */
export function isOnboardingCollapsed(): boolean {
  const stored = localStorage.getItem(ONBOARDING_COLLAPSED_KEY);
  if (stored !== null) return stored === 'true';
  // First-time visitors see it expanded; returning visitors (who have state) see it collapsed
  return !isFirstVisit();
}

/**
 * Save the onboarding collapsed state.
 */
export function setOnboardingCollapsed(collapsed: boolean): void {
  localStorage.setItem(ONBOARDING_COLLAPSED_KEY, collapsed ? 'true' : 'false');
}

// ============================================
// Theme Management
// ============================================

export type Theme = 'dark' | 'light';

/**
 * Get the current theme preference.
 * Priority: localStorage > prefers-color-scheme > 'dark' (default)
 */
export function getTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

/**
 * Save the theme preference and apply it to the document.
 */
export function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Toggle between dark and light themes. Returns the new theme.
 */
export function toggleTheme(): Theme {
  const current = getTheme();
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
