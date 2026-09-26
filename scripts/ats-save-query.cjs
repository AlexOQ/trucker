#!/usr/bin/env node
/**
 * Read the live ATS save and dump playthrough state.
 *
 * Usage:
 *   node scripts/ats-save-query.cjs [state|offers|raw] [--city <id>,<id>] [--out <path>]
 *
 *   state   (default) driver, money, skills, visited cities, used-truck stock
 *   offers  live job board for --city (defaults to every visited city)
 *   raw     decrypt game.sii to --out for grepping
 *
 * ⚠️ Saves live in Steam Cloud, NOT in the local profiles/ dir:
 *   ~/Library/Application Support/Steam/userdata/<steamid>/270880/remote/profiles/<hex>/
 * The `steam_profiles/` dir under Application Support holds only settings, and
 * `steam_profiles(<version>).bak` dirs are pre-upgrade snapshots of OLD profiles.
 *
 * Saves are ScsC-encrypted (`g_save_format 0`); @trucky/sii-decrypt-ts handles it.
 * Read-only — never writes into the save tree.
 */
const { SIIDecryptor } = require('@trucky/sii-decrypt-ts');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STEAM = path.join(os.homedir(), 'Library/Application Support/Steam/userdata');
const APPIDS = { ats: '270880', ets2: '227300' };
const GAME = process.env.GAME || 'ats';
const APPID = APPIDS[GAME] || APPIDS.ats;

function findProfile() {
  if (!fs.existsSync(STEAM)) throw new Error(`no Steam userdata at ${STEAM}`);
  const want = process.env.PROFILE;   // profile name (decoded) to select when several exist
  for (const uid of fs.readdirSync(STEAM)) {
    const root = path.join(STEAM, uid, APPID, 'remote', 'profiles');
    if (!fs.existsSync(root)) continue;
    for (const hex of fs.readdirSync(root)) {
      if (want) {
        let nm = hex;
        try { nm = Buffer.from(hex, 'hex').toString('utf8'); } catch { /* keep hex */ }
        if (nm.toLowerCase() !== want.toLowerCase()) continue;
      }
      const p = path.join(root, hex);
      if (fs.existsSync(path.join(p, 'save'))) {
        let name = hex;
        try { name = Buffer.from(hex, 'hex').toString('utf8'); } catch { /* keep hex */ }
        return { dir: p, name, hex };
      }
    }
  }
  throw new Error('no ATS profile with a save/ dir found under Steam Cloud');
}

/** Newest save slot by game.sii mtime — autosave is not always the latest. */
function newestSave(profileDir) {
  const saveRoot = path.join(profileDir, 'save');
  const slots = fs.readdirSync(saveRoot)
    .map((s) => ({ slot: s, game: path.join(saveRoot, s, 'game.sii') }))
    .filter((s) => fs.existsSync(s.game))
    .map((s) => ({ ...s, mtime: fs.statSync(s.game).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!slots.length) throw new Error(`no game.sii under ${saveRoot}`);
  return slots[0];
}

function decrypt(file) {
  const r = SIIDecryptor.decrypt(file);
  if (typeof r === 'string') return r;
  // The decryptor returns {success, string_content, data:<Buffer>, type, encrypted}.
  if (r && r.success === false) throw new Error(`decrypt failed: ${file}`);
  if (r && typeof r.string_content === 'string') return r.string_content;
  if (r && Buffer.isBuffer(r.data)) return r.data.toString('utf-8');
  throw new Error(`unrecognised decryptor result for ${file}`);
}

const scalar = (txt, key) => {
  const m = txt.match(new RegExp(`^\\s*${key}: (.*)$`, 'm'));
  return m ? m[1].trim() : null;
};
const list = (txt, key) =>
  [...txt.matchAll(new RegExp(`^\\s*${key}\\[\\d+\\]: (.*)$`, 'gm'))].map((m) => m[1].trim());

function blocks(txt, type) {
  return [...txt.matchAll(new RegExp(`^${type} : (\\S+) \\{\\n(.*?)^\\}`, 'gms'))]
    .map((m) => ({ id: m[1], body: m[2] }));
}

/** Cabin/chassis def paths reveal whether used stock is level-gated. */
function usedStock(txt) {
  const prices = blocks(txt, 'used_truck_offer')
    .map((b) => Number(scalar(b.body, 'price')))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const cabs = {};
  for (const m of txt.matchAll(/\/def\/vehicle\/truck\/([a-z0-9_.]+)\/cabin\/([a-z0-9_]+)/g)) {
    cabs[`${m[1]} ${m[2]}`] = (cabs[`${m[1]} ${m[2]}`] || 0) + 1;
  }
  return { count: prices.length, prices, cabs };
}

function reportState(txt, info, meta) {
  const cities = list(txt, 'visited_cities');
  const defs = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'public', 'data', GAME, 'game-defs.json'), 'utf-8'));
  const byState = {};
  for (const c of cities) {
    const st = (defs.cities[c] || {}).country || 'unknown';
    (byState[st] = byState[st] || []).push(c);
  }
  const stock = usedStock(txt);

  console.log(`profile      ${meta.name}  (${meta.hex})`);
  console.log(`save slot    ${meta.slot}   ${new Date(meta.mtime).toISOString()}`);
  console.log(`money        $${scalar(txt, 'money_account')}`);
  console.log(`loans        ${scalar(txt, 'loans')}   loan_limit $${scalar(txt, 'loan_limit')}`);
  console.log(`experience   ${scalar(txt, 'experience_points')}`);
  console.log(`HQ           ${scalar(txt, 'hq_city')}`);
  console.log(`current job  ${scalar(txt, 'current_job')}`);
  console.log(`own truck    ${scalar(txt, 'my_truck')}`);
  console.log(`skills       adr ${scalar(txt, 'adr')} · long_dist ${scalar(txt, 'long_dist')} · `
    + `heavy ${scalar(txt, 'heavy')} · fragile ${scalar(txt, 'fragile')} · `
    + `urgent ${scalar(txt, 'urgent')} · mechanical ${scalar(txt, 'mechanical')}`);
  console.log(`distance     ${scalar(txt, 'total_distances_by_mode')
    ? list(txt, 'total_distances_by_mode')[0] : '?'} on job`);
  console.log(`viewpoints   ${scalar(txt, 'discovered_cutscene_items')} cutscene items`);
  console.log(`dealers      ${list(txt, 'unlocked_dealers').join(', ') || 'none'}`);

  console.log(`\nvisited cities (${cities.length}) — last: ${scalar(txt, 'last_visited_city')}`);
  for (const st of Object.keys(byState).sort()) {
    const total = Object.values(defs.cities).filter((c) => c.country === st).length;
    console.log(`  ${st.padEnd(12)} ${byState[st].length}/${total}  ${byState[st].join(' · ')}`);
  }

  const fines = blocks(txt, 'police_offence_log_entry')
    .map((b) => Number(scalar(b.body, 'fine')));
  if (fines.length) {
    console.log(`\nfines        ${fines.length} × $${fines.join(' + $')} = $${
      fines.reduce((a, b) => a + b, 0)}`);
  }
  const log = blocks(txt, 'profit_log_entry').map((b) => ({
    revenue: scalar(b.body, 'revenue'),
    distance: scalar(b.body, 'distance'),
    cargo_count: scalar(b.body, 'cargo_count'),
  }));
  if (log.length) {
    console.log('profit log   ' + log.map((l) =>
      `$${l.revenue} / ${l.distance} / ${l.cargo_count}u`).join('  ·  '));
  }

  console.log(`\nused truck lot — ${stock.count} offers, $${stock.prices[0]}–$${
    stock.prices[stock.prices.length - 1]}`);
  console.log('  cabins on offer: ' + Object.keys(stock.cabs).sort().join(' · '));
  console.log('  (cabin `day`/`duty` = unlock 0. A sleeper here would mean the used lot'
    + ' bypasses the level gate.)');
  if (info) console.log(`\ninfo.sii     visited ${scalar(info, 'info_visited_cities')} · `
    + `xp ${scalar(info, 'info_players_experience')} · $${scalar(info, 'info_money_account')}`);
}

function reportOffers(txt, cityFilter) {
  // SOLVED pay model (validated exact on 4 of 5 logged jobs):
  //   base  = floor(fixed + coef × cargo.value × units × quoted_km)
  //   total = base + Σ floor(bonus_coef × (base − fixed))
  // fixed/coef by market: quick job 350 / 0.67 (`driver_revenue_coef_per_km`),
  // freight+online 600 / 0.9 (`revenue_coef_per_km`), cargo market 600 / 1.0.
  // The fixed reward doubles as the K subtracted inside every bonus line.
  // Note $/mi = 1.609 × (fixed/km + coef × value × units) — the fixed term rewards SHORT
  // hauls, so rate is not simply value × units.
  const defs = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'public', 'data', GAME, 'game-defs.json'), 'utf-8'));
  const offers = new Map();
  for (const b of blocks(txt, 'job_offer_data')) {
    const d = Object.fromEntries(
      [...b.body.matchAll(/^\s*(\w+): (.*)$/gm)].map((m) => [m[1], m[2].trim()]));
    offers.set(b.id, d);
  }
  const rows = [];
  for (const m of txt.matchAll(/^company : company\.volatile\.(\S+) \{\n(.*?)^\}/gms)) {
    const [, cid, body] = m;
    const city = cid.slice(cid.lastIndexOf('.') + 1);
    const company = cid.slice(0, cid.lastIndexOf('.'));
    if (cityFilter.length && !cityFilter.includes(city)) continue;
    for (const p of [...body.matchAll(/^\s*job_offer\[\d+\]: (\S+)$/gm)].map((x) => x[1])) {
      const d = offers.get(p);
      if (!d || d.cargo === 'null') continue;
      rows.push({
        city, company,
        cargo: (d.cargo || '').replace('cargo.', ''),
        dest: (d.target || '').replace(/"/g, ''),
        km: Number(d.shortest_distance_km || 0),
        expires: Number(d.expiration_time || 0),
        urgency: d.urgency,
        units: d.units_count,
        trailer: (d.trailer_definition || '').replace('trailer_def.', ''),
      });
    }
  }
  /**
   * ONE board, three ways to take the same job — not three job pools.
   *   quick job     supplies truck AND trailer, pays least
   *   freight       own truck + a market trailer; the whole board is available
   *   cargo market  own truck + YOUR OWN trailer; only the subset matching its body type
   * Same offer, different coefficient. `fixed` doubles as the K inside every bonus line.
   */
  // Offers carry an absolute `expiration_time` on the same clock as economy.game_time.
  // A freight job has to be DRIVEN to, so the remaining window is a hard constraint on
  // whether it is takeable at all; a quick job teleports and only needs the offer to exist.
  const gameTime = Number(scalar(txt, 'game_time') ?? 0);
  const MARKET = { qj: [350, 0.67], freight: [600, 0.9], cargo: [600, 1.0] };
  const ownsTrailer = Number(scalar(txt, 'trailers') ?? 0) > 0;

  // Live skill ranks off the save; level (proficiency %) from LEVEL or the LD-rank floor.
  const rank = (k) => Number(scalar(txt, k) ?? 0);
  const skills = { ld: rank('long_dist'), hv: rank('heavy'), fr: rank('fragile'), jit: rank('urgent') };
  const level = Number(process.env.LEVEL ?? skills.ld);

  /**
   * Long Distance pay is a pure function of the CONTRACT distance — the rank does not cap it.
   * Rank gates which jobs SPAWN; once an offer exists, its LD line is set by distance alone.
   * (The two are indistinguishable in observation precisely because a job long enough to
   * exceed your rank's band cannot spawn in the first place, so no cap is ever exercised.)
   * Confirmed: job #4 549 mi paid 10%; job #5 313 mi paid 5%.
   */
  function ldPct(mi, r) {
    if (r < 1) return 0;
    // [floor_mi, pct] — the pct paid once the distance REACHES that floor.
    const bands = [[250, 5], [400, 10], [650, 15], [1000, 20], [1600, 25], [2500, 30]];
    let pct = 0;
    for (const [floorMi, p] of bands) { if (mi < floorMi) break; pct = p; }
    return pct;
  }

  for (const r of rows) {
    const c = defs.cargo[r.cargo] ?? {};
    r.value = c.value ?? 0;
    r.mi = Math.max(1, Math.round(r.km * 0.621));
    const lines = { prof: level, LD: ldPct(r.mi, skills.ld) };
    if (c.high_value) lines.HV = skills.hv * 5;
    if (c.fragile) lines.Fr = skills.fr * 5;
    r.lines = Object.entries(lines).filter(([, p]) => p > 0)
      .map(([n, p]) => `${n}${p}%`).join('+') || '—';
    const pay = ([fixed, coef]) => {
      const base = Math.floor(fixed + coef * r.value * Number(r.units || 0) * r.km);
      const D = base - fixed;
      return base + Object.values(lines).reduce((a, p) => a + Math.floor(p / 100 * D), 0);
    };
    r.payQj = pay(MARKET.qj);
    r.payFreight = pay(MARKET.freight);
    r.payCargo = pay(MARKET.cargo);
    r.total = r.payFreight;            // rank on what is actually available today
    r.rate = r.payFreight / r.mi;
    r.body = (c.body_types ?? []).join('/');
    r.left = r.expires ? r.expires - gameTime : null;   // game minutes of offer left
  }
  console.log(`skills from save: LD r${skills.ld} · HV r${skills.hv} · Fragile r${skills.fr}`
    + ` · JIT r${skills.jit}  ·  proficiency ${level}%   (override with LEVEL=n)`);
  const sortKey = process.env.SORT || 'rate';
  rows.sort((a, b) => (sortKey === 'km' ? a.km - b.km
    : sortKey === 'total' ? b.total - a.total : b.rate - a.rate));
  console.log(`${rows.length} live offers${cityFilter.length ? ` from ${cityFilter.join(', ')}` : ''}`
    + `  — sorted by ${sortKey} (freight rate)`);
  console.log('   ONE board, three ways to take the same job. qj = truck+trailer supplied (cheapest);'
    + ' freight = own truck, any job;');
  console.log(`   cargo = own truck + YOUR trailer, body-type subset only`
    + `${ownsTrailer ? '' : ' — you own no trailer, so this column is hypothetical'}.`);
  console.log('   SORT=rate|total|km   LEVEL=n');
  console.log(`   game_time ${gameTime} — \`left\` = offer minutes remaining. A FREIGHT job has to be`
    + ` DRIVEN to, so it is only takeable if the pickup is reachable inside that window;`);
  console.log('   a QUICK JOB teleports, so only the offer existing matters.\n');
  console.log('   $/mi       qj  freight    cargo   mi   left  bonus lines     cargo            origin → destination');
  for (const r of rows) {
    console.log(`${r.rate.toFixed(1).padStart(7)}${String(r.payQj).padStart(9)}`
      + `${String(r.payFreight).padStart(9)}${String(r.payCargo).padStart(9)}${String(r.mi).padStart(5)}`
      + `${String(r.left ?? '?').padStart(7)}  ${r.lines.padEnd(15)}${r.cargo.padEnd(17)}${r.company}.${r.city} → ${r.dest}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.find((a) => !a.startsWith('--')) || 'state';
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };

  const prof = findProfile();
  const save = newestSave(prof.dir);
  const txt = decrypt(save.game);

  if (mode === 'raw') {
    const out = flag('out') || 'game.txt';
    fs.writeFileSync(out, txt);
    console.log(`${save.slot}/game.sii → ${out}  (${txt.length} chars)`);
    return;
  }
  if (mode === 'offers') {
    const cities = flag('city') ? flag('city').split(',') : list(txt, 'visited_cities');
    reportOffers(txt, cities);
    return;
  }
  const infoPath = path.join(path.dirname(save.game), 'info.sii');
  const info = fs.existsSync(infoPath) ? decrypt(infoPath) : null;
  reportState(txt, info, { ...prof, slot: save.slot, mtime: save.mtime });
}

main();
