/**
 * DLC data module — single source of truth for DLC registries and maps.
 *
 * Hardcoded fallbacks are used until game-defs.json is loaded.
 * After loadAllData() completes, initDlcData() overrides with live data
 * from the `dlc` section of game-defs.json (if present).
 */

// ─── Trailer DLCs ─────────────────────────────────────────────────────

export let TRAILER_DLCS: Record<string, string> = {
  feldbinder: 'Feldbinder',
  kassbohrer: 'Kassbohrer',
  kogel: 'Kögel',
  krone: 'Krone',
  schmitz: 'Schmitz Cargobull',
  schwmuller: 'Schwarzmüller',
  tirsan: 'Tirsan',
  wielton: 'Wielton',
};

export let ALL_DLC_IDS = Object.keys(TRAILER_DLCS);

// ─── Cargo DLCs ───────────────────────────────────────────────────────

export let CARGO_DLCS: Record<string, string> = {
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

export let ALL_CARGO_DLC_IDS = Object.keys(CARGO_DLCS);

// ─── Map DLCs ─────────────────────────────────────────────────────────

export let MAP_DLCS: Record<string, string> = {
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

export let ALL_MAP_DLC_IDS = Object.keys(MAP_DLCS);

// ─── Garage Cities ────────────────────────────────────────────────────

export let GARAGE_CITIES: ReadonlySet<string> = new Set([
  // Austria (6)
  'graz','innsbruck','klagenfurt','linz','salzburg','wien',
  // Albania (1)
  'tirana',
  // Belgium (2)
  'brussel','liege',
  // Bosnia (2)
  'banja_luka','sarajevo',
  // Bulgaria (6)
  'burgas','pleven','plovdiv','ruse','sofia','varna',
  // Croatia (3)
  'rijeka','split','zagreb',
  // Czech (3)
  'brno','ostrava','prague',
  // Denmark (4)
  'aalborg','aarhus','kobenhavn','odense',
  // Finland (7)
  'helsinki','kotka','kouvola','lahti','pori','tampere','turku',
  // France (24)
  'ajaccio','bastia','bordeaux','brest','calais','calvi','clermont','dijon',
  'larochelle','lehavre','lemans','lille','limoges','lyon','marseille','metz',
  'montpellier','nantes','nice','paris','reims','rennes','strasbourg','toulouse',
  // Germany (21)
  'berlin','bremen','dortmund','dresden','duisburg','dusseldorf','erfurt','frankfurt',
  'hamburg','hannover','kassel','kiel','koln','leipzig','magdeburg','mannheim',
  'munchen','nurnberg','osnabruck','rostock','stuttgart',
  // Greece (5)
  'athens','kalamata','lamia','patras','thessaloniki',
  // Hungary (4)
  'budapest','debrecen','pecs','szeged',
  // Italy (21)
  'ancona','bari','bologna','cagliari','catania','catanzaro','firenze','genova',
  'livorno','messina','milano','napoli','olbia','palermo','pescara','roma',
  'sassari','taranto','torino','venezia','verona',
  // Kosovo (1)
  'pristina',
  // Latvia (5)
  'daugavpils','liepaja','rezekne','riga','valmiera',
  // Lithuania (5)
  'kaunas','klaipeda','panevezys','siauliai','vilnius',
  // Luxembourg (1)
  'luxembourg',
  // Montenegro (1)
  'podgorica',
  // Netherlands (3)
  'amsterdam','groningen','rotterdam',
  // North Macedonia (1)
  'skopje',
  // Norway (4)
  'bergen','kristiansand','oslo','stavanger',
  // Poland (11)
  'bialystok','gdansk','katowice','krakow','lodz','lublin','olsztyn','poznan',
  'szczecin','warszawa','wroclaw',
  // Portugal (3)
  'coimbra','lisboa','porto',
  // Romania (10)
  'brasov','bucuresti','cluj_napoca','constanta','craiova','galati','iasi',
  'pitesti','targu_mures','timisoara',
  // Russia (4)
  'kaliningrad','luga','pskov','petersburg',
  // Serbia (3)
  'beograd','kragujevac','novi_sad',
  // Slovakia (3)
  'bystrica','bratislava','kosice',
  // Slovenia (2)
  'ljubljana','maribor',
  // Spain (17)
  'a_coruna','albacete','algeciras','almeria','barcelona','bilbao','burgos',
  'cordoba','madrid','malaga','murcia','salamanca','sevilla','valencia',
  'valladolid','vigo','zaragoza',
  // Sweden (13)
  'goteborg','helsingborg','jonkoping','kalmar','karlskrona','karlstad',
  'linkoping','malmo','orebro','stockholm','uppsala','vasteraas','vaxjo',
  // Switzerland (3)
  'bern','geneve','zurich',
  // Turkey (3)
  'edirne','istanbul','tekirdag',
  // UK (18)
  'aberdeen','birmingham','cambridge','cardiff','carlisle','dover','edinburgh',
  'felixstowe','glasgow','grimsby','liverpool','london','manchester','newcastle',
  'plymouth','sheffield','southampton','swansea',
]);

// ─── City → DLC Map ──────────────────────────────────────────────────

export let CITY_DLC_MAP: Record<string, string[]> = {
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

// ─── Cargo DLC Maps ───────────────────────────────────────────────────

/** Shadow cargo DLC entries for map expansions (wiki-verified) */
export let MAP_DLC_CARGO: Record<string, string> = {
  // Beyond the Baltic Sea (6)
  concr_cent: 'beyond_the_baltic_sea', concr_stair: 'beyond_the_baltic_sea',
  metal_beams: 'beyond_the_baltic_sea', re_bars: 'beyond_the_baltic_sea',
  train_part: 'beyond_the_baltic_sea', train_part2: 'beyond_the_baltic_sea',
  // Greece (3)
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
export let CARGO_DLC_MAP: Record<string, string> = {
  // High Power Cargo Pack
  aircond: 'high_power', hvac: 'high_power', crawler: 'high_power', driller: 'high_power',
  tube: 'high_power', helicopter: 'high_power', roller: 'high_power', tracks: 'high_power', yacht: 'high_power',
  // Heavy Cargo Pack
  asph_miller: 'heavy_cargo', concr_beams: 'heavy_cargo', concr_beams2: 'heavy_cargo',
  dozer: 'heavy_cargo', cable_reel: 'heavy_cargo', locomotive: 'heavy_cargo',
  metal_center: 'heavy_cargo', mobile_crane: 'heavy_cargo', mob_crusher: 'heavy_cargo',
  mob_screener: 'heavy_cargo', mob_stacker: 'heavy_cargo', transformat: 'heavy_cargo',
  // Special Transport
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
export let COMBINED_CARGO_DLC_MAP: Record<string, string> = {
  ...CARGO_DLC_MAP,
  ...MAP_DLC_CARGO,
};

// ─── Dynamic Initialization ──────────────────────────────────────────

export interface DlcSection {
  trailer_dlcs: Record<string, string>;
  cargo_dlcs: Record<string, string>;
  map_dlcs: Record<string, string>;
  city_dlc_map: Record<string, string[]>;
  cargo_dlc_map: Record<string, string>;
  map_dlc_cargo: Record<string, string>;
  garage_cities: string[];
}

/**
 * Override fallback DLC data with live data from game-defs.json.
 * Called by loadAllData() when the dlc section exists.
 */
export function initDlcData(dlc: DlcSection): void {
  TRAILER_DLCS = dlc.trailer_dlcs;
  ALL_DLC_IDS = Object.keys(TRAILER_DLCS);

  CARGO_DLCS = dlc.cargo_dlcs;
  ALL_CARGO_DLC_IDS = Object.keys(CARGO_DLCS);

  MAP_DLCS = dlc.map_dlcs;
  ALL_MAP_DLC_IDS = Object.keys(MAP_DLCS);

  CITY_DLC_MAP = dlc.city_dlc_map;
  CARGO_DLC_MAP = dlc.cargo_dlc_map;
  MAP_DLC_CARGO = dlc.map_dlc_cargo;
  COMBINED_CARGO_DLC_MAP = { ...CARGO_DLC_MAP, ...MAP_DLC_CARGO };

  GARAGE_CITIES = new Set(dlc.garage_cities);
}
