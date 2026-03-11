// ETS2 Game Definition Parser
// Parses extracted SII/SUI files from ETS2 game archives and generates
// JSON data files for the Trucker Advisor frontend.
// Usage: npx tsx scripts/parse-game-defs.ts <path-to-extracted-def-folder>

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';

const defsPath = process.argv[2];
if (!defsPath || !existsSync(defsPath)) {
  console.error('Usage: npx tsx scripts/parse-game-defs.ts <path-to-def-folder>');
  console.error('Example: npx tsx scripts/parse-game-defs.ts /tmp/ets2-defs/def');
  process.exit(1);
}

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
const CARGO_DLC_MAP: Record<string, string> = {
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
      country: String(unit.props.country || 'unknown'),
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

  // Output directory
  const outputDir = join(dirname(defsPath), 'parsed');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write JSON files
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

  // Generate frontend-compatible game-defs.json for public/data/
  console.log('\nGenerating frontend data file...');
  const frontendData = {
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
    }])),
    countries: Object.fromEntries(countries.map(c => [c.id, { name: c.name }])),
    // Cargo-trailer units: compact format { cargoId: { trailerId: units } }
    cargo_trailer_units: (() => {
      const result: Record<string, Record<string, number>> = {};
      for (const m of matches) {
        if (!result[m.cargo_id]) result[m.cargo_id] = {};
        result[m.cargo_id][m.trailer_id] = m.units;
      }
      return result;
    })(),
    // Company-cargo mapping (out only — what companies ship)
    company_cargo: Object.fromEntries(companies.map(co => [co.id, co.cargo_out])),
    // Cargo-trailer compatibility (compact: cargo_id → trailer_ids)
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
    // City-company map: { cityId: { companyId: count } }
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
      id: t.id,
      brand: t.brand,
      model: t.model,
      engines: t.engines,
      transmissions: t.transmissions,
      chassis: t.chassis,
    })),
  };

  const frontendPath = join(process.cwd(), 'public', 'data', 'game-defs.json');
  writeFileSync(frontendPath, JSON.stringify(frontendData));
  const sizeMB = (Buffer.byteLength(JSON.stringify(frontendData)) / 1024 / 1024).toFixed(1);
  console.log(`  Wrote ${frontendPath} (${sizeMB}MB)`);

  // Summary stats
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

  // Answer some questions from game-data-questions.md
  console.log('\n=== Game Data Answers ===');
  console.log('Q1: group[] tokens:', [...new Set(cargo.flatMap(c => c.groups))].sort().join(', '));
  console.log('Q2: "fragile" is NOT in group[]. Fragile = fragility >= 0.5 threshold.');
  console.log('Q3: valuable:true = High Value Cargo skill. Count:', cargo.filter(c => c.high_value).length);
  console.log('Q4: body_types across cargo:', [...new Set(cargo.flatMap(c => c.body_types))].sort().join(', '));
  console.log('Q5: ADR classes used:', [...new Set(cargo.filter(c => c.adr_class > 0).map(c => c.adr_class))].sort().join(', '));
  console.log('Q6: prob_coef range:', Math.min(...cargo.map(c => c.prob_coef)), '-', Math.max(...cargo.map(c => c.prob_coef)));
  console.log('Q7: Cargo with min_distance:', cargo.filter(c => c.min_distance > 0).length);
  console.log('Q7: Cargo with max_distance:', cargo.filter(c => c.max_distance > 0).length);
  console.log('Q10: trailer body_types:', [...new Set(trailers.map(t => t.body_type))].sort().join(', '));
  console.log('Q12: Trailer lengths:', [...new Set(trailers.map(t => t.length))].sort((a, b) => a - b).join(', '));
  console.log('Q13: Chain types:', [...new Set(trailers.map(t => t.chain_type))].sort().join(', '));
}

main();
