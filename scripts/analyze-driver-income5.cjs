const { SIIDecryptor } = require('@trucky/sii-decrypt-ts');
const path = require('path');
const SAVE = path.join(__dirname, '..', 'saves', 'game_20260309_latest.sii');
const result = SIIDecryptor.decrypt(SAVE);
const text = result.string_content;
const gd = require(path.join(__dirname, '..', 'public', 'data', 'game-defs.json'));

// ── Parse garage blocks to get driver/trailer assignments ──
// Find garage.istanbul and garage.stockholm detailed blocks
function parseGarageDrivers(garageId) {
  // Need to find the full garage block including driver/vehicle/trailer arrays
  const re = new RegExp('garage : ' + garageId.replace('.', '\\.') + ' \\{([\\s\\S]*?)\\n\\}');
  const m = re.exec(text);
  if (!m) return null;
  const body = m[1];

  const driverRefs = [];
  const vehicleRefs = [];
  const trailerRefs = [];
  const drRe = /drivers\[(\d+)\]:\s*(\S+)/g;
  const vhRe = /vehicles\[(\d+)\]:\s*(\S+)/g;
  const trRe = /trailers\[(\d+)\]:\s*(\S+)/g;
  let dm, vm, tm;
  while ((dm = drRe.exec(body)) !== null) driverRefs.push(dm[2]);
  while ((vm = vhRe.exec(body)) !== null) vehicleRefs.push(vm[2]);
  while ((tm = trRe.exec(body)) !== null) trailerRefs.push(tm[2]);

  return { driverRefs, vehicleRefs, trailerRefs };
}

// ── Parse trailer objects to find body types ──
function findTrailerBodyType(ref) {
  const re = new RegExp('trailer : ' + ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([\\s\\S]*?)\\n\\}');
  const m = re.exec(text);
  if (!m) return null;
  const body = m[1];
  // Look for trailer_definition which links to the trailer def
  const defMatch = body.match(/trailer_definition:\s*(\S+)/);
  const slaveMatch = body.match(/slave_trailer:\s*(\S+)/); // for doubles/HCT
  return {
    def: defMatch ? defMatch[1] : '?',
    slave: slaveMatch ? slaveMatch[1] : null,
    raw: body.substring(0, 300),
  };
}

// ── Parse driver_ai blocks ──
function findDriver(ref) {
  const re = new RegExp('driver_ai : ' + ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([\\s\\S]*?)\\n\\}');
  const m = re.exec(text);
  if (!m) return null;
  const body = m[1];
  const longDist = body.match(/long_dist:\s*(\d+)/);
  const fragile = body.match(/fragile:\s*(\d+)/);
  const urgent = body.match(/urgent:\s*(\d+)/);
  const heavy = body.match(/heavy:\s*(\d+)/);
  const adr = body.match(/adr:\s*(\d+)/);
  const hometown = body.match(/hometown:\s*(\S+)/);
  const currentCity = body.match(/current_city:\s*(\S+)/);
  const assignedTrailer = body.match(/assigned_trailer:\s*(\S+)/);
  const assignedTruck = body.match(/assigned_truck:\s*(\S+)/);

  return {
    longDist: parseInt(longDist ? longDist[1] : '0'),
    fragile: parseInt(fragile ? fragile[1] : '0'),
    urgent: parseInt(urgent ? urgent[1] : '0'),
    heavy: parseInt(heavy ? heavy[1] : '0'),
    adr: parseInt(adr ? adr[1] : '0'),
    hometown: hometown ? hometown[1] : '?',
    currentCity: currentCity ? currentCity[1] : '?',
    trailer: assignedTrailer ? assignedTrailer[1] : null,
    truck: assignedTruck ? assignedTruck[1] : null,
  };
}

// ── Analyze both garages ──
for (const garageId of ['garage.istanbul', 'garage.stockholm']) {
  console.log('\n' + '='.repeat(60));
  console.log(garageId.toUpperCase());
  console.log('='.repeat(60));

  const g = parseGarageDrivers(garageId);
  if (!g) { console.log('Not found'); continue; }

  console.log('Drivers:', g.driverRefs.length, 'Vehicles:', g.vehicleRefs.length, 'Trailers:', g.trailerRefs.length);

  for (let i = 0; i < g.driverRefs.length; i++) {
    const driver = findDriver(g.driverRefs[i]);
    if (!driver) { console.log('  Driver', i, ': not found'); continue; }

    // Get trailer info from garage trailer array (same index)
    const trailerRef = g.trailerRefs[i];
    const trailer = trailerRef ? findTrailerBodyType(trailerRef) : null;

    console.log('\n  Driver', i + 1, '(' + g.driverRefs[i] + ')');
    console.log('    Skills: long_dist=' + driver.longDist, 'fragile=' + driver.fragile,
      'urgent=' + driver.urgent, 'heavy=' + driver.heavy, 'adr=' + driver.adr);
    console.log('    City:', driver.currentCity);
    if (trailer) {
      console.log('    Trailer def:', trailer.def);
      console.log('    Has slave (double/HCT):', trailer.slave !== null && trailer.slave !== 'null');
    }
  }
}

// ── Compare average $/km between garages ──
console.log('\n\n' + '='.repeat(60));
console.log('REVENUE COMPARISON: ISTANBUL vs STOCKHOLM');
console.log('='.repeat(60));

// Parse profit entries per garage
function getGarageProfitEntries(garageId) {
  const gRe = new RegExp('garage : ' + garageId.replace('.', '\\.') + ' \\{([^}]+)\\}');
  const gm = gRe.exec(text);
  if (!gm) return [];
  const profitLogRef = gm[1].match(/profit_log:\s*(\S+)/);
  if (!profitLogRef) return [];

  const plRe = new RegExp('profit_log : ' + profitLogRef[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]+)\\}');
  const plm = plRe.exec(text);
  if (!plm) return [];

  const dataRefs = [];
  const drRe = /stats_data\[(\d+)\]:\s*(\S+)/g;
  let dm;
  while ((dm = drRe.exec(plm[1])) !== null) dataRefs.push(dm[2]);

  const entries = [];
  for (const ref of dataRefs) {
    const eRe = new RegExp('profit_log_entry : ' + ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]+)\\}');
    const em = eRe.exec(text);
    if (!em) continue;
    const body = em[1];
    const rev = body.match(/revenue:\s*(\d+)/);
    const dist = body.match(/distance:\s*(\d+)/);
    const count = body.match(/cargo_count:\s*(\d+)/);
    entries.push({
      revenue: parseInt(rev ? rev[1] : '0'),
      distance: parseInt(dist ? dist[1] : '0'),
      count: parseInt(count ? count[1] : '0'),
    });
  }
  return entries.filter(e => e.revenue > 0);
}

for (const garageId of ['garage.istanbul', 'garage.stockholm']) {
  const entries = getGarageProfitEntries(garageId);
  const totalRev = entries.reduce((s, e) => s + e.revenue, 0);
  const totalDist = entries.reduce((s, e) => s + e.distance, 0);
  const avgDist = entries.length > 0 ? (totalDist / entries.length).toFixed(0) : 0;
  const avgRev = entries.length > 0 ? (totalRev / entries.length).toFixed(0) : 0;
  const avgPerKm = totalDist > 0 ? (totalRev / totalDist).toFixed(1) : '?';

  console.log('\n' + garageId);
  console.log('  Deliveries:', entries.length);
  console.log('  Total revenue:', totalRev);
  console.log('  Total distance:', totalDist, 'km');
  console.log('  Avg revenue/delivery:', avgRev);
  console.log('  Avg distance/delivery:', avgDist, 'km');
  console.log('  Avg $/km:', avgPerKm);

  // Distance distribution
  const ranges = [0, 200, 500, 800, 1000, 1500, 2000, 5000];
  console.log('\n  Distance distribution:');
  for (let i = 0; i < ranges.length - 1; i++) {
    const inRange = entries.filter(e => e.distance >= ranges[i] && e.distance < ranges[i + 1]);
    if (inRange.length === 0) continue;
    const rangeRev = inRange.reduce((s, e) => s + e.revenue, 0);
    const rangeDist = inRange.reduce((s, e) => s + e.distance, 0);
    const rangePerKm = rangeDist > 0 ? (rangeRev / rangeDist).toFixed(1) : '?';
    console.log('    ' + String(ranges[i]).padStart(5) + '-' + String(ranges[i + 1]).padStart(5) + ' km: ' +
      String(inRange.length).padStart(3) + ' deliveries, avg $/km: ' + rangePerKm +
      ', avg dist: ' + (rangeDist / inRange.length).toFixed(0));
  }
}
