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

// Trailer variant → body type mapping.
// Variants are the short IDs from save files (trailer_variant field).
// Body types are what the player actually buys.
// Suffixes like _a, _s, _m are brand/size subvariants of the same body type.
const VARIANT_BODY_TYPE = {
  scs_curt:     'curtainside',
  scs_curt_a:   'curtainside',
  scs_curt_s:   'curtainside',
  scs_dry:      'dryvan',
  scs_dry_a:    'dryvan',
  scs_dry_m:    'dryvan',
  scs_dry_ms:   'dryvan',
  scs_dry_s:    'dryvan',
  scs_ref:      'refrigerated',
  scs_ref_a:    'refrigerated',
  scs_ref_s:    'refrigerated',
  scs_ins:      'insulated',
  scs_ins_a:    'insulated',
  scs_ins_s:    'insulated',
  scs_flat_b:   'flatbed',
  scs_lowbed_3: 'lowbed',
  scs_lowbed_4: 'lowbed',
  scs_lowbed41: 'lowbed',
  scs_lowlow2e: 'lowboy',
  scs_lowlow4e: 'lowboy',
  scs_lowlowd2: 'lowboy',
  scs_lowlowd4: 'lowboy',
  scs_gosck20:  'container',
  scs_gosck220: 'container',
  scs_gosck40:  'container',
  scs_dumper:   'dumper',
  scs_silo:     'silo',
  scs_log:      'log',
  scs_gastank:  'gastank',
  scs_chemt:    'chemtank',
  scs_fodt:     'foodtank',
  scs_brick_r:  'brick',
  scs_livestk:  'livestock',
  car_trans:    'car_transporter',
  truck_trans:  'truck_transporter',
  van_trans:    'van_transporter',
  gls_trailer:  'glass',
};

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

  const jobRe = /job_offer_data : (_nameless\.\S+) \{\n target: "(\w+)\.(\w+)"\n expiration_time: (\d+)\n urgency: (\d+)\n shortest_distance_km: (\d+)\n ferry_time: (\d+)\n ferry_price: (\d+)\n cargo: cargo\.(\w+)\n company_truck: (\w*)\n trailer_variant: trailer\.(\w+)\n trailer_definition: (\S+)\n units_count: (\d+)\n fill_ratio: (\d+)\n trailer_place: (\d+)\n\}/g;

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

function inc(obj, ...keys) {
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]]) cur[keys[i]] = i === keys.length - 2 ? 0 : {};
    cur = cur[keys[i]];
  }
  // This is for the "leaf increment" pattern — but we need a different approach
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
  if (!gameDefs) console.warn('  WARNING: game-defs.json not found, cargo values will be 1.0');

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
        const bodyType = VARIANT_BODY_TYPE[variant];

        if (!bodyType) unknownVariants.add(variant);

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

          const value = getCargoValue(gameDefs, gid);
          if (!bodyTypeValueAcc[bodyType]) bodyTypeValueAcc[bodyType] = { totalValue: 0, count: 0 };
          bodyTypeValueAcc[bodyType].totalValue += value;
          bodyTypeValueAcc[bodyType].count += 1;
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
    console.warn(`\n  WARNING: Unknown trailer variants (add to VARIANT_BODY_TYPE):`);
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

  // Entity lists
  const allCities = Object.keys(cityCompaniesAgg).sort();
  const allCompanies = [...new Set(Object.values(cityCompaniesAgg).flatMap(c => Object.keys(c)))].sort();
  const allCargo = Object.keys(cargoFreq).sort();
  const allTrailers = [...new Set(Object.values(cargoTrailerUnits).flatMap(t => Object.keys(t)))].sort();

  const output = {
    meta,
    variant_body_type: VARIANT_BODY_TYPE,
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
  console.log(`  Body types: ${new Set(Object.values(VARIANT_BODY_TYPE)).size}`);

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
