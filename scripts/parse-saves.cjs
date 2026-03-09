#!/usr/bin/env node
/**
 * Parse ETS2 save files to extract job market observations.
 *
 * Usage: npm run parse-saves
 *
 * Reads .sii files from saves/, decrypts them, extracts job_offer_data,
 * and writes observations into public/data/observations.json.
 *
 * Rolling window: keeps the last 20 saves. Older saves are dropped from
 * the dataset when new ones arrive. This lets the data naturally adapt
 * to game updates without manual intervention.
 *
 * Game IDs are primary keys throughout — no mapping to DB IDs.
 * Display names are resolved separately via game-defs.json.
 */

const { SIIDecryptor } = require('@trucky/sii-decrypt-ts');
const fs = require('fs');
const path = require('path');

const SAVES_DIR = path.join(__dirname, '..', 'saves');
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const OBS_PATH = path.join(DATA_DIR, 'observations.json');
const MAX_SAVES = 20;

// chain_type (from game-defs trailers) → zone tier name.
// Standard trailers are global, doubles/b-doubles share a zone, HCT is separate.
const CHAIN_TYPE_ZONE = {
  single:   'standard',
  double:   'doubles',
  b_double: 'doubles',
  hct:      'hct',
};

/**
 * Build variant → { body_type, zone } lookup dynamically from game-defs.
 * Each job in a save has both trailer_variant (short ID) and trailer_definition
 * (full path like "trailer_def.scs.box.single_3.curtain"). The trailer_definition
 * maps to game-defs trailer IDs, which have body_type and chain_type.
 * This eliminates hardcoded variant maps — new DLC trailers just work.
 */
function buildVariantLookup(gameDefs) {
  // Populated per-save from trailer_variant → trailer_definition pairs.
  // Returns { resolve(variant, trailerDef), cache } where cache is the Map.
  const cache = new Map();

  function resolve(variant, trailerDef) {
    if (cache.has(variant)) return cache.get(variant);

    if (gameDefs && trailerDef) {
      const defId = trailerDef.replace('trailer_def.', '');
      const trailer = gameDefs.trailers[defId];
      if (trailer) {
        const result = {
          bodyType: trailer.body_type,
          zone: CHAIN_TYPE_ZONE[trailer.chain_type] || 'standard',
        };
        cache.set(variant, result);
        return result;
      }
    }

    // No match in game-defs (vehicle transports, unknown DLC trailers)
    cache.set(variant, null);
    return null;
  }

  return { resolve, cache };
}

function decryptSave(filePath) {
  const result = SIIDecryptor.decrypt(filePath);
  if (!result.success || !result.string_content) {
    throw new Error(`Failed to decrypt ${filePath}`);
  }
  return result.string_content;
}

function parseJobs(text) {
  const jobToSource = new Map();
  const companyRe = /company : company\.volatile\.(\w+)\.(\w+) \{([\s\S]*?)(?=\ncompany :|job_offer_data :|$)/g;
  let m;
  while ((m = companyRe.exec(text)) !== null) {
    const [, companyName, cityName, block] = m;
    const refs = [...block.matchAll(/job_offer\[\d+\]: (_nameless\.\S+)/g)];
    for (const ref of refs) {
      jobToSource.set(ref[1], { city: cityName, company: companyName });
    }
  }

  const jobRe = /job_offer_data : (_nameless\.\S+) \{\n target: "(\w+)\.(\w+)"\n expiration_time: (\d+)\n urgency: (\d+)\n shortest_distance_km: (\d+)\n ferry_time: (\d+)\n ferry_price: (\d+)\n cargo: cargo\.(\w+)\n company_truck: "?([^"\n]*)"?\n trailer_variant: trailer\.(\w+)\n trailer_definition: (\S+)\n units_count: (\d+)\n fill_ratio: (\d+)\n trailer_place: (\d+)\n\}/g;

  const jobs = [];
  while ((m = jobRe.exec(text)) !== null) {
    const source = jobToSource.get(m[1]) || { city: 'unknown', company: 'unknown' };
    jobs.push({
      source_city: source.city,
      source_company: source.company,
      target_city: m[3],
      target_company: m[2],
      cargo_game_id: m[9],
      trailer_variant: m[11],
      trailer_def: m[12],
      units_count: parseInt(m[13]),
      fill_ratio: parseInt(m[14]),
      distance_km: parseInt(m[6]),
      urgency: parseInt(m[5]),
    });
  }

  return jobs;
}

function parseCityCompanies(text) {
  const cityCompanies = {};
  const companyRe = /company : company\.volatile\.(\w+)\.(\w+) \{/g;
  let cm;
  while ((cm = companyRe.exec(text)) !== null) {
    const [, company, city] = cm;
    if (!cityCompanies[city]) cityCompanies[city] = {};
    if (!cityCompanies[city][company]) cityCompanies[city][company] = 0;
    cityCompanies[city][company]++;
  }
  return cityCompanies;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function loadGameDefs() {
  const defsPath = path.join(DATA_DIR, 'game-defs.json');
  if (!fs.existsSync(defsPath)) return null;
  return JSON.parse(fs.readFileSync(defsPath, 'utf-8'));
}

function getCargoValue(gameDefs, cargoId) {
  if (!gameDefs) return 1.0;
  const cargo = gameDefs.cargo[cargoId];
  if (!cargo) return 1.0;
  const multiplier = 1 + (cargo.fragile ? 0.3 : 0) + (cargo.high_value ? 0.3 : 0);
  return cargo.value * multiplier;
}

function main() {
  if (!fs.existsSync(SAVES_DIR)) {
    console.error('No saves/ directory found. Place .sii files there first.');
    process.exit(1);
  }

  const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.sii')).sort();
  if (files.length === 0) {
    console.error('No .sii files found in saves/');
    process.exit(1);
  }

  // Load existing meta for dedup
  let existingMeta = { saves_parsed: 0, save_files: [], total_jobs: 0 };
  if (fs.existsSync(OBS_PATH)) {
    const existing = JSON.parse(fs.readFileSync(OBS_PATH, 'utf-8'));
    existingMeta = existing.meta || existingMeta;
  }

  // Determine which files to parse: skip already-parsed, enforce rolling window
  const newFiles = files.filter(f => !existingMeta.save_files.includes(f));
  if (newFiles.length === 0) {
    console.log('No new save files to process.');
    return;
  }

  // All files to include: existing + new, capped at MAX_SAVES (keep newest)
  const allSaveFiles = [...existingMeta.save_files, ...newFiles];
  const filesToKeep = allSaveFiles.slice(-MAX_SAVES);
  const filesToParse = filesToKeep; // Re-parse all kept files for clean aggregation
  const droppedFiles = allSaveFiles.slice(0, Math.max(0, allSaveFiles.length - MAX_SAVES));

  if (droppedFiles.length > 0) {
    console.log(`Rolling window: dropping ${droppedFiles.length} oldest save(s)`);
  }

  const gameDefs = loadGameDefs();
  if (!gameDefs) console.warn('  WARNING: game-defs.json not found, cargo values will be 1.0 and trailer types unresolved');

  const variantLookup = buildVariantLookup(gameDefs);
  const resolveVariant = variantLookup.resolve;

  console.log(`Parsing ${filesToParse.length} save file(s) (window: last ${MAX_SAVES})`);

  // Accumulators — all keyed by game IDs
  const unitsSamples = {};         // cargoId -> trailer -> [units]
  const compFreq = {};             // company -> cargoId -> count
  const cargoFreq = {};            // cargoId -> count
  const cityCompaniesAgg = {};     // city -> company -> depot count
  const cityCargoFreq = {};        // city -> cargoId -> count
  const cityJobCount = {};         // city -> total job count
  const cityTrailerFreq = {};      // city -> trailer_variant -> count
  const cityBodyTypeFreq = {};     // city -> bodyType -> count
  const bodyTypeValueAcc = {};     // bodyType -> { totalValue, count }
  const cityZoneBodyTypeFreq = {}; // city -> zone -> bodyType -> count
  const zoneBodyTypeValueAcc = {}; // zone -> bodyType -> { totalValue, count }
  const compBodyTypeFreq = {};     // company -> bodyType -> count
  const compZoneBodyTypeFreq = {}; // company -> zone -> bodyType -> count
  const compJobCount = {};         // company -> total job count
  const compBodyTypeValueAcc = {}; // company -> bodyType -> { totalValue, count }
  const unknownVariants = new Set();
  let totalJobs = 0;

  for (const file of filesToParse) {
    const filePath = path.join(SAVES_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  Skipping ${file} (file removed from saves/)`);
      continue;
    }

    console.log(`\n  Processing: ${file}`);

    try {
      const text = decryptSave(filePath);
      console.log(`    Decrypted: ${(text.length / 1e6).toFixed(1)}MB`);

      const jobs = parseJobs(text);
      console.log(`    Found ${jobs.length} jobs`);

      // City-company volatile blocks
      const fileCityCompanies = parseCityCompanies(text);
      for (const [city, companies] of Object.entries(fileCityCompanies)) {
        if (!cityCompaniesAgg[city]) cityCompaniesAgg[city] = {};
        for (const [comp, count] of Object.entries(companies)) {
          // Take max depot count across saves (structure doesn't change between saves)
          cityCompaniesAgg[city][comp] = Math.max(cityCompaniesAgg[city][comp] || 0, count);
        }
      }

      for (const job of jobs) {
        const gid = job.cargo_game_id;
        const city = job.source_city;
        const variant = job.trailer_variant;
        const resolved = resolveVariant(variant, job.trailer_def);
        const bodyType = resolved?.bodyType ?? null;
        const zone = resolved?.zone ?? 'standard';

        if (!resolved) unknownVariants.add(variant);

        // Units per cargo + trailer pair
        if (!unitsSamples[gid]) unitsSamples[gid] = {};
        if (!unitsSamples[gid][variant]) unitsSamples[gid][variant] = [];
        unitsSamples[gid][variant].push(job.units_count);

        // Company -> cargo frequency
        if (!compFreq[job.source_company]) compFreq[job.source_company] = {};
        compFreq[job.source_company][gid] = (compFreq[job.source_company][gid] || 0) + 1;

        // Global cargo frequency
        cargoFreq[gid] = (cargoFreq[gid] || 0) + 1;

        // Per-city cargo frequency
        if (!cityCargoFreq[city]) cityCargoFreq[city] = {};
        cityCargoFreq[city][gid] = (cityCargoFreq[city][gid] || 0) + 1;

        // Per-city job count
        cityJobCount[city] = (cityJobCount[city] || 0) + 1;

        // Per-city trailer variant frequency
        if (!cityTrailerFreq[city]) cityTrailerFreq[city] = {};
        cityTrailerFreq[city][variant] = (cityTrailerFreq[city][variant] || 0) + 1;

        // Per-city body type frequency + value accumulation
        if (bodyType) {
          if (!cityBodyTypeFreq[city]) cityBodyTypeFreq[city] = {};
          cityBodyTypeFreq[city][bodyType] = (cityBodyTypeFreq[city][bodyType] || 0) + 1;

          const valuePerUnit = getCargoValue(gameDefs, gid);
          const jobValue = valuePerUnit * (job.units_count || 1);
          if (!bodyTypeValueAcc[bodyType]) bodyTypeValueAcc[bodyType] = { totalValue: 0, count: 0 };
          bodyTypeValueAcc[bodyType].totalValue += jobValue;
          bodyTypeValueAcc[bodyType].count += 1;

          // Zone-aware tracking
          if (!cityZoneBodyTypeFreq[city]) cityZoneBodyTypeFreq[city] = {};
          if (!cityZoneBodyTypeFreq[city][zone]) cityZoneBodyTypeFreq[city][zone] = {};
          cityZoneBodyTypeFreq[city][zone][bodyType] = (cityZoneBodyTypeFreq[city][zone][bodyType] || 0) + 1;

          if (!zoneBodyTypeValueAcc[zone]) zoneBodyTypeValueAcc[zone] = {};
          if (!zoneBodyTypeValueAcc[zone][bodyType]) zoneBodyTypeValueAcc[zone][bodyType] = { totalValue: 0, count: 0 };
          zoneBodyTypeValueAcc[zone][bodyType].totalValue += jobValue;
          zoneBodyTypeValueAcc[zone][bodyType].count += 1;

          // Per-company body type frequency + zone + value
          const comp = job.source_company;
          compJobCount[comp] = (compJobCount[comp] || 0) + 1;
          if (!compBodyTypeFreq[comp]) compBodyTypeFreq[comp] = {};
          compBodyTypeFreq[comp][bodyType] = (compBodyTypeFreq[comp][bodyType] || 0) + 1;

          if (!compZoneBodyTypeFreq[comp]) compZoneBodyTypeFreq[comp] = {};
          if (!compZoneBodyTypeFreq[comp][zone]) compZoneBodyTypeFreq[comp][zone] = {};
          compZoneBodyTypeFreq[comp][zone][bodyType] = (compZoneBodyTypeFreq[comp][zone][bodyType] || 0) + 1;

          if (!compBodyTypeValueAcc[comp]) compBodyTypeValueAcc[comp] = {};
          if (!compBodyTypeValueAcc[comp][bodyType]) compBodyTypeValueAcc[comp][bodyType] = { totalValue: 0, count: 0 };
          compBodyTypeValueAcc[comp][bodyType].totalValue += jobValue;
          compBodyTypeValueAcc[comp][bodyType].count += 1;
        }
      }

      totalJobs += jobs.length;
    } catch (err) {
      console.error(`    ERROR: ${err.message}`);
    }
  }

  if (totalJobs === 0) {
    console.log('\nNo jobs found in any save files.');
    return;
  }

  if (unknownVariants.size > 0) {
    console.warn(`\n  WARNING: Unknown trailer variants (not in game-defs.json):`);
    for (const v of [...unknownVariants].sort()) console.warn(`    ${v}`);
  }

  const meta = {
    saves_parsed: filesToParse.length,
    save_files: filesToParse,
    total_jobs: totalJobs,
    max_saves: MAX_SAVES,
    last_updated: new Date().toISOString(),
  };

  // Build cargo_trailer_units: cargoId -> trailer -> { median, count }
  const cargoTrailerUnits = {};
  for (const [gid, trailers] of Object.entries(unitsSamples)) {
    cargoTrailerUnits[gid] = {};
    for (const [trailer, samples] of Object.entries(trailers)) {
      cargoTrailerUnits[gid][trailer] = {
        median: median(samples),
        count: samples.length,
      };
    }
  }

  // Spawn weight: per cargo ID, relative to most common = 1.0
  const maxFreq = Math.max(...Object.values(cargoFreq));
  const spawnWeight = {};
  for (const [gid, count] of Object.entries(cargoFreq)) {
    spawnWeight[gid] = Math.round((count / maxFreq) * 1000) / 1000;
  }

  // Derived relational data
  const cargoTrailers = {};
  for (const [cargoId, trailers] of Object.entries(cargoTrailerUnits)) {
    cargoTrailers[cargoId] = Object.keys(trailers);
  }

  const companyCargo = {};
  for (const [company, cargoes] of Object.entries(compFreq)) {
    companyCargo[company] = Object.keys(cargoes);
  }

  // Body type average values (global across all observed jobs)
  const bodyTypeAvgValue = {};
  for (const [bt, acc] of Object.entries(bodyTypeValueAcc)) {
    bodyTypeAvgValue[bt] = Math.round(acc.totalValue / acc.count * 100) / 100;
  }

  // Zone-aware body type average values
  const zoneBodyTypeAvgValue = {};
  for (const [zone, bodyTypes] of Object.entries(zoneBodyTypeValueAcc)) {
    zoneBodyTypeAvgValue[zone] = {};
    for (const [bt, acc] of Object.entries(bodyTypes)) {
      zoneBodyTypeAvgValue[zone][bt] = Math.round(acc.totalValue / acc.count * 100) / 100;
    }
  }

  // Per-company body type average values
  const compBodyTypeAvgValue = {};
  for (const [comp, bodyTypes] of Object.entries(compBodyTypeValueAcc)) {
    compBodyTypeAvgValue[comp] = {};
    for (const [bt, acc] of Object.entries(bodyTypes)) {
      compBodyTypeAvgValue[comp][bt] = Math.round(acc.totalValue / acc.count * 100) / 100;
    }
  }

  // Entity lists
  const allCities = Object.keys(cityCompaniesAgg).sort();
  const allCompanies = [...new Set(Object.values(cityCompaniesAgg).flatMap(c => Object.keys(c)))].sort();
  const allCargo = Object.keys(cargoFreq).sort();
  const allTrailers = [...new Set(Object.values(cargoTrailerUnits).flatMap(t => Object.keys(t)))].sort();

  // Build variant_body_type from resolved cache for observations output
  const variantBodyType = {};
  for (const [variant, info] of variantLookup.cache) {
    if (info) variantBodyType[variant] = info.bodyType;
  }

  const output = {
    meta,
    variant_body_type: variantBodyType,
    cities: allCities,
    companies: allCompanies,
    cargo: allCargo,
    trailers: allTrailers,
    city_companies: cityCompaniesAgg,
    company_cargo: companyCargo,
    cargo_trailers: cargoTrailers,
    cargo_frequency: cargoFreq,
    cargo_spawn_weight: spawnWeight,
    cargo_trailer_units: cargoTrailerUnits,
    company_cargo_frequency: compFreq,
    city_job_count: cityJobCount,
    city_cargo_frequency: cityCargoFreq,
    city_trailer_frequency: cityTrailerFreq,
    city_body_type_frequency: cityBodyTypeFreq,
    body_type_avg_value: bodyTypeAvgValue,
    city_zone_body_type_frequency: cityZoneBodyTypeFreq,
    zone_body_type_avg_value: zoneBodyTypeAvgValue,
    company_body_type_frequency: compBodyTypeFreq,
    company_zone_body_type_frequency: compZoneBodyTypeFreq,
    company_job_count: compJobCount,
    company_body_type_avg_value: compBodyTypeAvgValue,
  };

  fs.writeFileSync(OBS_PATH, JSON.stringify(output, null, 2) + '\n');

  // Summary
  console.log(`\nObservations written to ${OBS_PATH}`);
  console.log(`  Saves in window: ${meta.saves_parsed}/${MAX_SAVES}`);
  console.log(`  Total jobs: ${totalJobs}`);
  console.log(`  Cities: ${allCities.length}`);
  console.log(`  Companies: ${allCompanies.length}`);
  console.log(`  Cargo types: ${allCargo.length}`);
  console.log(`  Trailer variants: ${allTrailers.length}`);
  console.log(`  Body types: ${new Set(Object.values(variantBodyType)).size}`);

  // Per-city job distribution
  const jobCounts = Object.values(cityJobCount).sort((a, b) => b - a);
  console.log(`\n  Per-city jobs: max=${jobCounts[0]}, median=${median(jobCounts)}, min=${jobCounts[jobCounts.length - 1]}`);
  console.log(`  Top 10 cities:`);
  const topCities = Object.entries(cityJobCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [city, count] of topCities) {
    const bodyTypes = Object.keys(cityBodyTypeFreq[city] || {}).length;
    console.log(`    ${city}: ${count} jobs, ${bodyTypes} body types`);
  }
}

main();
