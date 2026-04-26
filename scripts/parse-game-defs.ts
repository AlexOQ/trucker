// ETS2 / ATS Game Definition Parser
// Parses extracted SII/SUI files from SCS game archives and generates
// JSON data files for the Trucker Advisor frontend.
//
// Usage:
//   npx tsx scripts/parse-game-defs.ts <path-to-def-folder> [--game ets2|ats]          # Parse and write
//   npx tsx scripts/parse-game-defs.ts <path-to-def-folder> --diff [--game ets2|ats]   # Diff against existing, don't write

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';

const args = process.argv.slice(2);
const diffMode = args.includes('--diff');
const gameFlagIdx = args.indexOf('--game');
const rawGame = gameFlagIdx >= 0 ? args[gameFlagIdx + 1] : 'ets2';
if (!process.env.VITEST && rawGame !== 'ets2' && rawGame !== 'ats') {
  console.error(`Unknown --game value: ${rawGame}. Must be 'ets2' or 'ats'.`);
  process.exit(1);
}
// Cast: under VITEST the value is whatever vitest passed; the parser's runtime
// codepaths (main, runDiff) never execute under VITEST so the cast is safe.
const game = (rawGame === 'ats' ? 'ats' : 'ets2') as 'ets2' | 'ats';
const rawDefsPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--game');
if (!process.env.VITEST && (!rawDefsPath || !existsSync(rawDefsPath))) {
  console.error('Usage: npx tsx scripts/parse-game-defs.ts <path-to-def-folder> [--diff] [--game ets2|ats]');
  console.error('  --diff        Compare against existing game-defs.json without writing');
  console.error('  --game <id>   Target game (default: ets2). Routes I/O to public/data/<id>/game-defs.json');
  console.error('Example: npx tsx scripts/parse-game-defs.ts /tmp/ats-dlc-defs --game ats --diff');
  process.exit(1);
}
// Same VITEST safety: defsPath is only consumed inside main()/runDiff which
// are gated; cast to string for the file-reading helpers.
const defsPath: string = rawDefsPath ?? '';
const gameDefsPath = join(process.cwd(), 'public', 'data', game, 'game-defs.json');

// ─── SII/SUI Parser ────────────────────────────────────────────────────

interface ParsedUnit {
  type: string;       // e.g. "cargo_data", "trailer_def", "city_data"
  name: string;       // e.g. "cargo.almond", "trailer_def.feldbinder..."
  props: Record<string, string | string[] | number | boolean>;
  sourceFile?: string; // filename this unit was parsed from (for DLC tracking)
}

function parseSiiFile(content: string): ParsedUnit[] {
  const units: ParsedUnit[] = [];
  const lines = content.split('\n');

  let currentUnit: ParsedUnit | null = null;
  let braceDepth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comments, empty lines, includes, SiiNunit wrapper
    if (!line || line.startsWith('#') || line.startsWith('//') ||
        line.startsWith('@include') || line === 'SiiNunit' || line === '}') {
      if (line === '}' && currentUnit) {
        braceDepth--;
        if (braceDepth === 0) {
          units.push(currentUnit);
          currentUnit = null;
        }
      }
      continue;
    }

    if (line === '{') {
      if (currentUnit) braceDepth++;
      continue;
    }

    // Unit declaration: "type : name" or "type : name {"
    const unitMatch = line.match(/^(\w+)\s*:\s*(.+?)(?:\s*\{)?$/);
    if (unitMatch && !currentUnit) {
      currentUnit = {
        type: unitMatch[1],
        name: unitMatch[2].trim(),
        props: {},
      };
      if (line.endsWith('{')) braceDepth = 1;
      continue;
    }

    if (!currentUnit) continue;

    // Handle opening brace on same line as unit declaration
    if (line === '{') {
      braceDepth++;
      continue;
    }

    // Property: "key: value" or "key[]: value" or "key[N]: value"
    const propMatch = line.match(/^\t*(\w+)(\[\d*\])?\s*:\s*(.+)$/);
    if (propMatch) {
      const key = propMatch[1];
      const isArray = propMatch[2] !== undefined;
      const indexMatch = propMatch[2]?.match(/\[(\d+)\]/);
      let value = propMatch[3].trim();

      // Remove trailing comments (preceded by space or tab)
      const commentIdx = value.indexOf('#');
      if (commentIdx > 0 && /\s/.test(value[commentIdx - 1])) {
        value = value.substring(0, commentIdx).trim();
      }
      // Also handle // comments
      const slashIdx = value.indexOf('//');
      if (slashIdx > 0 && /\s/.test(value[slashIdx - 1])) {
        value = value.substring(0, slashIdx).trim();
      }

      // Remove quotes
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      if (isArray) {
        const existing = currentUnit.props[key];
        if (indexMatch) {
          // Indexed array: key[0], key[1], etc.
          const idx = parseInt(indexMatch[1]);
          if (!Array.isArray(existing)) {
            currentUnit.props[key] = [];
          }
          (currentUnit.props[key] as string[])[idx] = value;
        } else if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          currentUnit.props[key] = [value];
        }
      } else {
        // Parse typed values
        if (value === 'true') currentUnit.props[key] = true;
        else if (value === 'false') currentUnit.props[key] = false;
        else if (/^-?\d+(\.\d+)?$/.test(value)) currentUnit.props[key] = parseFloat(value);
        else currentUnit.props[key] = value;
      }
    }
  }

  return units;
}

function readAllSiiFiles(dir: string, ext = '.sui'): ParsedUnit[] {
  if (!existsSync(dir)) return [];
  const units: ParsedUnit[] = [];
  for (const file of readdirSync(dir)) {
    if (file.endsWith(ext) || file.endsWith('.sii')) {
      const content = readFileSync(join(dir, file), 'utf-8');
      const parsed = parseSiiFile(content);
      for (const unit of parsed) unit.sourceFile = file;
      units.push(...parsed);
    }
  }
  return units;
}

// ─── Cargo Extraction ──────────────────────────────────────────────────

interface CargoData {
  id: string;
  name: string;
  value: number;
  volume: number;
  mass: number;
  fragility: number;
  fragile: boolean;      // fragility >= 0.5 (default 1.0 when not specified in defs)
  high_value: boolean;   // valuable: true
  adr_class: number;
  prob_coef: number;
  body_types: string[];
  groups: string[];
  min_distance: number;
  max_distance: number;
  overweight: boolean;
  excluded: boolean;
  unit_load_time: number;
  dlc?: string;          // cargo DLC pack ID (see CARGO_DLC_MAP below)
}

// Cargo DLC mapping — verified against trucksimulator.wiki.gg/wiki/Cargo_types
// Source: https://trucksimulator.wiki.gg/wiki/Cargo_types/Euro_Truck_Simulator_2
const ETS2_CARGO_DLC_MAP: Record<string, string> = {
  // High Power Cargo Pack (8 cargo types)
  aircond: 'high_power', hvac: 'high_power', crawler: 'high_power', driller: 'high_power',
  tube: 'high_power', helicopter: 'high_power', roller: 'high_power', tracks: 'high_power', yacht: 'high_power',
  // Heavy Cargo Pack (11 cargo types)
  asph_miller: 'heavy_cargo', concr_beams: 'heavy_cargo', concr_beams2: 'heavy_cargo',
  dozer: 'heavy_cargo', cable_reel: 'heavy_cargo', locomotive: 'heavy_cargo',
  metal_center: 'heavy_cargo', mobile_crane: 'heavy_cargo', mob_crusher: 'heavy_cargo',
  mob_screener: 'heavy_cargo', mob_stacker: 'heavy_cargo', transformat: 'heavy_cargo',
  // Special Transport (14 cargo types, most escort-only; only CZLoko has regular body types)
  czl_es300: 'special_transport', czl_muv75: 'special_transport',
  // Volvo Construction Equipment (7 cargo types)
  volvo_a25g: 'volvo_ce', volvo_bucket: 'volvo_ce', volvo_sd160b: 'volvo_ce',
  volvo_ec220e: 'volvo_ce', volvo_l250h: 'volvo_ce', volvo_rims: 'volvo_ce', vol_ew240emh: 'volvo_ce',
  // JCB Equipment Pack (10 cargo types)
  jcb_bhl4cx: 'jcb', jcb_g100rs: 'jcb', jcb_dmphtd5e: 'jcb', jcb_mexc19ce: 'jcb',
  jcb_exc245xr: 'jcb', jcb_pw125qe: 'jcb', jcb_dmp6t2: 'jcb', jcb_th540180: 'jcb',
  jcb_ft4220: 'jcb', jcb_wload457: 'jcb',
  // Bobcat Cargo Pack (7 cargo types)
  bob_tl3070a: 'bobcat', bob_pa127v: 'bobcat', bob_e60: 'bobcat', bob_d30: 'bobcat',
  bob_e10e: 'bobcat', bob_s86: 'bobcat', bob_l95: 'bobcat',
  // KRONE Agriculture Equipment (7 cargo types)
  kr_ecb880cv: 'krone_agri', kr_bigx1180: 'krone_agri', kr_bigm450: 'krone_agri',
  kr_stc1370: 'krone_agri', kr_vpv190xc: 'krone_agri', kr_bigp1290: 'krone_agri', kr_gx520: 'krone_agri',
  // Farm Machinery (9 cargo types)
  auger_wag: 'farm_machinery', tractor_au: 'farm_machinery', tractor_c: 'farm_machinery',
  disc_harrows: 'farm_machinery', fert_spread: 'farm_machinery', forage_harv: 'farm_machinery',
  planter: 'farm_machinery', sprayer: 'farm_machinery', square_baler: 'farm_machinery',
  // Forest Machinery (8 cargo types)
  exc_craw: 'forest_machinery', forwarder: 'forest_machinery', log_harvest: 'forest_machinery',
  log_stacker: 'forest_machinery', mob_tr_winch: 'forest_machinery', mulcher: 'forest_machinery',
  skidder: 'forest_machinery', wood_chipper: 'forest_machinery',
};

// ─── DLC Registries (display names for the frontend DLC section) ─────

/** Trailer DLC packs — brand prefix → display name (ETS2) */
const ETS2_TRAILER_DLCS: Record<string, string> = {
  feldbinder: 'Feldbinder',
  kassbohrer: 'Kassbohrer',
  kogel: 'Kögel',
  krone: 'Krone',
  schmitz: 'Schmitz Cargobull',
  schwmuller: 'Schwarzmüller',
  tirsan: 'Tirsan',
  wielton: 'Wielton',
};

/** Cargo DLC packs — pack ID → display name (ETS2) */
const ETS2_CARGO_DLCS: Record<string, string> = {
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

/** Map expansion DLCs — DLC ID → display name (ETS2) */
const ETS2_MAP_DLCS: Record<string, string> = {
  going_east: 'Going East!',
  scandinavia: 'Scandinavia',
  vive_la_france: 'Vive la France!',
  italia: 'Italia',
  beyond_the_baltic_sea: 'Beyond the Baltic Sea',
  road_to_the_black_sea: 'Road to the Black Sea',
  iberia: 'Iberia',
  west_balkans: 'West Balkans',
  greece: 'Greece',
  nordic_horizons: 'Nordic Horizons',
};

/** Map DLC → cities that require it (wiki-verified, ETS2) */
const ETS2_CITY_DLC_MAP: Record<string, string[]> = {
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
    'timisoara','varna','veli_tarnovi',
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
  nordic_horizons: [
    'alesund','alta','andenes','arvidsjaur','bodo','borlange','dombas','falun','gavle',
    'hamar','haparanda','honningsvag','ivalo','joensuu','jyvaskyla','kajaani','karesuando',
    'kiruna','kokkola','kristiansund','kuopio','kuusamo','lappeenranta','lillehammer',
    'lulea','mikkeli','mo_i_rana','narvik','ornskoldsvik','ostersund','oulu','rovaniemi',
    'skelleftea','steinkjer','sundsvall','svolvaer','tornio','tromso','trondheim','umea','vaasa',
  ],
};

/**
 * Shadow cargo DLC entries for map expansions (wiki-verified).
 * Same filtering mechanism as cargo pack DLCs, toggled by map DLC ownership.
 * Cargo packs trump map DLCs for dual-tagged cargo (those stay in CARGO_DLC_MAP only).
 */
const ETS2_MAP_DLC_CARGO: Record<string, string> = {
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

// ─── ATS DLC Registries ──────────────────────────────────────────────
// Sources:
//   https://trucksimulator.wiki.gg/wiki/American_Truck_Simulator (state DLC list)
//   https://store.steampowered.com/dlc/270880/American_Truck_Simulator/ (cargo + trailer packs)
//   https://store.steampowered.com/app/1967690/American_Truck_Simulator__Lode_King__Prestige_Trailers_Pack/

/** ATS state country → state DLC ID (null = base game / free DLC, no purchase required). */
const ATS_STATE_TO_DLC: Record<string, string | null> = {
  arizona: null,        // free DLC since June 2016, treated as base
  california: null,     // base game
  nevada: null,         // base game
  new_mexico: 'new_mexico',
  oregon: 'oregon',
  washington: 'washington',
  utah: 'utah',
  idaho: 'idaho',
  colorado: 'colorado',
  wyoming: 'wyoming',
  montana: 'montana',
  texas: 'texas',
  oklahoma: 'oklahoma',
  kansas: 'kansas',
  nebraska: 'nebraska',
  arkansas: 'arkansas',
  iowa: 'iowa',
  louisiana: 'louisiana',
  missouri: 'missouri',
};

/** Trailer DLC packs (ATS) — brand prefix → display name. Both `lodeking.*`
 * and `prestige.*` trailers ship in the same DLC; mapping both to the same
 * display name causes the frontend DLC page to render them as a single row. */
const ATS_TRAILER_DLCS: Record<string, string> = {
  lodeking: 'Lode King & Prestige Trailers Pack',
  prestige: 'Lode King & Prestige Trailers Pack',
};

/** Cargo DLC packs (ATS) — pack ID → display name. */
const ATS_CARGO_DLCS: Record<string, string> = {
  bobcat: 'Bobcat Cargo Pack',
  jcb: 'JCB Equipment Pack',
  heavy_cargo: 'Heavy Cargo Pack',
  krone_agri: 'KRONE Agriculture Equipment',
  farm_machinery: 'Farm Machinery',
  volvo_ce: 'Volvo Construction Equipment',
  special_transport: 'Special Transport',
  forest_machinery: 'Forest Machinery',
};

/** State map expansion DLCs (ATS) — DLC ID → display name. Released states only. */
const ATS_MAP_DLCS: Record<string, string> = {
  new_mexico: 'New Mexico',
  oregon: 'Oregon',
  washington: 'Washington',
  utah: 'Utah',
  idaho: 'Idaho',
  colorado: 'Colorado',
  wyoming: 'Wyoming',
  montana: 'Montana',
  texas: 'Texas',
  oklahoma: 'Oklahoma',
  kansas: 'Kansas',
  nebraska: 'Nebraska',
  arkansas: 'Arkansas',
  iowa: 'Iowa',
  louisiana: 'Louisiana',
  missouri: 'Missouri',
};

/** Cargo → DLC pack mapping (ATS).
 *
 * NOT YET POPULATED — populating per-cargo DLC pack assignments for ATS
 * requires per-pack wiki research (which cargo IDs ship in which pack).
 * Until populated, ATS cargo will report no DLC pack on the marginal-value
 * calculator. Tracked as a follow-up. */
const ATS_CARGO_DLC_MAP: Record<string, string> = {};

/** Cargo only available with a specific map expansion (ATS).
 *
 * NOT YET POPULATED — same reason as ATS_CARGO_DLC_MAP. */
const ATS_MAP_DLC_CARGO: Record<string, string> = {};

// ─── Game-aware aliases ─────────────────────────────────────────────
// Every site below references the unprefixed name. These switches pick
// the right list based on the active --game flag.

const TRAILER_DLCS: Record<string, string> =
  game === 'ats' ? ATS_TRAILER_DLCS : ETS2_TRAILER_DLCS;

const CARGO_DLCS: Record<string, string> =
  game === 'ats' ? ATS_CARGO_DLCS : ETS2_CARGO_DLCS;

const MAP_DLCS: Record<string, string> =
  game === 'ats' ? ATS_MAP_DLCS : ETS2_MAP_DLCS;

const CARGO_DLC_MAP: Record<string, string> =
  game === 'ats' ? ATS_CARGO_DLC_MAP : ETS2_CARGO_DLC_MAP;

const MAP_DLC_CARGO: Record<string, string> =
  game === 'ats' ? ATS_MAP_DLC_CARGO : ETS2_MAP_DLC_CARGO;

/** Cities by DLC. For ATS this is computed by grouping each city by its
 * country (state) and routing through ATS_STATE_TO_DLC. The set of cities
 * is not yet known here (cities are extracted later); we expose a builder
 * the city extractor calls once it has the data. */
export function buildAtsCityDlcMap(cityIds: Array<{ id: string; country: string }>): Record<string, string[]> {
  const byDlc: Record<string, string[]> = {};
  for (const c of cityIds) {
    const dlc = ATS_STATE_TO_DLC[c.country];
    if (!dlc) continue; // base / free state, no DLC required
    if (!byDlc[dlc]) byDlc[dlc] = [];
    byDlc[dlc].push(c.id);
  }
  for (const dlc of Object.keys(byDlc)) byDlc[dlc].sort();
  return byDlc;
}

/** Game-aware city → DLCs map factory. Pure: no I/O, no module-scope state. */
function getCityDlcMap(
  game: 'ets2' | 'ats',
  cities: Array<{ id: string; country: string }>,
): Record<string, string[]> {
  return game === 'ats' ? buildAtsCityDlcMap(cities) : ETS2_CITY_DLC_MAP;
}

/**
 * Cities that have a garage available in ETS2 (wiki-verified).
 * Source: https://trucksimulator.wiki.gg/wiki/Garages/Euro_Truck_Simulator_2
 */
const ETS2_GARAGE_CITIES: ReadonlySet<string> = new Set([
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
  // Estonia (3)
  'parnu','tallinn','tartu',
  // Finland (11)
  'helsinki','jyvaskyla','kotka','kouvola','kuopio','lahti','oulu','pori','rovaniemi','tampere','turku',
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
  // Norway (8)
  'alesund','bergen','bodo','kristiansand','oslo','stavanger','tromso','trondheim',
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
  // Sweden (16)
  'goteborg','helsingborg','jonkoping','kalmar','karlskrona','karlstad',
  'linkoping','lulea','malmo','orebro','ostersund','stockholm','umea','uppsala','vasteraas','vaxjo',
  // Switzerland (3)
  'bern','geneve','zurich',
  // Turkey (3)
  'edirne','istanbul','tekirdag',
  // UK (18)
  'aberdeen','birmingham','cambridge','cardiff','carlisle','dover','edinburgh',
  'felixstowe','glasgow','grimsby','liverpool','london','manchester','newcastle',
  'plymouth','sheffield','southampton','swansea',
]);

/**
 * Cities that have a garage available in ATS (wiki-verified).
 * Source: https://trucksimulator.wiki.gg/wiki/Garages/American_Truck_Simulator
 *
 * IDs are SCS internal city identifiers (12-char truncated form, as found
 * in `city_data : city.<id>` inside each .sui file). The wiki lists display
 * names (e.g. "Oklahoma City") which map to truncated internal IDs
 * (`oklahoma_cit`). Always use the truncated form so this set matches the
 * `city.id` keys produced by the parser.
 *
 * NOTE: The 12-char truncation rule is what SCS *usually* does, but they make
 * per-city exceptions:
 *   - Salt Lake City -> 'salt_lake' (literal short form, not 'salt_lake_ci')
 *   - Texarkana TX/AR is asymmetric: TX side is 'texarkana', AR side is 'texarkana_ar'
 *     (compare with Kansas City, where both halves get a state suffix:
 *      'kansas_ci_ks' / 'kansas_ci_mo')
 * If you "normalize" these to fit the truncation rule the corresponding
 * `has_garage` flag will silently fail.
 * To verify a city.id, check the regenerated public/data/ats/game-defs.json
 * (`jq '.cities | keys[]' public/data/ats/game-defs.json`).
 *
 * See also: the GARAGE_CITIES ⊆ cities[].id consistency assertion at the
 * tail of buildFrontendData() — drift in this set is now caught at parse time.
 */
const ATS_GARAGE_CITIES: ReadonlySet<string> = new Set([
  // Arizona (4)
  'flagstaff','phoenix','tucson','yuma',
  // Arkansas (7)
  'el_dorado','fayetteville','fort_smith','jonesboro','little_rock','pine_bluff','texarkana_ar',
  // California (7)
  'bakersfield','fresno','los_angeles','redding','sacramento','san_diego','san_francisc',
  // Colorado (8)
  'alamosa','colorado_spr','denver','fort_collins','lamar','montrose','steamboat_sp','sterling',
  // Idaho (5)
  'boise','coeur_dalene','idaho_falls','salmon','twin_falls',
  // Iowa (5)
  'council_bluf','des_moines','iowa_city','mason_city','sioux_city',
  // Kansas (6)
  'garden_city','hays','kansas_ci_ks','salina','topeka','wichita',
  // Louisiana (6)
  'alexandria','baton_rouge','lake_charles','monroe','new_orleans','shreveport',
  // Missouri (6)
  'cape_girarde','jefferson_ci','kansas_ci_mo','kirksville','springfield','st_louis',
  // Montana (6)
  'billings','great_falls','helena','kalispell','miles_city','missoula',
  // Nebraska (5)
  'grand_island','lincoln','north_platte','omaha','scottsbluff',
  // Nevada (4)
  'carson_city','elko','las_vegas','reno',
  // New Mexico (5)
  'albuquerque','farmington','las_cruces','roswell','santa_fe',
  // Oklahoma (5)
  'lawton','mcalester','oklahoma_cit','tulsa','woodward',
  // Oregon (6)
  'bend','eugene','medford','ontario','portland','salem',
  // Texas (16)
  'abilene','amarillo','austin','beaumont','corpus_chris','dallas','del_rio','el_paso',
  'fort_stockto','houston','laredo','lufkin','mcallen','odessa','san_antonio','texarkana',
  // Utah (5)
  'moab','price','salt_lake','st_george','vernal',
  // Washington (5)
  'kennewick','olympia','seattle','spokane','wenatchee',
  // Wyoming (5)
  'casper','cheyenne','evanston','gillette','jackson',
]);

/** Garage cities for the active --game target. */
const GARAGE_CITIES: ReadonlySet<string> = game === 'ats' ? ATS_GARAGE_CITIES : ETS2_GARAGE_CITIES;

function extractCargo(): CargoData[] {
  const cargoDir = join(defsPath, 'cargo');
  const units = readAllSiiFiles(cargoDir);

  // Also parse DLC cargo files from parent dir (they include more .sui files)
  const parentDir = dirname(defsPath) === defsPath ? defsPath : defsPath;
  // DLC cargo .sui files are in the same cargo/ dir with dlc suffix naming

  const cargoList: CargoData[] = [];
  const seenIds = new Set<string>();

  // Vehicle cargo exclusions (not real hauled cargo)
  const vehicleCargoPrefixes = ['car_', 'vans_', 'pickup_', 'mondeos', 'volvo_cars', 'scania_tr', 'volvo_tr',
    'horse_tr', 'caravans', 'motorcycles', 'scooters', 'cars_fr'];

  for (const unit of units) {
    if (unit.type !== 'cargo_data') continue;

    const id = unit.name.replace('cargo.', '');
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    // Skip vehicle cargoes
    const isVehicleCargo = vehicleCargoPrefixes.some(p => id.startsWith(p) || id === p);
    if (isVehicleCargo) continue;

    // Skip trailer delivery cargoes (mass ~0, body_type starts with _)
    // and oversize cargo (player-only occasional jobs, not AI driver eligible)
    const bodyTypes = (unit.props.body_types as string[]) || [];
    const isTrailerDelivery = (typeof unit.props.mass === 'number' && unit.props.mass < 0.01)
      || bodyTypes.every(bt => bt.startsWith('_'));
    if (isTrailerDelivery) continue;

    const name = String(unit.props.name || id).replace(/@@cn_|@@/g, '');
    const groups = (unit.props.group as string[]) || [];
    // When fragility is not specified, the game treats cargo as maximally fragile (1.0).
    // The 25 cargo without explicit fragility are all inherently fragile:
    // live animals, glass, explosives, chemicals, vaccines, etc.
    const fragility = typeof unit.props.fragility === 'number' ? unit.props.fragility : 1.0;

    cargoList.push({
      id,
      name,
      value: typeof unit.props.unit_reward_per_km === 'number' ? unit.props.unit_reward_per_km : 0,
      volume: typeof unit.props.volume === 'number' ? unit.props.volume : 1,
      mass: typeof unit.props.mass === 'number' ? unit.props.mass : 0,
      fragility,
      fragile: fragility >= 0.5,  // High fragility = fragile cargo skill applies
      high_value: unit.props.valuable === true,
      adr_class: typeof unit.props.adr_class === 'number' ? unit.props.adr_class : 0,
      prob_coef: typeof unit.props.prob_coef === 'number' ? unit.props.prob_coef : 1.0,
      body_types: bodyTypes,
      groups,
      min_distance: typeof unit.props.minimum_distance === 'number' ? unit.props.minimum_distance : 0,
      max_distance: typeof unit.props.maximum_distance === 'number' ? unit.props.maximum_distance : 0,
      overweight: id === 'overweight' || groups.includes('oversize'),
      excluded: false,
      unit_load_time: typeof unit.props.unit_load_time === 'number' ? unit.props.unit_load_time : 0,
      dlc: CARGO_DLC_MAP[id],
    });
  }

  return cargoList.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Trailer Extraction ────────────────────────────────────────────────

interface TrailerData {
  id: string;
  name: string;
  body_type: string;
  volume: number;
  chassis_mass: number;
  body_mass: number;
  gross_weight_limit: number;
  length: number;
  axles: number;
  chain_type: string;
  country_validity: string[];
  ownable: boolean;
}

function extractTrailers(): TrailerData[] {
  const trailerDefsDir = join(defsPath, 'vehicle', 'trailer_defs');
  const units = readAllSiiFiles(trailerDefsDir, '.sii');

  const trailers: TrailerData[] = [];
  const seenIds = new Set<string>();

  for (const unit of units) {
    if (unit.type !== 'trailer_def') continue;

    const fullName = unit.name.replace('trailer_def.', '');
    if (seenIds.has(fullName)) continue;
    seenIds.add(fullName);

    const countryValidity = (unit.props.country_validity as string[]) || [];

    trailers.push({
      id: fullName,
      name: formatTrailerName(fullName),
      body_type: String(unit.props.body_type || 'unknown'),
      volume: typeof unit.props.volume === 'number' ? unit.props.volume : 0,
      chassis_mass: typeof unit.props.chassis_mass === 'number' ? unit.props.chassis_mass : 0,
      body_mass: typeof unit.props.body_mass === 'number' ? unit.props.body_mass : 0,
      gross_weight_limit: typeof unit.props.gross_trailer_weight_limit === 'number'
        ? unit.props.gross_trailer_weight_limit : 0,
      length: typeof unit.props.length === 'number' ? unit.props.length : 0,
      axles: typeof unit.props.axles === 'number' ? unit.props.axles : 0,
      chain_type: String(unit.props.chain_type || 'single'),
      country_validity: countryValidity,
      ownable: true, // trailer_defs are generally ownable; non-ownable are in trailer/ dir
    });
  }

  return trailers.sort((a, b) => a.name.localeCompare(b.name));
}

function formatTrailerName(id: string): string {
  // e.g. "feldbinder.eut.double_3_1_3.silo_35_3g" → "Feldbinder EUT Double 3+1+3 Silo 35 3G"
  return id
    .split('.')
    .map(part =>
      part
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
    )
    .join(' ');
}

// ─── Company Extraction ────────────────────────────────────────────────

interface CompanyData {
  id: string;
  name: string;
  cargo_out: string[];  // cargo IDs this company ships
  cargo_in: string[];   // cargo IDs this company receives
  cities: string[];     // city IDs where this company exists
}

function extractCompanies(): CompanyData[] {
  const companyDir = join(defsPath, 'company');
  if (!existsSync(companyDir)) return [];

  const companies: CompanyData[] = [];

  // Each subdirectory in company/ is a company
  for (const entry of readdirSync(companyDir)) {
    const companyPath = join(companyDir, entry);
    if (!statSync(companyPath).isDirectory()) continue;
    if (entry === 'ai') continue; // Skip AI company

    const id = entry;

    // Parse out/ directory for cargo this company ships
    const outDir = join(companyPath, 'out');
    const cargoOut: string[] = [];
    if (existsSync(outDir)) {
      for (const file of readdirSync(outDir)) {
        if (file.endsWith('.sii')) {
          const content = readFileSync(join(outDir, file), 'utf-8');
          const units = parseSiiFile(content);
          for (const unit of units) {
            if (unit.type === 'cargo_def' && unit.props.cargo) {
              const cargoId = String(unit.props.cargo).replace('cargo.', '').replace(/"/g, '');
              if (!cargoOut.includes(cargoId)) cargoOut.push(cargoId);
            }
          }
        }
      }
    }

    // Parse in/ directory for cargo this company receives
    const inDir = join(companyPath, 'in');
    const cargoIn: string[] = [];
    if (existsSync(inDir)) {
      for (const file of readdirSync(inDir)) {
        if (file.endsWith('.sii')) {
          const content = readFileSync(join(inDir, file), 'utf-8');
          const units = parseSiiFile(content);
          for (const unit of units) {
            if (unit.type === 'cargo_def' && unit.props.cargo) {
              const cargoId = String(unit.props.cargo).replace('cargo.', '').replace(/"/g, '');
              if (!cargoIn.includes(cargoId)) cargoIn.push(cargoId);
            }
          }
        }
      }
    }

    // Parse editor/ directory for city placements
    const editorDir = join(companyPath, 'editor');
    const cities: string[] = [];
    if (existsSync(editorDir)) {
      for (const file of readdirSync(editorDir)) {
        if (file.endsWith('.sii')) {
          const content = readFileSync(join(editorDir, file), 'utf-8');
          const units = parseSiiFile(content);
          for (const unit of units) {
            if (unit.type === 'company_def' && unit.props.city) {
              const cityId = String(unit.props.city);
              if (!cities.includes(cityId)) cities.push(cityId);
            }
          }
        }
      }
    }

    // Only include companies that have cargo and city placements
    if ((cargoOut.length > 0 || cargoIn.length > 0) && cities.length > 0) {
      companies.push({
        id,
        name: formatCompanyName(id),
        cargo_out: cargoOut.sort(),
        cargo_in: cargoIn.sort(),
        cities: cities.sort(),
      });
    }
  }

  return companies.sort((a, b) => a.name.localeCompare(b.name));
}

function formatCompanyName(id: string): string {
  // Simple formatting: replace underscores, capitalize
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── City Extraction ───────────────────────────────────────────────────

interface CityData {
  id: string;
  name: string;
  country: string;
  population: number;
}

function extractCities(): CityData[] {
  const cityDir = join(defsPath, 'city');
  const units = readAllSiiFiles(cityDir);

  const cities: CityData[] = [];

  for (const unit of units) {
    if (unit.type !== 'city_data') continue;

    const id = unit.name.replace('city.', '');
    const rawName = String(unit.props.city_name || id);

    cities.push({
      id,
      name: rawName,
      country: String(unit.props.country || 'unknown').toLowerCase(),
      population: typeof unit.props.population === 'number' ? unit.props.population : 0,
    });
  }

  return cities.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Country Extraction ────────────────────────────────────────────────

interface CountryData {
  id: string;
  name: string;
}

function extractCountries(): CountryData[] {
  const countryDir = join(defsPath, 'country');
  const units = readAllSiiFiles(countryDir);

  const countries: CountryData[] = [];

  for (const unit of units) {
    if (unit.type !== 'country_data') continue;

    const id = unit.name.replace('country.data.', '');
    const name = String(unit.props.name || unit.props.country_name || id);

    countries.push({
      id,
      name: name.replace(/@@.*?@@/g, id),
    });
  }

  return countries.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Truck Extraction ──────────────────────────────────────────────────

interface TruckEngine {
  id: string;
  name: string;
  torque: number;
  volume: number;  // displacement in liters
  rpm_limit: number;
  price: number;
  unlock: number;
}

interface TruckTransmission {
  id: string;
  name: string;
  differential_ratio: number;
  forward_gears: number;
  reverse_gears: number;
  retarder: number;
  price: number;
  unlock: number;
}

interface TruckChassis {
  id: string;
  name: string;
  axle_config: string;  // e.g. "4x2", "6x4"
  tank_size: number;
  price: number;
  unlock: number;
}

interface TruckData {
  id: string;
  brand: string;
  model: string;
  engines: TruckEngine[];
  transmissions: TruckTransmission[];
  chassis: TruckChassis[];
}

function extractTrucks(): TruckData[] {
  const truckDir = join(defsPath, 'vehicle', 'truck');
  if (!existsSync(truckDir)) return [];

  const trucks: TruckData[] = [];

  for (const truckFolder of readdirSync(truckDir)) {
    const truckPath = join(truckDir, truckFolder);
    if (!statSync(truckPath).isDirectory()) continue;

    const parts = truckFolder.split('.');
    const brand = parts[0] || truckFolder;
    const model = parts.slice(1).join('.') || truckFolder;

    const truck: TruckData = {
      id: truckFolder,
      brand,
      model,
      engines: [],
      transmissions: [],
      chassis: [],
    };

    // Engines
    const engineDir = join(truckPath, 'engine');
    if (existsSync(engineDir)) {
      const units = readAllSiiFiles(engineDir, '.sii');
      for (const unit of units) {
        if (unit.type !== 'accessory_engine_data') continue;
        truck.engines.push({
          id: unit.name,
          name: String(unit.props.name || ''),
          torque: typeof unit.props.torque === 'number' ? unit.props.torque : 0,
          volume: typeof unit.props.volume === 'number' ? unit.props.volume : 0,
          rpm_limit: typeof unit.props.rpm_limit === 'number' ? unit.props.rpm_limit : 0,
          price: typeof unit.props.price === 'number' ? unit.props.price : 0,
          unlock: typeof unit.props.unlock === 'number' ? unit.props.unlock : 0,
        });
      }
    }

    // Transmissions
    const transDir = join(truckPath, 'transmission');
    if (existsSync(transDir)) {
      const units = readAllSiiFiles(transDir, '.sii');
      for (const unit of units) {
        if (unit.type !== 'accessory_transmission_data') continue;

        const forwardRatios = Object.keys(unit.props).filter(k => k === 'ratios_forward');
        const reverseRatios = Object.keys(unit.props).filter(k => k === 'ratios_reverse');

        // Count gears from indexed properties
        let forwardGears = 0;
        let reverseGears = 0;
        for (const key of Object.keys(unit.props)) {
          if (key === 'ratios_forward' && Array.isArray(unit.props[key])) {
            forwardGears = (unit.props[key] as string[]).length;
          }
          if (key === 'ratios_reverse' && Array.isArray(unit.props[key])) {
            reverseGears = (unit.props[key] as string[]).length;
          }
        }

        truck.transmissions.push({
          id: unit.name,
          name: String(unit.props.name || ''),
          differential_ratio: typeof unit.props.differential_ratio === 'number'
            ? unit.props.differential_ratio : 0,
          forward_gears: forwardGears,
          reverse_gears: reverseGears,
          retarder: typeof unit.props.retarder === 'number' ? unit.props.retarder : 0,
          price: typeof unit.props.price === 'number' ? unit.props.price : 0,
          unlock: typeof unit.props.unlock === 'number' ? unit.props.unlock : 0,
        });
      }
    }

    // Chassis
    const chassisDir = join(truckPath, 'chassis');
    if (existsSync(chassisDir)) {
      const units = readAllSiiFiles(chassisDir, '.sii');
      for (const unit of units) {
        if (unit.type !== 'accessory_chassis_data') continue;

        // Extract axle config from info[] or name
        let axleConfig = '';
        const info = unit.props.info;
        if (Array.isArray(info)) {
          const axleInfo = (info as string[]).find(i => /^\d+x\d+/.test(i));
          if (axleInfo) axleConfig = axleInfo;
        }
        if (!axleConfig) {
          const nameStr = String(unit.props.name || '');
          const axleMatch = nameStr.match(/(\d+x\d+)/);
          if (axleMatch) axleConfig = axleMatch[1];
        }

        truck.chassis.push({
          id: unit.name,
          name: String(unit.props.name || ''),
          axle_config: axleConfig,
          tank_size: typeof unit.props.tank_size === 'number' ? unit.props.tank_size : 0,
          price: typeof unit.props.price === 'number' ? unit.props.price : 0,
          unlock: typeof unit.props.unlock === 'number' ? unit.props.unlock : 0,
        });
      }
    }

    if (truck.engines.length > 0) {
      trucks.push(truck);
    }
  }

  return trucks.sort((a, b) => a.id.localeCompare(b.id));
}

// ─── Cargo-Trailer Matching (computed from body_types) ─────────────────

interface CargoTrailerMatch {
  cargo_id: string;
  trailer_id: string;
  units: number;       // floor(trailer_volume / cargo_volume)
  weight_limited: boolean;
}

function computeCargoTrailerMatches(
  cargo: CargoData[],
  trailers: TrailerData[]
): CargoTrailerMatch[] {
  const matches: CargoTrailerMatch[] = [];

  for (const c of cargo) {
    if (c.excluded) continue;

    for (const t of trailers) {
      // Match if trailer body_type is in cargo's body_types list
      if (!c.body_types.includes(t.body_type)) continue;

      // Calculate units
      let units = 1;
      if (c.volume > 0 && t.volume > 0) {
        units = Math.floor(t.volume / c.volume);
        if (units < 1) units = 1;
      }

      // Check weight limit — if cargo doesn't fit, skip entirely
      let weightLimited = false;
      if (t.gross_weight_limit > 0 && c.mass > 0) {
        const maxCargoWeight = t.gross_weight_limit - t.chassis_mass - t.body_mass;
        const weightUnits = Math.floor(maxCargoWeight / c.mass);
        if (weightUnits <= 0) continue; // cargo too heavy for this trailer
        if (weightUnits < units) {
          units = weightUnits;
          weightLimited = true;
        }
      }

      matches.push({
        cargo_id: c.id,
        trailer_id: t.id,
        units,
        weight_limited: weightLimited,
      });
    }
  }

  return matches;
}

// ─── City-Company Mapping ──────────────────────────────────────────────

interface CityCompanyEntry {
  city_id: string;
  company_id: string;
  count: number;  // depot count (from editor files, typically 1)
}

function buildCityCompanyMap(companies: CompanyData[]): CityCompanyEntry[] {
  const entries: CityCompanyEntry[] = [];

  for (const company of companies) {
    for (const cityId of company.cities) {
      entries.push({
        city_id: cityId,
        company_id: company.id,
        count: 1,
      });
    }
  }

  return entries.sort((a, b) => a.city_id.localeCompare(b.city_id) || a.company_id.localeCompare(b.company_id));
}

// ─── Economy Data ──────────────────────────────────────────────────────

interface EconomyData {
  fixed_revenue: number;
  revenue_coef_per_km: number;
  cargo_market_revenue_coef_per_km: number;
  driver_revenue_coef_per_km: number;
  delivery_window_coefs: number[];
  reward_bonus_fragile: number[];
  reward_bonus_valuable: number[];
  reward_bonus_long_dist: number[];
  reward_bonus_urgent: number[];
  reward_bonus_level: number;
}

function extractEconomy(): EconomyData {
  const econFile = join(defsPath, 'economy_data.sii');
  if (!existsSync(econFile)) {
    return {
      fixed_revenue: 600,
      revenue_coef_per_km: 0.9,
      cargo_market_revenue_coef_per_km: 1.0,
      driver_revenue_coef_per_km: 0.67,
      delivery_window_coefs: [1.0, 1.15, 1.4],
      reward_bonus_fragile: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
      reward_bonus_valuable: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
      reward_bonus_long_dist: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
      reward_bonus_urgent: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
      reward_bonus_level: 0.015,
    };
  }

  const content = readFileSync(econFile, 'utf-8');
  const units = parseSiiFile(content);
  const econ = units.find(u => u.type === 'economy_data');
  if (!econ) return extractEconomy(); // return defaults

  return {
    fixed_revenue: typeof econ.props.fixed_revenue === 'number' ? econ.props.fixed_revenue : 600,
    revenue_coef_per_km: typeof econ.props.revenue_coef_per_km === 'number'
      ? econ.props.revenue_coef_per_km : 0.9,
    cargo_market_revenue_coef_per_km: typeof econ.props.cargo_market_revenue_coef_per_km === 'number'
      ? econ.props.cargo_market_revenue_coef_per_km : 1.0,
    driver_revenue_coef_per_km: typeof econ.props.driver_revenue_coef_per_km === 'number'
      ? econ.props.driver_revenue_coef_per_km : 0.67,
    delivery_window_coefs: Array.isArray(econ.props.delivery_window_coef)
      ? (econ.props.delivery_window_coef as string[]).map(Number)
      : [1.0, 1.15, 1.4],
    reward_bonus_fragile: Array.isArray(econ.props.reward_bonus_fragile)
      ? (econ.props.reward_bonus_fragile as string[]).map(Number)
      : [0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
    reward_bonus_valuable: Array.isArray(econ.props.reward_bonus_valuable)
      ? (econ.props.reward_bonus_valuable as string[]).map(Number)
      : [0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
    reward_bonus_long_dist: Array.isArray(econ.props.reward_bonus_long_dist)
      ? (econ.props.reward_bonus_long_dist as string[]).map(Number)
      : [0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
    reward_bonus_urgent: Array.isArray(econ.props.reward_bonus_urgent)
      ? (econ.props.reward_bonus_urgent as string[]).map(Number)
      : [0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
    reward_bonus_level: typeof econ.props.reward_bonus_level === 'number'
      ? econ.props.reward_bonus_level : 0.015,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  console.log('Parsing ETS2 game definitions from:', defsPath);
  console.log('');

  // Extract all data
  console.log('Extracting cargo...');
  const cargo = extractCargo();
  console.log(`  Found ${cargo.length} cargo types`);

  console.log('Extracting trailers...');
  const trailers = extractTrailers();
  console.log(`  Found ${trailers.length} trailer definitions`);

  console.log('Extracting companies...');
  const companies = extractCompanies();
  console.log(`  Found ${companies.length} companies`);

  console.log('Extracting cities...');
  const cities = extractCities();
  console.log(`  Found ${cities.length} cities`);

  console.log('Extracting countries...');
  const countries = extractCountries();
  console.log(`  Found ${countries.length} countries`);

  console.log('Extracting economy data...');
  const economy = extractEconomy();
  console.log('  Done');

  console.log('Extracting trucks...');
  const trucks = extractTrucks();
  console.log(`  Found ${trucks.length} truck brands/models`);

  console.log('Computing cargo-trailer matches...');
  const matches = computeCargoTrailerMatches(cargo, trailers);
  console.log(`  Found ${matches.length} cargo-trailer combinations`);

  console.log('Building city-company map...');
  const cityCompanyMap = buildCityCompanyMap(companies);
  console.log(`  Found ${cityCompanyMap.length} city-company placements`);

  // Build frontend-compatible data structure
  const frontendData = buildFrontendData(cargo, trailers, companies, cities, countries, matches, cityCompanyMap, economy, trucks);

  if (diffMode) {
    runDiff(frontendData);
  } else {
    writeOutput(cargo, trailers, companies, cities, countries, economy, trucks, matches, cityCompanyMap, frontendData);
    printSummary(cargo, trailers, companies, cities, countries, trucks, matches, cityCompanyMap);
  }
}

// ─── Frontend Data Builder ────────────────────────────────────────────

function buildFrontendData(
  cargo: CargoData[], trailers: TrailerData[], companies: CompanyData[],
  cities: CityData[], countries: CountryData[], matches: CargoTrailerMatch[],
  cityCompanyMap: CityCompanyEntry[], economy: EconomyData, trucks: TruckData[],
) {
  // Game-aware city → DLCs map. Pure helper, no module-scope state.
  const cityDlcMap = getCityDlcMap(game, cities.map(c => ({ id: c.id, country: c.country })));

  // Consistency check: every GARAGE_CITIES entry must exist in the extracted
  // cities[]. Catches silent has_garage:false regressions when a hand-curated
  // ID drifts from SCS's actual city.id (the Salt Lake City class of bug).
  const cityIdSet = new Set(cities.map(c => c.id));
  const missingGarageCities = [...GARAGE_CITIES].filter(id => !cityIdSet.has(id));
  if (missingGarageCities.length > 0) {
    console.error(`[ERR] GARAGE_CITIES drift: ${missingGarageCities.length} id(s) not found in extracted cities[] for game=${game}:`);
    for (const id of missingGarageCities) console.error(`  - ${id}`);
    process.exit(1);
  }

  return {
    cargo: Object.fromEntries(cargo.map(c => [c.id, {
      name: c.name,
      value: c.value,
      volume: c.volume,
      mass: c.mass,
      fragility: c.fragility,
      fragile: c.fragile,
      high_value: c.high_value,
      adr_class: c.adr_class,
      prob_coef: c.prob_coef,
      body_types: c.body_types,
      groups: c.groups,
      excluded: c.excluded,
      ...(c.dlc ? { dlc: c.dlc } : {}),
    }])),
    trailers: Object.fromEntries(trailers.map(t => [t.id, {
      name: t.name,
      body_type: t.body_type,
      volume: t.volume,
      chassis_mass: t.chassis_mass,
      body_mass: t.body_mass,
      gross_weight_limit: t.gross_weight_limit,
      length: t.length,
      chain_type: t.chain_type,
      country_validity: t.country_validity.length > 0 ? t.country_validity : undefined,
      ownable: t.ownable,
    }])),
    companies: Object.fromEntries(companies.map(co => [co.id, {
      name: co.name,
      cargo_out: co.cargo_out,
      cargo_in: co.cargo_in,
      cities: co.cities,
    }])),
    cities: Object.fromEntries(cities.map(c => [c.id, {
      name: c.name,
      country: c.country,
      has_garage: GARAGE_CITIES.has(c.id),
    }])),
    countries: Object.fromEntries(countries.map(c => [c.id, { name: c.name }])),
    cargo_trailer_units: (() => {
      const result: Record<string, Record<string, number>> = {};
      for (const m of matches) {
        if (!result[m.cargo_id]) result[m.cargo_id] = {};
        result[m.cargo_id][m.trailer_id] = m.units;
      }
      return result;
    })(),
    company_cargo: Object.fromEntries(companies.map(co => [co.id, co.cargo_out])),
    cargo_trailers: (() => {
      const result: Record<string, string[]> = {};
      for (const m of matches) {
        if (!result[m.cargo_id]) result[m.cargo_id] = [];
        if (!result[m.cargo_id].includes(m.trailer_id)) {
          result[m.cargo_id].push(m.trailer_id);
        }
      }
      return result;
    })(),
    city_companies: (() => {
      const result: Record<string, Record<string, number>> = {};
      for (const entry of cityCompanyMap) {
        if (!result[entry.city_id]) result[entry.city_id] = {};
        result[entry.city_id][entry.company_id] = entry.count;
      }
      return result;
    })(),
    economy,
    trucks: trucks.map(t => ({
      id: t.id, brand: t.brand, model: t.model,
      engines: t.engines, transmissions: t.transmissions, chassis: t.chassis,
    })),
    // DLC registry — single source of truth for frontend
    dlc: {
      trailer_dlcs: TRAILER_DLCS,
      cargo_dlcs: CARGO_DLCS,
      map_dlcs: MAP_DLCS,
      city_dlc_map: cityDlcMap,
      cargo_dlc_map: CARGO_DLC_MAP,
      map_dlc_cargo: MAP_DLC_CARGO,
      garage_cities: [...GARAGE_CITIES].sort(),
    },
  };
}

// ─── Write Output ─────────────────────────────────────────────────────

function writeOutput(
  cargo: CargoData[], trailers: TrailerData[], companies: CompanyData[],
  cities: CityData[], countries: CountryData[], economy: EconomyData,
  trucks: TruckData[], matches: CargoTrailerMatch[], cityCompanyMap: CityCompanyEntry[],
  frontendData: ReturnType<typeof buildFrontendData>,
) {
  // Raw parsed files
  const outputDir = join(dirname(defsPath!), 'parsed');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const write = (name: string, data: unknown) => {
    const path = join(outputDir, name);
    writeFileSync(path, JSON.stringify(data, null, 2));
    console.log(`  Wrote ${path}`);
  };

  console.log('\nWriting raw parsed files...');
  write('cargo.json', cargo);
  write('trailers.json', trailers);
  write('companies.json', companies);
  write('cities.json', cities);
  write('countries.json', countries);
  write('economy.json', economy);
  write('trucks.json', trucks);
  write('cargo-trailers.json', matches);
  write('city-companies.json', cityCompanyMap);

  // Frontend game-defs.json
  console.log('\nGenerating frontend data file...');
  const frontendPath = gameDefsPath;
  mkdirSync(dirname(frontendPath), { recursive: true });
  const json = JSON.stringify(frontendData, null, 2);
  writeFileSync(frontendPath, json);
  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
  console.log(`  Wrote ${frontendPath} (${sizeMB}MB)`);
}

// ─── Summary ──────────────────────────────────────────────────────────

function printSummary(
  cargo: CargoData[], trailers: TrailerData[], companies: CompanyData[],
  cities: CityData[], countries: CountryData[], trucks: TruckData[],
  matches: CargoTrailerMatch[], cityCompanyMap: CityCompanyEntry[],
) {
  console.log('\n=== Summary ===');
  console.log(`Cargo: ${cargo.length} types`);
  console.log(`  High value: ${cargo.filter(c => c.high_value).length}`);
  console.log(`  Fragile (fragility >= 0.5): ${cargo.filter(c => c.fragile).length}`);
  console.log(`  ADR: ${cargo.filter(c => c.adr_class > 0).length}`);
  console.log(`  Body types: ${[...new Set(cargo.flatMap(c => c.body_types))].sort().join(', ')}`);
  console.log(`Trailers: ${trailers.length} definitions`);
  console.log(`  Body types: ${[...new Set(trailers.map(t => t.body_type))].sort().join(', ')}`);
  console.log(`  Country-restricted: ${trailers.filter(t => t.country_validity.length > 0).length}`);
  console.log(`  Chain types: ${[...new Set(trailers.map(t => t.chain_type))].sort().join(', ')}`);
  console.log(`Companies: ${companies.length}`);
  console.log(`Cities: ${cities.length}`);
  console.log(`Countries: ${countries.length}`);
  console.log(`Trucks: ${trucks.length} models, ${trucks.reduce((s, t) => s + t.engines.length, 0)} engines`);
  console.log(`Cargo-trailer matches: ${matches.length}`);
  console.log(`City-company placements: ${cityCompanyMap.length}`);
}

// ─── Diff Mode ────────────────────────────────────────────────────────

interface DiffChange {
  category: 'clean' | 'needs_input';
  section: string;
  type: 'added' | 'removed' | 'changed';
  id: string;
  detail: string;
}

function runDiff(newData: ReturnType<typeof buildFrontendData>): void {
  const existingPath = gameDefsPath;
  if (!existsSync(existingPath)) {
    console.log('No existing game-defs.json found — nothing to diff against.');
    console.log('Run without --diff to generate initial file.');
    return;
  }

  console.log('\n=== DIFF MODE ===');
  console.log(`Comparing against: ${existingPath}\n`);

  const existing = JSON.parse(readFileSync(existingPath, 'utf-8'));
  const changes: DiffChange[] = [];

  // --- Cargo diff ---
  diffSection(changes, 'cargo', existing.cargo || {}, newData.cargo, (id, oldVal, newVal) => {
    const diffs: string[] = [];
    if (oldVal.value !== newVal.value) diffs.push(`value: ${oldVal.value} → ${newVal.value}`);
    if (oldVal.volume !== newVal.volume) diffs.push(`volume: ${oldVal.volume} → ${newVal.volume}`);
    if (oldVal.mass !== newVal.mass) diffs.push(`mass: ${oldVal.mass} → ${newVal.mass}`);
    if (oldVal.prob_coef !== newVal.prob_coef) diffs.push(`prob_coef: ${oldVal.prob_coef} → ${newVal.prob_coef}`);
    if (oldVal.fragile !== newVal.fragile) diffs.push(`fragile: ${oldVal.fragile} → ${newVal.fragile}`);
    if (oldVal.high_value !== newVal.high_value) diffs.push(`high_value: ${oldVal.high_value} → ${newVal.high_value}`);
    if (JSON.stringify(oldVal.body_types) !== JSON.stringify(newVal.body_types))
      diffs.push(`body_types changed`);
    if (oldVal.dlc !== newVal.dlc) diffs.push(`dlc: ${oldVal.dlc || 'none'} → ${newVal.dlc || 'none'}`);
    return diffs.length > 0 ? diffs.join(', ') : null;
  }, (id, val) => {
    // New cargo: clean if DLC is known, needs_input otherwise
    const hasDlc = val.dlc || CARGO_DLC_MAP[id] || MAP_DLC_CARGO[id];
    return hasDlc ? 'clean' : 'needs_input';
  });

  // --- Trailer diff ---
  diffSection(changes, 'trailers', existing.trailers || {}, newData.trailers, (id, oldVal, newVal) => {
    const diffs: string[] = [];
    if (oldVal.volume !== newVal.volume) diffs.push(`volume: ${oldVal.volume} → ${newVal.volume}`);
    if (oldVal.body_type !== newVal.body_type) diffs.push(`body_type: ${oldVal.body_type} → ${newVal.body_type}`);
    if (oldVal.gross_weight_limit !== newVal.gross_weight_limit)
      diffs.push(`gross_weight_limit: ${oldVal.gross_weight_limit} → ${newVal.gross_weight_limit}`);
    if (JSON.stringify(oldVal.country_validity) !== JSON.stringify(newVal.country_validity))
      diffs.push(`country_validity changed`);
    return diffs.length > 0 ? diffs.join(', ') : null;
  }, (id) => {
    // New trailer: clean if brand is known, needs_input for new brands
    const brand = id.split('.')[0];
    return TRAILER_DLCS[brand] ? 'clean' : 'needs_input';
  });

  // --- Company diff ---
  diffSection(changes, 'companies', existing.companies || {}, newData.companies, (id, oldVal, newVal) => {
    const diffs: string[] = [];
    const oldOut = (oldVal.cargo_out || []).sort();
    const newOut = (newVal.cargo_out || []).sort();
    if (JSON.stringify(oldOut) !== JSON.stringify(newOut)) {
      const added = newOut.filter((c: string) => !oldOut.includes(c));
      const removed = oldOut.filter((c: string) => !newOut.includes(c));
      if (added.length) diffs.push(`+cargo_out: ${added.join(', ')}`);
      if (removed.length) diffs.push(`-cargo_out: ${removed.join(', ')}`);
    }
    const oldCities = (oldVal.cities || []).sort();
    const newCities = (newVal.cities || []).sort();
    if (JSON.stringify(oldCities) !== JSON.stringify(newCities)) {
      const added = newCities.filter((c: string) => !oldCities.includes(c));
      const removed = oldCities.filter((c: string) => !newCities.includes(c));
      if (added.length) diffs.push(`+cities: ${added.join(', ')}`);
      if (removed.length) diffs.push(`-cities: ${removed.join(', ')}`);
    }
    return diffs.length > 0 ? diffs.join('; ') : null;
  });

  // --- City diff ---
  diffSection(changes, 'cities', existing.cities || {}, newData.cities, (id, oldVal, newVal) => {
    const diffs: string[] = [];
    if (oldVal.name !== newVal.name) diffs.push(`name: "${oldVal.name}" → "${newVal.name}"`);
    if (oldVal.country !== newVal.country) diffs.push(`country: ${oldVal.country} → ${newVal.country}`);
    return diffs.length > 0 ? diffs.join(', ') : null;
  }, (id, val) => {
    // New city: always needs_input — confirm DLC mapping and garage status
    if (!GARAGE_CITIES.has(id)) {
      return 'needs_input'; // garage status unknown
    }
    const hasDlcMapping = Object.values(newData.dlc.city_dlc_map).some(cs => cs.includes(id));
    return hasDlcMapping ? 'clean' : 'needs_input';
  });

  // --- Country diff ---
  diffSection(changes, 'countries', existing.countries || {}, newData.countries, (id, oldVal, newVal) => {
    if (oldVal.name !== newVal.name) return `name: "${oldVal.name}" → "${newVal.name}"`;
    return null;
  }, () => 'needs_input'); // New countries always need input

  // --- Economy diff ---
  const econChanges: string[] = [];
  const oldEcon = existing.economy || {};
  const newEcon = newData.economy;
  for (const key of Object.keys(newEcon) as (keyof EconomyData)[]) {
    const oldV = JSON.stringify(oldEcon[key]);
    const newV = JSON.stringify(newEcon[key]);
    if (oldV !== newV) econChanges.push(`${key}: ${oldV} → ${newV}`);
  }
  if (econChanges.length > 0) {
    changes.push({ category: 'clean', section: 'economy', type: 'changed', id: 'economy', detail: econChanges.join(', ') });
  }

  // --- Print results ---
  const clean = changes.filter(c => c.category === 'clean');
  const needsInput = changes.filter(c => c.category === 'needs_input');
  const removed = changes.filter(c => c.type === 'removed');

  if (changes.length === 0) {
    console.log('No differences found. Game defs are up to date.');
    return;
  }

  console.log(`Found ${changes.length} changes:\n`);

  if (clean.length > 0) {
    console.log(`--- CLEAN (${clean.length}) — safe to auto-apply ---`);
    for (const c of clean) {
      const icon = c.type === 'added' ? '+' : c.type === 'removed' ? '-' : '~';
      console.log(`  ${icon} [${c.section}] ${c.id}: ${c.detail}`);
    }
    console.log('');
  }

  if (needsInput.length > 0) {
    console.log(`--- NEEDS INPUT (${needsInput.length}) — requires user decision ---`);
    for (const c of needsInput) {
      const icon = c.type === 'added' ? '+' : c.type === 'removed' ? '-' : '~';
      console.log(`  ${icon} [${c.section}] ${c.id}: ${c.detail}`);
    }
    console.log('');
  }

  if (removed.length > 0) {
    console.log(`--- REMOVED (${removed.length}) — content no longer in defs ---`);
    for (const c of removed) {
      console.log(`  - [${c.section}] ${c.id}: ${c.detail}`);
    }
    console.log('');
  }

  if (needsInput.length === 0 && removed.length === 0) {
    console.log('All changes are clean. Re-run without --diff to apply.');
  } else {
    console.log('Review the above. Resolve needs-input items, then re-run without --diff to apply.');
  }
}

/**
 * Generic diff helper for keyed object sections.
 * Calls `compareFn` for each shared key (return null if unchanged, string detail if changed).
 * Calls `classifyNewFn` for added keys (return 'clean' or 'needs_input').
 * Removals are always classified as 'needs_input'.
 */
function diffSection(
  changes: DiffChange[],
  section: string,
  oldObj: Record<string, any>,
  newObj: Record<string, any>,
  compareFn: (id: string, oldVal: any, newVal: any) => string | null,
  classifyNewFn: (id: string, newVal: any) => 'clean' | 'needs_input' = () => 'clean',
): void {
  const oldKeys = new Set(Object.keys(oldObj));
  const newKeys = new Set(Object.keys(newObj));

  // Added
  for (const id of newKeys) {
    if (!oldKeys.has(id)) {
      const category = classifyNewFn(id, newObj[id]);
      const name = newObj[id]?.name ? ` (${newObj[id].name})` : '';
      changes.push({ category, section, type: 'added', id, detail: `new${name}` });
    }
  }

  // Removed
  for (const id of oldKeys) {
    if (!newKeys.has(id)) {
      const name = oldObj[id]?.name ? ` (${oldObj[id].name})` : '';
      changes.push({ category: 'needs_input', section, type: 'removed', id, detail: `removed${name}` });
    }
  }

  // Changed
  for (const id of newKeys) {
    if (!oldKeys.has(id)) continue;
    const detail = compareFn(id, oldObj[id], newObj[id]);
    if (detail) {
      changes.push({ category: 'clean', section, type: 'changed', id, detail });
    }
  }
}

if (!process.env.VITEST) main();
