/**
 * Headless garage ranking — runs the browser optimizer under Node with a given DLC set.
 *
 * Usage: npx tsx scripts/rank-garages.mts
 *
 * Stubs `fetch` (reads public/ off disk) and `localStorage` (selects the game), then runs
 * the same calculateCityRankings() the rankings page uses. Owned-DLC sets below are read
 * off the ATS save's info.sii dependency list, the one authoritative source — an
 * install-directory listing is not proof of ownership. (A local untracked note mirrors it.)
 *
 * ⚠️ RANKING_MC_SIMS is 500, so scores carry a few points of Monte Carlo noise. Treat gaps
 * under ~2% as ties and break them on depot count / position, not on the score.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const GAME = process.env.GAME ?? 'ats';
const store: Record<string, string> = { 'trucker-game': GAME };
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};
(globalThis as any).fetch = async (p: string) => {
  const f = path.join(ROOT, 'public', p);
  if (!fs.existsSync(f)) return { ok: false, json: async () => null };
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(f, 'utf-8')) };
};

const { loadAllData } = await import('../src/frontend/loader.js');
const { buildLookups } = await import('../src/frontend/lookups.js');
const { applyDLCFilter } = await import('../src/frontend/dlc-filter.js');
const { calculateCityRankings } = await import('../src/frontend/optimizer.js');
// `export let` + reassignment in initDlcData — destructuring copies the PRE-init value,
// so hold the namespace and read through it after loadAllData() has run.
const dlcData = await import('../src/frontend/dlc-data.js');

// Owned, straight off the save's info.sii dependency list (authoritative — dlc-owned.md
// was wrong about the cargo packs). Registry ids are BARE names: `texas`, `heavy_cargo` —
// not the `ats_*` archive names the dependency list prints.
// ETS2 set read off the ETS2 save's info.sii dependency list (2026-08-26): every map DLC;
// cargo packs high_power/heavy/special/volvo_ce/farm/forest (NOT jcb/bobcat/krone_agri);
// trailer brands kassbohrer/schmitz/wielton.
const SETS = {
  ats: {
    map: ['new_mexico', 'oregon', 'washington', 'utah', 'idaho', 'colorado',
      'wyoming', 'montana', 'texas', 'oklahoma', 'arkansas', 'kansas'],  // 12 of 17; CA/NV/AZ are base
      // kansas bought 2026-09-25 (appid 2298430) — 94 buyable garage cities now, was 89
    cargo: ['heavy_cargo', 'special_transport', 'forest_machinery', 'farm_machinery'],
    trailer: [] as string[],                                         // lodeking + prestige both unowned
    unownedMapCount: 17,
  },
  ets2: {
    map: ['going_east', 'scandinavia', 'vive_la_france', 'italia', 'beyond_the_baltic_sea',
      'road_to_the_black_sea', 'iberia', 'west_balkans', 'greece', 'nordic_horizons'],
    cargo: ['high_power', 'heavy_cargo', 'special_transport', 'volvo_ce', 'farm_machinery',
      'forest_machinery'],
    trailer: ['kassbohrer', 'schmitz', 'wielton'],
    unownedMapCount: 10,
  },
}[GAME as 'ats' | 'ets2'];
const OWNED_MAP = new Set(SETS.map);
const OWNED_CARGO = new Set(SETS.cargo);
const OWNED_TRAILER: string[] = SETS.trailer;

const raw = await loadAllData();   // this calls initDlcData()

// ⚠️ city_dlc_map is keyed DLC → city[], NOT city → dlc[]. Inverting it the wrong way
// silently blocks nothing and leaves every unowned state in the ranking.
const blocked = new Set<string>();
for (const [dlcId, cities] of Object.entries(dlcData.CITY_DLC_MAP)) {
  if (OWNED_MAP.has(dlcId)) continue;
  for (const c of cities as string[]) blocked.add(c);
}
const ownedCargoSet = new Set([...OWNED_CARGO, ...OWNED_MAP]);
const data = applyDLCFilter(raw, OWNED_TRAILER, ownedCargoSet,
  dlcData.COMBINED_CARGO_DLC_MAP, blocked);
console.log(`blocked ${blocked.size} cities from ${SETS.unownedMapCount - OWNED_MAP.size} unowned map DLCs · `
  + `${data.cargo.length} cargo survive the pack filter\n`);
const lookups = buildLookups(data);
const rankings = calculateCityRankings(data, lookups);

const garages = dlcData.GARAGE_CITIES;
const rows = rankings.filter((r: any) => r.hasGarage && !blocked.has(r.id));
console.log(`ranked ${rankings.length} cities · ${rows.length} are buyable garages\n`);
console.log('  #  city                state        score      depots  fleet');
rows.slice(0, Number(process.env.TOP ?? 20)).forEach((r: any, i: number) => {
  const fleet = (r.fleet?.drivers ?? []).map((d: any) => `${d.count}×${d.bodyType}`).join(' ');
  console.log(`${String(i + 1).padStart(3)}  ${String(r.displayName).padEnd(20)}`
    + `${String(r.countryName).padEnd(13)}${Math.round(r.score).toLocaleString().padStart(9)}`
    + `${String(r.depotCount).padStart(8)}  ${fleet}`);
});
// FIND=id1,id2 prints those cities' ranks (default: the ATS Oklahoma City check).
for (const id of (process.env.FIND ?? 'oklahoma_cit').split(',')) {
  const i = rows.findIndex((r: any) => r.id === id);
  const r = rows[i];
  console.log(`${id} rank: ${i >= 0 ? `${i + 1} of ${rows.length} · score ${Math.round(r.score).toLocaleString()} · ${r.depotCount} depots` : 'not ranked'}`);
}
