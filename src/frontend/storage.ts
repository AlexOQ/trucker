/**
 * LocalStorage wrapper for ETS2 Trucker Advisor
 * Persists user settings, garage state, and per-city trailer sets
 */

const STORAGE_KEY = 'ets2-trucker-advisor';

/** Trailer DLC packs — brand prefix → display name */
export const TRAILER_DLCS: Record<string, string> = {
  feldbinder: 'Feldbinder',
  kassbohrer: 'Kassbohrer',
  kogel: 'Kögel',
  krone: 'Krone',
  schmitz: 'Schmitz Cargobull',
  schwmuller: 'Schwarzmüller',
  tirsan: 'Tirsan',
  wielton: 'Wielton',
};

export const ALL_DLC_IDS = Object.keys(TRAILER_DLCS);

/** Cargo DLC packs — pack ID → display name */
export const CARGO_DLCS: Record<string, string> = {
  high_power: 'High Power Cargo',
  heavy_cargo: 'Heavy Cargo',
  special_transport: 'Special Transport',
  volvo_ce: 'Volvo Construction',
  jcb: 'JCB Equipment',
  bobcat: 'Bobcat Cargo',
  krone_agri: 'KRONE Agriculture',
  farm_machinery: 'Farm Machinery',
  forest_machinery: 'Forest Machinery',
};

export const ALL_CARGO_DLC_IDS = Object.keys(CARGO_DLCS);

/** Cargo ID → DLC pack mapping (wiki-verified) */
export const CARGO_DLC_MAP: Record<string, string> = {
  // High Power Cargo Pack
  aircond: 'high_power', hvac: 'high_power', crawler: 'high_power', driller: 'high_power',
  tube: 'high_power', helicopter: 'high_power', roller: 'high_power', tracks: 'high_power', yacht: 'high_power',
  // Heavy Cargo Pack
  asph_miller: 'heavy_cargo', concr_beams: 'heavy_cargo', concr_beams2: 'heavy_cargo',
  dozer: 'heavy_cargo', cable_reel: 'heavy_cargo', locomotive: 'heavy_cargo',
  metal_center: 'heavy_cargo', mobile_crane: 'heavy_cargo', mob_crusher: 'heavy_cargo',
  mob_screener: 'heavy_cargo', mob_stacker: 'heavy_cargo', transformat: 'heavy_cargo',
  // Special Transport (only non-escort items with regular body types)
  czl_es300: 'special_transport', czl_muv75: 'special_transport',
  // Volvo Construction Equipment
  volvo_a25g: 'volvo_ce', volvo_bucket: 'volvo_ce', volvo_sd160b: 'volvo_ce',
  volvo_ec220e: 'volvo_ce', volvo_l250h: 'volvo_ce', volvo_rims: 'volvo_ce', vol_ew240emh: 'volvo_ce',
  // JCB Equipment Pack
  jcb_bhl4cx: 'jcb', jcb_g100rs: 'jcb', jcb_dmphtd5e: 'jcb', jcb_mexc19ce: 'jcb',
  jcb_exc245xr: 'jcb', jcb_pw125qe: 'jcb', jcb_dmp6t2: 'jcb', jcb_th540180: 'jcb',
  jcb_ft4220: 'jcb', jcb_wload457: 'jcb',
  // Bobcat Cargo Pack
  bob_tl3070a: 'bobcat', bob_pa127v: 'bobcat', bob_e60: 'bobcat', bob_d30: 'bobcat',
  bob_e10e: 'bobcat', bob_s86: 'bobcat', bob_l95: 'bobcat',
  // KRONE Agriculture Equipment
  kr_ecb880cv: 'krone_agri', kr_bigx1180: 'krone_agri', kr_bigm450: 'krone_agri',
  kr_stc1370: 'krone_agri', kr_vpv190xc: 'krone_agri', kr_bigp1290: 'krone_agri', kr_gx520: 'krone_agri',
  // Farm Machinery
  auger_wag: 'farm_machinery', tractor_au: 'farm_machinery', tractor_c: 'farm_machinery',
  disc_harrows: 'farm_machinery', fert_spread: 'farm_machinery', forage_harv: 'farm_machinery',
  planter: 'farm_machinery', sprayer: 'farm_machinery', square_baler: 'farm_machinery',
  // Forest Machinery
  exc_craw: 'forest_machinery', forwarder: 'forest_machinery', log_harvest: 'forest_machinery',
  log_stacker: 'forest_machinery', mob_tr_winch: 'forest_machinery', mulcher: 'forest_machinery',
  skidder: 'forest_machinery', wood_chipper: 'forest_machinery',
};

interface Settings {
  driverCount: number;
}

interface AppState {
  settings: Settings;
  ownedGarages: string[];
  garageFilterMode: string;
  selectedCountries: string[];
  cityTrailers: Record<string, string[]>;  // cityId -> array of body type IDs
  ownedTrailerDLCs: string[];              // DLC brand IDs the user owns
  ownedCargoDLCs: string[];               // Cargo DLC pack IDs the user owns
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
  ownedTrailerDLCs: [...ALL_DLC_IDS],  // all owned by default
  ownedCargoDLCs: [...ALL_CARGO_DLC_IDS],  // all owned by default
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
        ownedTrailerDLCs: parsed.ownedTrailerDLCs ?? [...ALL_DLC_IDS],
        ownedCargoDLCs: parsed.ownedCargoDLCs ?? [...ALL_CARGO_DLC_IDS],
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
