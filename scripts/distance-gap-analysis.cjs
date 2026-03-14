const gd = require('../public/data/game-defs.json');

// ── 1. Map cities by country ──
const cities = Object.entries(gd.cities);
const byCountry = {};
for (const [id, c] of cities) {
  const cc = c.country || 'unknown';
  if (!byCountry[cc]) byCountry[cc] = [];
  byCountry[cc].push(id);
}

console.log('=== CITIES BY COUNTRY ===');
const countryCounts = Object.entries(byCountry).sort((a, b) => b[1].length - a[1].length);
for (const [cc, list] of countryCounts) {
  console.log('  ' + cc.padEnd(20) + list.length + ' cities');
}
console.log('Total:', cities.length, 'cities in', Object.keys(byCountry).length, 'countries');

// ── 2. Define trailer tier zones ──
const HCT_COUNTRIES = new Set(['finland', 'sweden']);
const DOUBLE_COUNTRIES = new Set(['denmark', 'finland', 'germany', 'netherlands', 'norway', 'portugal', 'spain', 'sweden']);
// Standard = all countries

// Count reachable cities per tier from each country
console.log('\n=== REACHABLE CITIES BY TRAILER TIER (per origin country) ===');
console.log('Country'.padEnd(20) + 'Standard'.padStart(10) + 'Double'.padStart(10) + 'HCT'.padStart(10) +
  '  Dbl/Std%'.padStart(10) + '  HCT/Std%'.padStart(10));
console.log('-'.repeat(70));

const allCityCount = cities.length;
const doubleCityCount = cities.filter(([, c]) => DOUBLE_COUNTRIES.has(c.country)).length;
const hctCityCount = cities.filter(([, c]) => HCT_COUNTRIES.has(c.country)).length;

for (const [cc] of countryCounts) {
  const std = allCityCount;
  const dbl = doubleCityCount;
  const hct = hctCityCount;

  console.log(
    cc.padEnd(20) +
    String(std).padStart(10) +
    String(dbl).padStart(10) +
    String(hct).padStart(10) +
    (dbl / std * 100).toFixed(1).padStart(10) + '%' +
    (hct / std * 100).toFixed(1).padStart(10) + '%'
  );
}

// ── 3. Approximate distances using real-world city coordinates ──
// Since game-defs doesn't have coordinates, use approximate real-world coords
// for major ETS2 cities to estimate average distances
const COORDS = {
  // Nordic
  helsinki: { lat: 60.17, lon: 24.94 },
  stockholm: { lat: 59.33, lon: 18.07 },
  tampere: { lat: 61.50, lon: 23.79 },
  turku: { lat: 60.45, lon: 22.27 },
  goteborg: { lat: 57.71, lon: 11.97 },
  oslo: { lat: 59.91, lon: 10.75 },
  bergen: { lat: 60.39, lon: 5.32 },
  kobenhavn: { lat: 55.68, lon: 12.57 },
  malmo: { lat: 55.60, lon: 13.00 },
  // Germany
  hamburg: { lat: 53.55, lon: 9.99 },
  berlin: { lat: 52.52, lon: 13.41 },
  munchen: { lat: 48.14, lon: 11.58 },
  frankfurt: { lat: 50.11, lon: 8.68 },
  koln: { lat: 50.94, lon: 6.96 },
  // Western
  amsterdam: { lat: 52.37, lon: 4.90 },
  paris: { lat: 48.86, lon: 2.35 },
  london: { lat: 51.51, lon: -0.13 },
  brussel: { lat: 50.85, lon: 4.35 },
  lisboa: { lat: 38.72, lon: -9.14 },
  madrid: { lat: 40.42, lon: -3.70 },
  barcelona: { lat: 41.39, lon: 2.17 },
  // Southern
  roma: { lat: 41.90, lon: 12.50 },
  milano: { lat: 45.46, lon: 9.19 },
  // Eastern
  warszawa: { lat: 52.23, lon: 21.01 },
  budapest: { lat: 47.50, lon: 19.04 },
  bucuresti: { lat: 44.43, lon: 26.10 },
  istanbul: { lat: 41.01, lon: 28.98 },
  wien: { lat: 48.21, lon: 16.37 },
  praha: { lat: 50.08, lon: 14.44 },
  sofia: { lat: 42.70, lon: 23.32 },
  athens: { lat: 37.98, lon: 23.73 },
  beograd: { lat: 44.79, lon: 20.47 },
  zagreb: { lat: 45.81, lon: 15.98 },
};

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const sin2 = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(sin2), Math.sqrt(1 - sin2));
}

// Road distance ≈ 1.3 × haversine (rough European road factor)
const ROAD_FACTOR = 1.3;

// Map our coordinate cities to countries for tier filtering
const CITY_COUNTRY = {};
for (const [id, c] of cities) {
  CITY_COUNTRY[id] = c.country;
}

// ── 4. For key origin cities, compute average distance to destinations by tier ──
const ORIGINS = ['helsinki', 'stockholm', 'tampere', 'turku', 'goteborg', 'hamburg', 'amsterdam', 'istanbul', 'barcelona', 'lisboa'];

// Use ALL game cities with approximate coords (assign coords based on country centroids for cities we don't have exact coords for)
const COUNTRY_CENTROIDS = {
  finland: { lat: 62, lon: 26 },
  sweden: { lat: 59, lon: 16 },
  norway: { lat: 60, lon: 10 },
  denmark: { lat: 56, lon: 10 },
  germany: { lat: 51, lon: 10 },
  netherlands: { lat: 52, lon: 5 },
  france: { lat: 47, lon: 2 },
  uk: { lat: 53, lon: -1 },
  spain: { lat: 40, lon: -4 },
  portugal: { lat: 39, lon: -8 },
  italy: { lat: 42, lon: 12 },
  poland: { lat: 52, lon: 20 },
  czech: { lat: 50, lon: 15 },
  austria: { lat: 47, lon: 14 },
  switzerland: { lat: 47, lon: 8 },
  hungary: { lat: 47, lon: 19 },
  romania: { lat: 45, lon: 25 },
  bulgaria: { lat: 43, lon: 25 },
  turkey: { lat: 41, lon: 29 },
  greece: { lat: 39, lon: 22 },
  belgium: { lat: 51, lon: 4 },
  luxembourg: { lat: 50, lon: 6 },
  croatia: { lat: 45, lon: 16 },
  slovenia: { lat: 46, lon: 15 },
  slovakia: { lat: 49, lon: 19 },
  serbia: { lat: 44, lon: 21 },
  lithuania: { lat: 55, lon: 24 },
  latvia: { lat: 57, lon: 24 },
  estonia: { lat: 59, lon: 25 },
  russia: { lat: 60, lon: 30 },
  bosnia: { lat: 44, lon: 18 },
  montenegro: { lat: 42, lon: 19 },
  kosovo: { lat: 43, lon: 21 },
  north_macedonia: { lat: 41, lon: 22 },
  albania: { lat: 41, lon: 20 },
};

function getCityCoord(cityId) {
  if (COORDS[cityId]) return COORDS[cityId];
  const country = CITY_COUNTRY[cityId];
  if (country && COUNTRY_CENTROIDS[country]) return COUNTRY_CENTROIDS[country];
  return null;
}

console.log('\n=== AVERAGE DISTANCE BY TRAILER TIER (km, road-adjusted) ===');
console.log('Origin'.padEnd(16) + 'Country'.padEnd(12) +
  'Std avg'.padStart(8) + 'Dbl avg'.padStart(8) + 'HCT avg'.padStart(8) +
  '  Dbl/Std'.padStart(10) + '  HCT/Std'.padStart(10) +
  '  Std cities'.padStart(12) + '  Dbl cities'.padStart(12) + '  HCT cities'.padStart(12));
console.log('-'.repeat(120));

const results = [];

for (const origin of ORIGINS) {
  const originCoord = COORDS[origin];
  if (!originCoord) continue;
  const originCountry = CITY_COUNTRY[origin] || '?';

  let stdSum = 0, stdCount = 0;
  let dblSum = 0, dblCount = 0;
  let hctSum = 0, hctCount = 0;

  for (const [destId, destCity] of cities) {
    if (destId === origin) continue;
    const destCoord = getCityCoord(destId);
    if (!destCoord) continue;
    const dist = haversineKm(originCoord, destCoord) * ROAD_FACTOR;

    // Standard: all cities
    stdSum += dist;
    stdCount++;

    // Double: only double-valid countries
    if (DOUBLE_COUNTRIES.has(destCity.country)) {
      dblSum += dist;
      dblCount++;
    }

    // HCT: only FI/SE
    if (HCT_COUNTRIES.has(destCity.country)) {
      hctSum += dist;
      hctCount++;
    }
  }

  const stdAvg = stdCount > 0 ? stdSum / stdCount : 0;
  const dblAvg = dblCount > 0 ? dblSum / dblCount : 0;
  const hctAvg = hctCount > 0 ? hctSum / hctCount : 0;

  const dblRatio = stdAvg > 0 ? dblAvg / stdAvg : 0;
  const hctRatio = stdAvg > 0 ? hctAvg / stdAvg : 0;

  results.push({ origin, originCountry, stdAvg, dblAvg, hctAvg, dblRatio, hctRatio, stdCount, dblCount, hctCount });

  console.log(
    origin.padEnd(16) + originCountry.padEnd(12) +
    stdAvg.toFixed(0).padStart(8) + dblAvg.toFixed(0).padStart(8) + hctAvg.toFixed(0).padStart(8) +
    (dblRatio * 100).toFixed(1).padStart(9) + '%' +
    (hctRatio * 100).toFixed(1).padStart(9) + '%' +
    String(stdCount).padStart(12) + String(dblCount).padStart(12) + String(hctCount).padStart(12)
  );
}

// ── 5. Compute optimizer error for body types with HCT/double variants ──
console.log('\n\n=== OPTIMIZER ERROR ESTIMATE ===');
console.log('For a body type where HCT has 2x the units of standard:');
console.log('Model value: HCT_units / STD_units = 2.0 (HCT appears 2x better)');
console.log('Real value:  (HCT_units × HCT_avg_dist) / (STD_units × STD_avg_dist)');
console.log('');

for (const r of results) {
  if (r.hctAvg === 0 && r.dblAvg === 0) continue;

  // Typical unit ratios: HCT ≈ 2x standard, Double ≈ 1.5x standard
  const hctUnitRatio = 2.0;
  const dblUnitRatio = 1.5;

  if (r.hctCount > 0 && HCT_COUNTRIES.has(r.originCountry)) {
    const modelRatio = hctUnitRatio;  // Model thinks HCT is 2x better
    const realRatio = hctUnitRatio * r.hctRatio;  // Actual, accounting for distance
    const error = ((modelRatio - realRatio) / modelRatio * 100);
    console.log(r.origin + ' HCT vs Standard:');
    console.log('  Model says HCT is ' + modelRatio.toFixed(1) + 'x better (unit ratio)');
    console.log('  Reality: HCT is ' + realRatio.toFixed(2) + 'x (units × distance ratio)');
    console.log('  Distance penalty: HCT avg ' + r.hctAvg.toFixed(0) + 'km vs Std avg ' + r.stdAvg.toFixed(0) + 'km (' + (r.hctRatio * 100).toFixed(0) + '%)');
    console.log('  Model overestimates HCT by: ' + error.toFixed(0) + '%');
    if (realRatio < 1.0) {
      console.log('  >>> STANDARD ACTUALLY WINS — model is recommending the wrong trailer tier');
    }
    console.log('');
  }

  if (r.dblCount > 0 && (DOUBLE_COUNTRIES.has(r.originCountry) || HCT_COUNTRIES.has(r.originCountry))) {
    const modelRatio = dblUnitRatio;
    const realRatio = dblUnitRatio * r.dblRatio;
    const error = ((modelRatio - realRatio) / modelRatio * 100);
    console.log(r.origin + ' Double vs Standard:');
    console.log('  Model says Double is ' + modelRatio.toFixed(1) + 'x better (unit ratio)');
    console.log('  Reality: Double is ' + realRatio.toFixed(2) + 'x (units × distance ratio)');
    console.log('  Distance penalty: Dbl avg ' + r.dblAvg.toFixed(0) + 'km vs Std avg ' + r.stdAvg.toFixed(0) + 'km (' + (r.dblRatio * 100).toFixed(0) + '%)');
    console.log('  Model overestimates Double by: ' + error.toFixed(0) + '%');
    if (realRatio < 1.0) {
      console.log('  >>> STANDARD ACTUALLY WINS — model is recommending the wrong trailer tier');
    }
    console.log('');
  }
}

// ── 6. Summary ──
console.log('\n=== SUMMARY ===');
console.log('The optimizer ignores distance. Revenue scales linearly with distance.');
console.log('For cities with HCT/double availability, the optimizer overvalues those tiers');
console.log('because it sees higher units but misses the shorter average route distance.');
console.log('');
console.log('Key ratios (E[distance_restricted] / E[distance_standard]):');
for (const r of results) {
  if (r.hctCount > 0 && HCT_COUNTRIES.has(r.originCountry)) {
    console.log('  ' + r.origin + ': HCT=' + (r.hctRatio * 100).toFixed(0) + '% of std distance, Double=' + (r.dblRatio * 100).toFixed(0) + '% of std distance');
  } else if (DOUBLE_COUNTRIES.has(r.originCountry)) {
    console.log('  ' + r.origin + ': Double=' + (r.dblRatio * 100).toFixed(0) + '% of std distance');
  }
}
