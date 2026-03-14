const { SIIDecryptor } = require('@trucky/sii-decrypt-ts');
const path = require('path');
const SAVE = path.join(__dirname, '..', 'saves', 'game_20260309_latest.sii');
const result = SIIDecryptor.decrypt(SAVE);
const text = result.string_content;

// ── 1. Find garages with drivers/vehicles > 0 ──
const garageRe = /garage : (garage\.\w+) \{([^}]+)\}/g;
let gm;
const garages = [];
while ((gm = garageRe.exec(text)) !== null) {
  const body = gm[2];
  const status = body.match(/status:\s*(\d+)/);
  const drivers = body.match(/drivers:\s*(\d+)/);
  const vehicles = body.match(/vehicles:\s*(\d+)/);
  const trailers = body.match(/trailers:\s*(\d+)/);
  const profitLog = body.match(/profit_log:\s*(\S+)/);
  const productivity = body.match(/productivity:\s*(\d+)/);

  garages.push({
    id: gm[1],
    status: parseInt(status ? status[1] : '0'),
    drivers: parseInt(drivers ? drivers[1] : '0'),
    vehicles: parseInt(vehicles ? vehicles[1] : '0'),
    trailers: parseInt(trailers ? trailers[1] : '0'),
    profitLog: profitLog ? profitLog[1] : null,
    productivity: parseInt(productivity ? productivity[1] : '0'),
  });
}

const owned = garages.filter(g => g.status > 0);
const withDrivers = garages.filter(g => g.drivers > 0);
console.log('=== GARAGE OVERVIEW ===');
console.log('Total garages:', garages.length, 'Owned:', owned.length, 'With drivers:', withDrivers.length);

for (const g of owned) {
  console.log('  ', g.id, '| status:', g.status, 'drivers:', g.drivers,
    'vehicles:', g.vehicles, 'trailers:', g.trailers, 'productivity:', g.productivity);
}

// ── 2. Parse player profile for garages ──
const profileRe = /economy : _nameless\S* \{([\s\S]*?)\n\}/;
const profileMatch = profileRe.exec(text);
if (profileMatch) {
  const body = profileMatch[1];
  // Find garage references
  const garageRefs = body.match(/garage\.\w+/g);
  console.log('\n=== PLAYER ECONOMY GARAGES ===');
  if (garageRefs) {
    console.log('Referenced garages:', [...new Set(garageRefs)].join(', '));
  }
}

// ── 3. Parse profit_log containers and their entries ──
// Match profit_log with stats_data arrays
const profitLogRe = /profit_log : (\S+) \{([^}]+)\}/g;
let plm;
const profitLogs = new Map();
while ((plm = profitLogRe.exec(text)) !== null) {
  const body = plm[2];
  const dataRefs = [];
  const dataRe = /stats_data\[(\d+)\]:\s*(\S+)/g;
  let dm;
  while ((dm = dataRe.exec(body)) !== null) {
    dataRefs.push(dm[2]);
  }
  profitLogs.set(plm[1], dataRefs);
}

// Parse profit_log_entry blocks into a map
const profitEntryRe = /profit_log_entry : (\S+) \{([^}]+)\}/g;
let pem;
const profitEntries = new Map();
while ((pem = profitEntryRe.exec(text)) !== null) {
  const body = pem[2];
  const rev = body.match(/revenue:\s*(\d+)/);
  const dist = body.match(/distance:\s*(\d+)/);
  const count = body.match(/cargo_count:\s*(\d+)/);
  const day = body.match(/timestamp_day:\s*(\d+)/);
  profitEntries.set(pem[1], {
    revenue: parseInt(rev ? rev[1] : '0'),
    distance: parseInt(dist ? dist[1] : '0'),
    count: parseInt(count ? count[1] : '0'),
    day: parseInt(day ? day[1] : '0'),
  });
}

// ── 4. Trace garage → profit_log → entries ──
console.log('\n=== GARAGE PROFIT LOGS ===');
for (const g of owned) {
  if (!g.profitLog) continue;
  const entries = profitLogs.get(g.profitLog) || [];
  const resolved = entries.map(ref => profitEntries.get(ref)).filter(Boolean);
  const withRev = resolved.filter(e => e.revenue > 0);
  const totalRev = withRev.reduce((s, e) => s + e.revenue, 0);
  const totalDist = withRev.reduce((s, e) => s + e.distance, 0);

  console.log('\n  ' + g.id + ' (drivers: ' + g.drivers + ')');
  console.log('  Profit entries:', entries.length, 'With revenue:', withRev.length,
    'Total revenue:', totalRev, 'Total dist:', totalDist);

  if (withRev.length > 0) {
    console.log('  ' + 'Rev'.padStart(8) + 'Dist'.padStart(8) + '$/km'.padStart(8) + 'Units'.padStart(6) + 'Day'.padStart(5));
    for (const e of withRev) {
      const perKm = e.distance > 0 ? (e.revenue / e.distance).toFixed(1) : '?';
      console.log('  ' + String(e.revenue).padStart(8) + String(e.distance).padStart(8) +
        String(perKm).padStart(8) + String(e.count).padStart(6) + String(e.day).padStart(5));
    }
  }
}

// ── 5. Economy formula analysis ──
// From economy_data: revenue = fixed_revenue + units * cargo.value * coef * distance
// For AI drivers: coef = driver_revenue_coef_per_km = 0.67
// Let's reverse-engineer from the data we have
console.log('\n=== FORMULA REVERSE ENGINEERING ===');
console.log('Known: fixed_revenue=600, driver_coef=0.67, player_coef=0.9');
console.log('If payout = fixed_revenue + cargo_value * units * distance * coef:');

// Use delivery_log_entry which has cargo info
const delRe = /delivery_log_entry : (\S+) \{([^}]+)\}/g;
let dem;
const deliveries = [];
while ((dem = delRe.exec(text)) !== null) {
  const body = dem[2];
  const params = {};
  const paramRe2 = /params\[(\d+)\]: (.+)/g;
  let prm;
  while ((prm = paramRe2.exec(body)) !== null) {
    params[parseInt(prm[1])] = prm[2].trim().replace(/^"|"$/g, '');
  }
  deliveries.push(params);
}

const gd = require(path.join(__dirname, '..', 'public', 'data', 'game-defs.json'));

console.log('\nPlayer delivery formula check (p[5]=payout, p[8]=dist, p[22]=baseRate, p[23]=units):');
console.log('Cargo'.padEnd(20) + 'Payout'.padStart(8) + 'Dist'.padStart(6) + 'baseRate'.padStart(10) +
  'Units'.padStart(6) + '  (pay-600)/dist'.padStart(16) + '  baseRate*0.9'.padStart(14));

for (const d of deliveries.slice(0, 20)) {
  const cargoId = (d[3] || '').replace('cargo.', '');
  const payout = parseFloat(d[5]) || 0;
  const dist = parseInt(d[8]) || 0;
  const baseRate = parseFloat(d[22]) || 0;
  const units = parseInt(d[23]) || 0;

  const adjPerKm = dist > 0 ? ((payout - 600) / dist).toFixed(2) : '?';
  const expectedPerKm = (baseRate * 0.9).toFixed(2);

  console.log(
    cargoId.substring(0, 19).padEnd(20) +
    String(payout).padStart(8) +
    String(dist).padStart(6) +
    String(baseRate.toFixed(1)).padStart(10) +
    String(units).padStart(6) +
    String(adjPerKm).padStart(16) +
    String(expectedPerKm).padStart(14)
  );
}
