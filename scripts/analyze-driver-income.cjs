const { SIIDecryptor } = require('@trucky/sii-decrypt-ts');
const path = require('path');
const SAVE = path.join(__dirname, '..', 'saves', 'game_20260309_latest.sii');
const result = SIIDecryptor.decrypt(SAVE);
const text = result.string_content;

// ── 1. Parse delivery_log_entry blocks ──
const delRe = /delivery_log_entry : (\S+) \{([^}]+)\}/g;
let m;
const deliveries = [];
while ((m = delRe.exec(text)) !== null) {
  const body = m[2];
  const params = {};
  const paramRe = /params\[(\d+)\]: (.+)/g;
  let pm;
  while ((pm = paramRe.exec(body)) !== null) {
    params[parseInt(pm[1])] = pm[2].trim().replace(/^"|"$/g, '');
  }
  deliveries.push(params);
}

console.log('Total delivery log entries:', deliveries.length);
if (deliveries.length > 0) {
  console.log('\nSample entry (all params):');
  const s = deliveries[0];
  for (const k of Object.keys(s).sort((a, b) => parseInt(a) - parseInt(b))) {
    console.log('  p[' + k + ']:', s[k]);
  }
}

// ── 2. Identify field meanings ──
console.log('\n=== p[0] values (delivery type?) ===');
const types = {};
deliveries.forEach(d => { types[d[0]] = (types[d[0]] || 0) + 1; });
console.log(types);

// ── 3. Look for driver/truck assignment data ──
// Search for "driver_ai" or hired driver blocks
const driverRe = /driver_ai : (\S+) \{([^}]*(?:\{[^}]*\}[^}]*)*[^}]*)\}/g;
const drivers = [];
let dm;
while ((dm = driverRe.exec(text)) !== null) {
  drivers.push({ id: dm[1], body: dm[2] });
}
console.log('\n=== AI DRIVERS ===');
console.log('Total driver_ai blocks:', drivers.length);

// Parse driver details
for (const d of drivers.slice(0, 5)) {
  const trailerMatch = d.body.match(/assigned_trailer:\s*(\S+)/);
  const cityMatch = d.body.match(/assigned_truck:\s*(\S+)/);
  const nameMatch = d.body.match(/driver_name:\s*"?([^"\n]+)"?/);
  console.log('Driver:', d.id);
  if (nameMatch) console.log('  name:', nameMatch[1]);
  if (trailerMatch) console.log('  trailer:', trailerMatch[1]);
  if (cityMatch) console.log('  truck:', cityMatch[1]);
}

// ── 4. Check for profit_log or income data ──
const profitRe = /profit_log\b[^{]*\{([^}]+)\}/g;
let profitCount = 0;
let pm2;
while ((pm2 = profitRe.exec(text)) !== null) {
  profitCount++;
  if (profitCount <= 2) {
    console.log('\n=== PROFIT LOG ENTRY ===');
    console.log(pm2[1].trim().substring(0, 500));
  }
}
console.log('\nTotal profit_log blocks:', profitCount);

// ── 5. Parse actual delivery data with distance ──
console.log('\n=== DELIVERY ANALYSIS ===');
console.log(
  'Cargo'.padEnd(25) +
  'From'.padEnd(18) +
  'To'.padEnd(18) +
  'Distance'.padStart(8) +
  '  Payout'.padStart(10) +
  '  $/km'.padStart(8) +
  '  Units'.padStart(6) +
  '  Type(p0)'.padStart(10)
);
console.log('-'.repeat(105));

deliveries.forEach(p => {
  const cargoId = (p[3] || '?').replace('cargo.', '');
  const from = (p[1] || '?');
  const to = (p[2] || '?');
  const dist = parseInt(p[8]) || 0;
  const payout = parseFloat(p[5]) || 0;
  const units = parseInt(p[23]) || 0;
  const perKm = dist > 0 ? (payout / dist).toFixed(1) : '?';

  console.log(
    cargoId.substring(0, 24).padEnd(25) +
    from.substring(0, 17).padEnd(18) +
    to.substring(0, 17).padEnd(18) +
    String(dist).padStart(8) +
    String(payout).padStart(10) +
    String(perKm).padStart(8) +
    String(units).padStart(6) +
    String(p[0] || '?').padStart(10)
  );
});

// ── 6. Check if there's a way to identify AI vs player deliveries ──
console.log('\n=== LOOKING FOR DRIVER REFERENCES IN DELIVERIES ===');
// Check p[9], p[10], p[11] etc for driver references
if (deliveries.length > 0) {
  const d = deliveries[0];
  console.log('Full param dump of first delivery:');
  for (let i = 0; i <= 30; i++) {
    if (d[i] !== undefined) {
      console.log('  p[' + i + ']:', d[i]);
    }
  }
}
