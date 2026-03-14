const { SIIDecryptor } = require('@trucky/sii-decrypt-ts');
const path = require('path');
const SAVE = path.join(__dirname, '..', 'saves', 'game_20260309_latest.sii');
const result = SIIDecryptor.decrypt(SAVE);
const text = result.string_content;

// ── 1. Look for profit_log_entry (AI driver income?) ──
const profitEntryRe = /profit_log_entry : (\S+) \{([^}]+)\}/g;
let pm;
const profits = [];
while ((pm = profitEntryRe.exec(text)) !== null) {
  profits.push({ id: pm[1], body: pm[2] });
}
console.log('profit_log_entry blocks:', profits.length);
if (profits.length > 0) {
  console.log('\nFirst 3:');
  for (const p of profits.slice(0, 3)) {
    console.log('---', p.id);
    console.log(p.body.trim().substring(0, 500));
  }
}

// ── 2. Look for economy_event blocks ──
const econEventRe = /economy_event[_a-z]* : (\S+) \{([^}]+)\}/g;
let em;
const econEvents = [];
while ((em = econEventRe.exec(text)) !== null) {
  econEvents.push({ id: em[1], body: em[2] });
}
console.log('\neconomy_event blocks:', econEvents.length);
if (econEvents.length > 0) {
  for (const e of econEvents.slice(0, 3)) {
    console.log('---', e.id);
    console.log(e.body.trim().substring(0, 500));
  }
}

// ── 3. Search for revenue/income/earning mentions ──
const lines = text.split('\n');
const revenueLines = lines.filter(l => /revenue|income|earning|driver_pay/i.test(l)).slice(0, 20);
console.log('\nLines with revenue/income/earning/driver_pay:');
revenueLines.forEach(l => console.log(' ', l.trim()));

// ── 4. Look at driver_ai blocks more carefully ──
// The _nameless refs in driver_ai.assigned_trailer point to trailer objects
// Let's find what trailer type each driver has
const driverRe = /driver_ai : (\S+) \{([\s\S]*?)\n\}/g;
let dm;
const drivers = [];
while ((dm = driverRe.exec(text)) !== null) {
  drivers.push({ id: dm[1], body: dm[2] });
}

// Find hired drivers (with assigned_truck not null)
const hired = drivers.filter(d => {
  const truck = d.body.match(/assigned_truck:\s*(\S+)/);
  return truck && truck[1] !== 'null';
});
console.log('\n=== HIRED DRIVERS (assigned_truck not null) ===');
console.log('Total driver_ai:', drivers.length, 'Hired:', hired.length);

for (const d of hired.slice(0, 15)) {
  const trailer = d.body.match(/assigned_trailer:\s*(\S+)/);
  const truck = d.body.match(/assigned_truck:\s*(\S+)/);
  const city = d.body.match(/home_city:\s*(\S+)/);
  console.log('  Driver:', d.id,
    'city:', city ? city[1] : '?',
    'trailer:', trailer ? trailer[1] : '?');
}

// ── 5. Find profit_log blocks (parent containers) ──
const profitLogRe = /profit_log : (\S+) \{([^}]+)\}/g;
let plm;
const profitLogs = [];
while ((plm = profitLogRe.exec(text)) !== null) {
  profitLogs.push({ id: plm[1], body: plm[2] });
}
console.log('\nprofit_log (container) blocks:', profitLogs.length);
if (profitLogs.length > 0) {
  for (const p of profitLogs.slice(0, 5)) {
    console.log('---', p.id);
    console.log(p.body.trim().substring(0, 500));
  }
}
