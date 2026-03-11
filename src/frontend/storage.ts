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

/** Map expansion DLCs — DLC ID → display name */
export const MAP_DLCS: Record<string, string> = {
  going_east: 'Going East!',
  scandinavia: 'Scandinavia',
  vive_la_france: 'Vive la France!',
  italia: 'Italia',
  beyond_the_baltic_sea: 'Beyond the Baltic Sea',
  road_to_the_black_sea: 'Road to the Black Sea',
  iberia: 'Iberia',
  west_balkans: 'West Balkans',
  greece: 'Greece',
};

export const ALL_MAP_DLC_IDS = Object.keys(MAP_DLCS);

/** Map DLC → cities that require it */
export const CITY_DLC_MAP: Record<string, string[]> = {
  going_east: [
    'bialystok','bratislava','brno','budapest','bystrica','debrecen','gdansk','gdyne',
    'katowice','kosice','krakow','lodz','lublin','olsztyn','ostrava','pecs','poznan',
    'prague','szczecin','szeged','warszawa','wroclaw',
  ],
  scandinavia: [
    'aalborg','aarhus','bergen','esbjerg','frederikshv','gedser','goteborg','helsingborg',
    'hirtshals','jonkoping','kalmar','kapellskar','karlskrona','karlstad','kobenhavn',
    'kristiansand','linkoping','malmo','nynashamn','odense','orebro','oslo','sodertalje',
    'stavanger','stockholm','trelleborg','uppsala','vasteraas','vaxjo',
  ],
  vive_la_france: [
    'ajaccio','alban','bastia','bayonne','bonifacio','bordeaux','bourges','brest','calvi',
    'civaux','clermont','dijon','golfech','lacq','larochelle','laurent','lehavre','lemans',
    'lile_rousse','lille','limoges','marseille','metz','montpellier','nantes','nice',
    'paluel','porto_vecchi','reims','rennes','roscoff','toulouse',
  ],
  italia: [
    'ancona','bari','bologna','cagliari','cassino','catania','catanzaro','firenze',
    'livorno','messina','napoli','olbia','palermo','parma','pescara','roma',
    'sangiovanni','sassari','suzzara','taranto','terni','trieste',
  ],
  beyond_the_baltic_sea: [
    'daugavpils','helsinki','kaliningrad','kaunas','klaipeda','kotka','kouvola','kunda',
    'lahti','liepaja','loviisa','luga','mazeikiai','naantali','narva','olkiluoto',
    'paldiski','panevezys','parnu','petersburg','pori','pskov','rezekne','riga',
    'siauliai','sosnovy_bor','tallinn','tampere','tartu','turku','utena','valmiera',
    'ventspils','vilnius','vyborg',
  ],
  road_to_the_black_sea: [
    'artand','bacau','brasov','bucuresti','burgas','calarasi','cernavoda','cluj_napoca',
    'constanta','craiova','edirne','galati','giurgiu','hamzabeyli','hunedoara','iasi',
    'istanbul','kapikule','karlovo','kozloduy','mangalia','nadlac','pernik','pirdop',
    'pitesti','pleven','plovdiv','resita','ruse','sofia','targu_mures','tekirdag',
    'timisoara','varna','veli_tarnovo',
  ],
  iberia: [
    'a_coruna','albacete','algeciras','almaraz','almeria','badajoz','bailen','barcelona',
    'beja','bilbao','burgos','ciudad_real','coimbra','cordoba','corticadas','el_ejido',
    'evora','faro','gijon','granada','guarda','huelva','leon','lisboa','lleida',
    'madrid','malaga','mengibar','murcia','navia','o_barco','olhao','pamplona',
    'ponte_de_sor','port_sagunt','porto','puertollano','salamanca','santander','setubal',
    'sevilla','sines','soria','tarragona','teruel','valencia','valladolid','vandellos',
    'vigo','villarreal','zaragoza',
  ],
  west_balkans: [
    'banja_luka','beograd','bihac','bijelo_polje','bitola','durres','fier','karakaj',
    'koper','kragujevac','ljubljana','maribor','mostar','niksic','nis','novi_sad',
    'novo_mesto','osijek','podgorica','pristina','rijeka','sarajevo','skopje','split',
    'tirana','tuzla','vlore','zadar','zagreb','zenica',
  ],
  greece: [
    'argostoli','athens','chania','chios','heraklion','ioannina','kalamata','kavala',
    'lamia','larissa','mitilini','patras','rhodes','thessaloniki','trikala',
  ],
};

/**
 * Shadow cargo DLC entries for map expansions (wiki-verified).
 * Same filtering mechanism as cargo pack DLCs, toggled by map DLC ownership.
 * Cargo packs trump map DLCs for dual-tagged cargo (those stay in CARGO_DLC_MAP only).
 */
export const MAP_DLC_CARGO: Record<string, string> = {
  // Beyond the Baltic Sea (6)
  concr_cent: 'beyond_the_baltic_sea', concr_stair: 'beyond_the_baltic_sea',
  metal_beams: 'beyond_the_baltic_sea', re_bars: 'beyond_the_baltic_sea',
  train_part: 'beyond_the_baltic_sea', train_part2: 'beyond_the_baltic_sea',
  // Greece (3) — aircond/hvac/mob_crusher/mob_screener/mob_stacker are cargo-pack-gated
  cott_harvest: 'greece', ter_forklift: 'greece', watertank: 'greece',
  // Iberia (1)
  olive_tree: 'iberia',
  // Italia (22)
  brake_pads: 'italia', can_sardines: 'italia', carbn_pwdr_c: 'italia',
  exhausts_c: 'italia', froz_octopi: 'italia', frsh_herbs: 'italia',
  gnocchi: 'italia', marb_blck: 'italia', marb_blck2: 'italia',
  marb_slab: 'italia', moto_tires: 'italia', mozzarela: 'italia',
  mtl_coil: 'italia', olive_oil: 'italia', olive_oil_t: 'italia',
  pasta: 'italia', perfor_frks: 'italia', pesto: 'italia',
  prosciutto: 'italia', seal_bearing: 'italia', sq_tub: 'italia', wrk_cloth: 'italia',
  // Scandinavia (55)
  atl_cod_flt: 'scandinavia', barley: 'scandinavia', brake_fluid: 'scandinavia',
  canned_beef: 'scandinavia', canned_pork: 'scandinavia', canned_tuna: 'scandinavia',
  caviar: 'scandinavia', chicken_meat: 'scandinavia', cott_cheese: 'scandinavia',
  desinfection: 'scandinavia', elect_wiring: 'scandinavia', empty_barr: 'scandinavia',
  fish_chips: 'scandinavia', fresh_fish: 'scandinavia', frozen_hake: 'scandinavia',
  fuel_tanks: 'scandinavia', garlic: 'scandinavia', guard_rails: 'scandinavia',
  ibc_cont: 'scandinavia', lamb_stom: 'scandinavia', live_cattle: 'scandinavia',
  liver_paste: 'scandinavia', metal_cans: 'scandinavia', onion: 'scandinavia',
  pears: 'scandinavia', pet_food: 'scandinavia', pet_food_c: 'scandinavia',
  plast_film: 'scandinavia', plast_film_c: 'scandinavia', plumb_suppl: 'scandinavia',
  polyst_box: 'scandinavia', pork_meat: 'scandinavia', pot_flowers: 'scandinavia',
  refl_posts: 'scandinavia', rye: 'scandinavia', salm_fillet: 'scandinavia',
  salt_spice_c: 'scandinavia', salt_spices: 'scandinavia', sausages: 'scandinavia',
  scaffoldings: 'scandinavia', sheep_wool: 'scandinavia', shock_absorb: 'scandinavia',
  smokd_eel: 'scandinavia', smokd_sprats: 'scandinavia', stone_wool: 'scandinavia',
  transmis: 'scandinavia', truck_batt: 'scandinavia', truck_batt_c: 'scandinavia',
  truck_rims: 'scandinavia', truck_rims_c: 'scandinavia', truck_tyres: 'scandinavia',
  wheat: 'scandinavia', windml_eng: 'scandinavia', windml_tube: 'scandinavia',
  wood_bark: 'scandinavia', wooden_beams: 'scandinavia',
  // Vive la France! (34)
  air_mails: 'vive_la_france', aircft_tires: 'vive_la_france',
  backfl_prev: 'vive_la_france', basil: 'vive_la_france',
  boric_acid: 'vive_la_france', coconut_milk: 'vive_la_france',
  coconut_oil: 'vive_la_france', comp_process: 'vive_la_france',
  conc_juice_t: 'vive_la_france', concen_juice: 'vive_la_france',
  corks: 'vive_la_france', cut_flowers: 'vive_la_france',
  diesel_gen: 'vive_la_france', emp_wine_bar: 'vive_la_france',
  emp_wine_bot: 'vive_la_france', fuel_oil: 'vive_la_france',
  granite_cube: 'vive_la_france', gummy_bears: 'vive_la_france',
  harvest_bins: 'vive_la_france', hi_volt_cabl: 'vive_la_france',
  iced_coffee: 'vive_la_france', lavender: 'vive_la_france',
  natur_rubber: 'vive_la_france', nylon_cord: 'vive_la_france',
  olives: 'vive_la_france', post_packag: 'vive_la_france',
  press_sl_val: 'vive_la_france', protec_cloth: 'vive_la_france',
  pumps: 'vive_la_france', silica: 'vive_la_france',
  soy_milk: 'vive_la_france', soy_milk_t: 'vive_la_france',
  spher_valves: 'vive_la_france', steel_cord: 'vive_la_france',
  // West Balkans (2)
  alu_ingot: 'west_balkans', alu_profile: 'west_balkans',
};

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

/** Combined cargo DLC map — merges cargo packs + map DLC shadow entries */
export const COMBINED_CARGO_DLC_MAP: Record<string, string> = {
  ...CARGO_DLC_MAP,
  ...MAP_DLC_CARGO,
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
  ownedMapDLCs: string[];                 // Map expansion DLC IDs the user owns
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
  ownedMapDLCs: [...ALL_MAP_DLC_IDS],  // all owned by default
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
        ownedMapDLCs: parsed.ownedMapDLCs ?? [...ALL_MAP_DLC_IDS],
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
