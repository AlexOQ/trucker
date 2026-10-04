/**
 * Precompute the best DLC set per game — the map and cargo DLCs that maximise max-fleet earnings
 * under the 354-driver cap. It depends only on the game data: the search scores every purchasable
 * city with every trailer DLC, whatever the player owns. So it ships as data, and the DLC page only
 * highlights it (#327).
 *
 * Usage: npm run gen:best-dlc-set   (both games; one process each — loader and dlc-data hold
 *        module state per game), or npx tsx scripts/gen-best-dlc-set.mts <ets2|ats>
 * Rerun whenever public/data/<game>/game-defs.json changes; a test fails while the file's
 * game_version lags data-version.json.
 *
 * Stubs `fetch` (reads public/ off disk) and `localStorage` (selects the game), like rank-garages.mts.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const game = process.argv[2];
if (game !== 'ets2' && game !== 'ats') {
  console.error('usage: gen-best-dlc-set.mts <ets2|ats>');
  process.exit(2);
}

{
  const store: Record<string, string> = { 'trucker-game': game };
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
  // `export let` + reassignment in initDlcData — hold the namespace, read after loadAllData().
  const dlc = await import('../src/frontend/dlc-data.js');
  const { ownershipFromConfig, searchOptimalDLCSet, scoreDLCSet } = await import('../src/frontend/dlc-value.js');

  const raw = await loadAllData();
  const config = {
    ownedTrailer: [] as string[], ownedCargo: [] as string[], ownedMap: [] as string[], ownedGarages: [] as string[],
    allTrailerDLCIds: [...dlc.ALL_DLC_IDS], allCargoDLCIds: [...dlc.ALL_CARGO_DLC_IDS], allMapDLCIds: [...dlc.ALL_MAP_DLC_IDS],
    cityDlcMap: dlc.CITY_DLC_MAP, combinedCargoDlcMap: dlc.COMBINED_CARGO_DLC_MAP, garageCities: [...dlc.GARAGE_CITIES],
  };
  const o = ownershipFromConfig(config);
  const mapIds = new Set(config.allMapDLCIds);
  const all = [
    ...config.allMapDLCIds.map((id: string) => ({ id, type: 'map' as const, name: id })),
    ...config.allTrailerDLCIds.map((id: string) => ({ id, type: 'trailer' as const, name: id })),
    ...config.allCargoDLCIds.map((id: string) => ({ id, type: 'cargo' as const, name: id })),
  ];

  const t0 = performance.now();
  const set = await searchOptimalDLCSet(all, [], async (sets: string[][]) =>
    sets.map(ids => scoreDLCSet(raw, o, config.allTrailerDLCIds, mapIds, ids)));

  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', game, 'data-version.json'), 'utf-8'));
  const best = set.members.filter((m: { dlcType: string; inOptimalSet: boolean }) => m.dlcType !== 'trailer' && m.inOptimalSet)
    .map((m: { dlcId: string }) => m.dlcId).sort();
  const out = { game_version: version.game_version, best };
  fs.writeFileSync(path.join(ROOT, 'public/data', game, 'best-dlc-set.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`${game}: ${best.length} of ${all.length - config.allTrailerDLCIds.length} map+cargo DLCs in the best set `
    + `(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}
