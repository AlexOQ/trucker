/**
 * Precompute the best DLC set per game: the SMALLEST set of map, cargo and trailer DLCs that reaches
 * the highest max-fleet earnings under the 354-driver cap. It depends only on the game data — every
 * purchasable city is scored, whatever the player owns — so it ships as data and the DLC page only
 * highlights it (#327).
 *
 * Usage: npm run gen:best-dlc-set   (both games; one process each — loader and dlc-data hold
 *        module state per game), or npx tsx scripts/gen-best-dlc-set.mts <ets2|ats>
 * Rerun whenever public/data/<game>/game-defs.json changes; a test fails while the file's
 * game_version lags data-version.json.
 *
 * 1. Optimum: `searchOptimalDLCSet` over map and cargo DLCs, every trailer brand owned.
 * 2. Noise floor: re-score every single-DLC toggle around the optimum under SALTS seeds. A city's
 *    Monte Carlo is seeded by its id, so the page sees one draw of each delta; the floor is twice the
 *    LARGEST seed-to-seed standard deviation, so no toggle's noise reads as value. The page shows a
 *    delta under it as "≈ 0". (Twice the median let West Balkans through at +19 on a 15 floor.)
 * 3. Smallest set: from optimum + every trailer brand, drop the member whose removal costs least
 *    while that cost stays under the floor and the set stays within the floor of the optimum.
 *
 * Scenarios run across a worker_threads pool; the same file is the worker.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALTS = 8;

interface Registry { maps: string[]; trailers: string[]; cargo: string[] }

/** Stub `fetch` (reads public/ off disk) and `localStorage` (selects the game), like rank-garages.mts. */
async function loadGame(game: string) {
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
  const raw = await loadAllData();
  return { raw, dlc };
}

if (!isMainThread) {
  // Worker: score { owned, salt } → max-fleet (capped) total.
  const { raw, dlc } = await loadGame(workerData.game);
  const { sumGarageScores } = await import('../src/frontend/dlc-value.js');
  const { setMcSeedSalt } = await import('../src/frontend/optimizer.js');
  const maps = new Set<string>(dlc.ALL_MAP_DLC_IDS);
  const trailers = new Set<string>(dlc.ALL_DLC_IDS);
  parentPort!.on('message', ({ id, owned, salt }: { id: number; owned: string[]; salt: number }) => {
    setMcSeedSalt(salt);
    const tr = owned.filter(x => trailers.has(x));
    const mp = owned.filter(x => maps.has(x));
    const cargo = owned.filter(x => !trailers.has(x) && !maps.has(x));
    const r = sumGarageScores(raw, tr, new Set([...cargo, ...mp]), mp, new Set(), dlc.CITY_DLC_MAP, dlc.COMBINED_CARGO_DLC_MAP, dlc.GARAGE_CITIES);
    parentPort!.postMessage({ id, score: r.cappedTotal });
  });
  const registry: Registry = { maps: [...maps], trailers: [...trailers], cargo: [...dlc.ALL_CARGO_DLC_IDS] };
  parentPort!.postMessage({ ready: true, registry });
} else {
  const game = process.argv[2];
  if (game !== 'ets2' && game !== 'ats') {
    console.error('usage: gen-best-dlc-set.mts <ets2|ats>');
    process.exit(2);
  }
  const t0 = performance.now();

  // Pool: one queue, each idle worker takes the next scenario.
  let registry!: Registry;
  let nextId = 0;
  const waiting = new Map<number, (score: number) => void>();
  const idle: Worker[] = [];
  const queue: Array<{ id: number; owned: string[]; salt: number }> = [];
  const pump = () => { while (idle.length > 0 && queue.length > 0) idle.pop()!.postMessage(queue.shift()); };
  const workers = await Promise.all(Array.from({ length: Math.max(1, os.availableParallelism() - 1) }, () =>
    new Promise<Worker>((resolve, reject) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { game }, execArgv: ['--import', 'tsx'] });
      w.on('message', (m: { ready?: boolean; registry?: Registry; id?: number; score?: number }) => {
        if (m.ready) { registry = m.registry!; idle.push(w); pump(); resolve(w); return; }
        waiting.get(m.id!)!(m.score!);
        waiting.delete(m.id!);
        idle.push(w);
        pump();
      });
      w.on('error', reject);
    })));
  const memo = new Map<string, Promise<number>>();
  const score = (owned: string[], salt = 0): Promise<number> => {
    const key = `${salt}|${[...owned].sort().join(',')}`;
    if (!memo.has(key)) {
      memo.set(key, new Promise((resolve) => {
        const id = ++nextId;
        waiting.set(id, resolve);
        queue.push({ id, owned: [...owned], salt });
        pump();
      }));
    }
    return memo.get(key)!;
  };

  const { searchOptimalDLCSet } = await import('../src/frontend/dlc-value.js');
  const all = [
    ...registry.maps.map(id => ({ id, type: 'map' as const, name: id })),
    ...registry.trailers.map(id => ({ id, type: 'trailer' as const, name: id })),
    ...registry.cargo.map(id => ({ id, type: 'cargo' as const, name: id })),
  ];
  const ids = all.map(d => d.id);
  const toggle = (set: string[], id: string) => (set.includes(id) ? set.filter(x => x !== id) : [...set, id]);

  // 1. Optimum over map + cargo, every trailer brand owned.
  const optimum = await searchOptimalDLCSet(all, [], (sets) =>
    Promise.all(sets.map(s => score([...s, ...registry.trailers]))));
  const start = [...optimum.optimalIds];   // includes every trailer brand
  const maxTotal = await score(start);

  // 2. Noise floor: each toggle's delta under SALTS seeds; twice the largest spread.
  const spreads: number[] = [];
  await Promise.all(ids.map(async (id) => {
    const deltas = await Promise.all(Array.from({ length: SALTS }, async (_, s) =>
      (await score(toggle(start, id), s * 7919)) - (await score(start, s * 7919))));
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / (deltas.length - 1));
    if (sd > 0) spreads.push(sd);
  }));
  const floor = 2 * Math.max(...spreads);

  // 3. Smallest set: drop the cheapest member while its removal is noise and the set stays near the optimum.
  let best = start;
  let bestTotal = maxTotal;
  for (;;) {
    const trials = await Promise.all(best.map(async id => ({ id, total: await score(best.filter(x => x !== id)) })));
    trials.sort((a, b) => b.total - a.total);
    const cheapest = trials[0];
    if (!cheapest || bestTotal - cheapest.total > floor || maxTotal - cheapest.total > floor) break;
    best = best.filter(x => x !== cheapest.id);
    bestTotal = cheapest.total;
  }

  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', game, 'data-version.json'), 'utf-8'));
  const out = { game_version: version.game_version, noise_floor: Math.round(floor), best: [...best].sort() };
  fs.writeFileSync(path.join(ROOT, 'public/data', game, 'best-dlc-set.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`${game}: ${best.length} DLCs (${best.filter(x => registry.trailers.includes(x)).length} trailer), `
    + `${Math.round(bestTotal)} vs optimum ${Math.round(maxTotal)}, noise floor ${floor.toFixed(1)} EV, `
    + `${memo.size} scenarios, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  for (const w of workers) await w.terminate();
}
