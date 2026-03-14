const { SIIDecryptor } = require('@trucky/sii-decrypt-ts');
const path = require('path');
const SAVE = path.join(__dirname, '..', 'saves', 'game_20260309_latest.sii');
const result = SIIDecryptor.decrypt(SAVE);
const text = result.string_content;

// ── 1. Parse ALL profit_log_entry blocks with revenue > 0 ──
const profitEntryRe = /profit_log_entry : (\S+) \{([^}]+)\}/g;
let pm;
const profits = [];
while ((pm = profitEntryRe.exec(text)) !== null) {
  const body = pm[2];
  const rev = body.match(/revenue:\s*(\d+)/);
  const dist = body.match(/distance:\s*(\d+)/);
  const cargo = body.match(/cargo:\s*"([^"]*)"/);
  const src = body.match(/source_city:\s*"([^"]*)"/);
  const dst = body.match(/destination_city:\s*"([^"]*)"/);
  const count = body.match(/cargo_count:\s*(\d+)/);
  const wage = body.match(/wage:\s*(\d+)/);
  const fuel = body.match(/fuel:\s*(\d+)/);
  const day = body.match(/timestamp_day:\s*(\d+)/);
  const onJob = body.match(/distance_on_job:\s*(\w+)/);

  profits.push({
    id: pm[1],
    revenue: parseInt(rev ? rev[1] : '0'),
    distance: parseInt(dist ? dist[1] : '0'),
    cargo: cargo ? cargo[1] : '',
    source: src ? src[1] : '',
    dest: dst ? dst[1] : '',
    count: parseInt(count ? count[1] : '0'),
    wage: parseInt(wage ? wage[1] : '0'),
    fuel: parseInt(fuel ? fuel[1] : '0'),
    day: parseInt(day ? day[1] : '0'),
    onJob: onJob ? onJob[1] : '',
  });
}

// Revenue entries only
const withRevenue = profits.filter(p => p.revenue > 0);
console.log('=== PROFIT LOG ENTRIES WITH REVENUE ===');
console.log('Total entries:', profits.length, 'With revenue:', withRevenue.length);
console.log(
  'Revenue'.padStart(8) +
  '  Dist'.padStart(8) +
  '  $/km'.padStart(8) +
  '  Units'.padStart(6) +
  '  Day'.padStart(5) +
  '  ' + 'Cargo'.padEnd(20) +
  '  ' + 'From'.padEnd(20) +
  '  ' + 'To'.padEnd(20)
);
console.log('-'.repeat(110));
for (const p of withRevenue) {
  const perKm = p.distance > 0 ? (p.revenue / p.distance).toFixed(1) : '?';
  console.log(
    String(p.revenue).padStart(8) +
    String(p.distance).padStart(8) +
    String(perKm).padStart(8) +
    String(p.count).padStart(6) +
    String(p.day).padStart(5) +
    '  ' + p.cargo.substring(0, 19).padEnd(20) +
    '  ' + p.source.substring(0, 19).padEnd(20) +
    '  ' + p.dest.substring(0, 19).padEnd(20)
  );
}

// ── 2. Now trace profit_log containers to find which belong to drivers ──
// profit_log is referenced by garage or player
// Let's find what references profit_log objects
const profitLogRe = /profit_log : (\S+) \{([^}]+)\}/g;
let plm;
const profitLogs = [];
while ((plm = profitLogRe.exec(text)) !== null) {
  profitLogs.push({ id: plm[1], body: plm[2] });
}
console.log('\n\n=== PROFIT LOG CONTAINERS ===');
console.log('Total:', profitLogs.length);

// Find what objects reference these profit_log IDs
// Look for garage blocks that have profit_log references
const garageRe = /garage : (\S+) \{([\s\S]*?)\n\}/g;
let gm;
const garages = [];
while ((gm = garageRe.exec(text)) !== null) {
  garages.push({ id: gm[1], body: gm[2] });
}
console.log('\n=== GARAGES ===');
console.log('Total garage blocks:', garages.length);

for (const g of garages.slice(0, 5)) {
  const city = g.body.match(/city:\s*(\S+)/);
  const profLog = g.body.match(/profit_log:\s*(\S+)/);
  const drivers = g.body.match(/drivers\[\d+\]:\s*(\S+)/g);
  const vehicles = g.body.match(/vehicles\[\d+\]:\s*(\S+)/g);
  console.log('\n  Garage:', g.id);
  if (city) console.log('    city:', city[1]);
  if (profLog) console.log('    profit_log:', profLog[1]);
  console.log('    drivers:', drivers ? drivers.length : 0);
  console.log('    vehicles:', vehicles ? vehicles.length : 0);
  // Show first few lines of body
  const bodyLines = g.body.trim().split('\n').slice(0, 15);
  bodyLines.forEach(l => console.log('    |', l.trim()));
}

// ── 3. Check if the game tracks per-driver stats somewhere ──
// Search for blocks that contain both "driver" and "revenue" or "distance"
const lines = text.split('\n');
let inBlock = false;
let blockType = '';
let blockContent = '';
const driverBlocks = [];

for (const line of lines) {
  const blockStart = line.match(/^(\w+) : (\S+) \{/);
  if (blockStart) {
    inBlock = true;
    blockType = blockStart[1];
    blockContent = line + '\n';
    continue;
  }
  if (inBlock) {
    blockContent += line + '\n';
    if (line.trim() === '}') {
      if (blockType === 'driver_ai' || blockType === 'driver') {
        // Check if this block has revenue or stats
        if (/revenue|stats|profit|income/i.test(blockContent)) {
          driverBlocks.push(blockContent.substring(0, 500));
        }
      }
      inBlock = false;
    }
  }
}
console.log('\n\n=== DRIVER BLOCKS WITH FINANCIAL DATA ===');
console.log('Count:', driverBlocks.length);
for (const b of driverBlocks.slice(0, 3)) {
  console.log('---');
  console.log(b);
}
