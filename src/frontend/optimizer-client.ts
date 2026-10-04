/**
 * Async wrapper around the optimizer Web Worker.
 *
 * Provides Promise-based functions that mirror the synchronous optimizer API.
 * Falls back to synchronous (main-thread) execution if Workers are unavailable.
 *
 * Data lifecycle:
 *   - initWorkerData(data, lookups)  — sends AllData + Lookups once
 *   - computeFleetAsync(cityId)      — sends only cityId (data already in worker)
 *   - computeRankingsAsync()         — no payload (data already in worker)
 *   - computeDLCValuesAsync(config)  — sends only dlcConfig (data already in worker)
 *   - resetWorkerData(data, lookups) — replaces stored data (e.g., after DLC change)
 */

import type { AllData, Lookups } from './types';
import type { OptimalFleet, CityRanking } from './optimizer';
import type { DLCMarginalValue, OptimalDLCSet, DLCConfig, ScenarioSummary, UnownedDLC } from './dlc-value';
import type { WorkerRequest, WorkerResponse } from './optimizer-worker';

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<number, {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}>();

/** Tracks whether the worker has been initialized with data */
let initPromise: Promise<void> | null = null;

function getWorker(): Worker | null {
  if (worker) return worker;

  if (typeof Worker === 'undefined') return null;

  try {
    worker = new Worker(
      new URL('./optimizer-worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;

      const pending = pendingRequests.get(msg.id);
      if (!pending) return;
      pendingRequests.delete(msg.id);

      if (msg.type === 'error') {
        pending.reject(new Error(msg.message));
      } else if (msg.type === 'initResult') {
        pending.resolve(undefined);
      } else if (msg.type === 'fleetResult') {
        pending.resolve(msg.result);
      } else if (msg.type === 'rankingsResult') {
        pending.resolve(msg.result);
      } else {
        pending.resolve(msg.result);
      }
    };

    worker.onerror = (e) => {
      console.error('Optimizer worker error:', e);
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error('Worker error'));
        pendingRequests.delete(id);
      }
      // Kill the broken worker so next call falls back to sync
      worker?.terminate();
      worker = null;
      initPromise = null;
    };

    return worker;
  } catch {
    console.warn('Failed to create optimizer worker, falling back to synchronous execution');
    return null;
  }
}

function postRequest(msg: WorkerRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingRequests.set(msg.id, { resolve, reject });
    getWorker()!.postMessage(msg);
  });
}

// ============================================
// Initialization API
// ============================================

/**
 * Send AllData + Lookups to the worker once. Must be called before
 * computeFleetAsync / computeRankingsAsync. Idempotent — repeated
 * calls with the same data are no-ops.
 */
export function initWorkerData(data: AllData, lookups: Lookups | null): Promise<void> {
  const w = getWorker();
  if (!w) return Promise.resolve(); // sync fallback needs no init

  if (initPromise) return initPromise;

  const id = ++requestId;
  initPromise = postRequest({ type: 'init', id, data, lookups }) as Promise<void>;
  return initPromise;
}

/**
 * Replace stored data in the worker (e.g., after DLC ownership changes
 * require re-filtering). Resets the init state so the next compute call
 * waits for the new data.
 */
export async function resetWorkerData(data: AllData, lookups: Lookups | null): Promise<void> {
  const w = getWorker();
  if (!w) return; // sync fallback needs no reset

  const id = ++requestId;
  initPromise = postRequest({ type: 'reset', id, data, lookups }) as Promise<void>;
  await initPromise;
}

// ============================================
// Public API
// ============================================

/**
 * Compute the optimal fleet for a city garage.
 * Runs in Web Worker if available, otherwise falls back to synchronous.
 */
export async function computeFleetAsync(
  cityId: string, data: AllData, lookups: Lookups,
): Promise<OptimalFleet | null> {
  const w = getWorker();
  if (!w) {
    // Synchronous fallback
    const { computeOptimalFleet } = await import('./optimizer');
    return computeOptimalFleet(cityId, data, lookups);
  }

  // Ensure worker is initialized (auto-init on first call)
  if (!initPromise) {
    initPromise = initWorkerData(data, lookups);
  }
  await initPromise;

  const id = ++requestId;
  const result = await postRequest({ type: 'computeFleet', id, cityId });
  return result as OptimalFleet | null;
}

/**
 * Calculate city rankings using analytical EV formula.
 * Runs in Web Worker if available, otherwise falls back to synchronous.
 */
export async function computeRankingsAsync(
  data: AllData, lookups: Lookups,
): Promise<CityRanking[]> {
  const w = getWorker();
  if (!w) {
    const { calculateCityRankings } = await import('./optimizer');
    return calculateCityRankings(data, lookups);
  }

  // Ensure worker is initialized (auto-init on first call)
  if (!initPromise) {
    initPromise = initWorkerData(data, lookups);
  }
  await initPromise;

  const id = ++requestId;
  const result = await postRequest({ type: 'computeRankings', id });
  return result as CityRanking[];
}

// ============================================
// DLC scenario pool
// ============================================

/**
 * DLC scenarios are independent full re-rankings (~4 s each), so the DLC page runs them across a
 * pool of workers rather than the one above. Jobs wait in one queue; each idle worker takes the
 * next, so the marginals and the set search share the pool.
 */
interface PoolJob {
  msg: WorkerRequest;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const POOL_SIZE = Math.max(1, Math.min(8, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
let pool: { data: AllData; workers: Worker[]; ready: Promise<void> } | null = null;
const poolQueue: PoolJob[] = [];
const poolIdle: Worker[] = [];

function pumpPool(): void {
  while (poolIdle.length > 0 && poolQueue.length > 0) {
    const w = poolIdle.pop()!;
    const job = poolQueue.shift()!;
    const settle = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== job.msg.id) return;
      w.removeEventListener('message', settle);
      w.removeEventListener('error', fail);
      poolIdle.push(w);
      if (e.data.type === 'error') job.reject(new Error(e.data.message));
      else job.resolve('result' in e.data ? e.data.result : undefined);
      pumpPool();
    };
    const fail = (e: ErrorEvent) => {
      w.removeEventListener('message', settle);
      w.removeEventListener('error', fail);
      job.reject(new Error(`DLC worker error: ${e.message}`));
    };
    w.addEventListener('message', settle);
    w.addEventListener('error', fail);
    w.postMessage(job.msg);
  }
}

function submit<T>(msg: WorkerRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    poolQueue.push({ msg, resolve: resolve as (v: unknown) => void, reject });
    pumpPool();
  });
}

/** Start (or reuse) the pool with `data` loaded in every worker. */
function ensurePool(data: AllData): Promise<void> {
  if (pool?.data === data) return pool.ready;
  terminatePool();
  const workers = Array.from({ length: POOL_SIZE }, () => new Worker(
    new URL('./optimizer-worker.ts', import.meta.url),
    { type: 'module' },
  ));
  const ready = Promise.all(workers.map((w) => new Promise<void>((resolve, reject) => {
    const id = ++requestId;
    const onInit = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onInit);
      if (e.data.type === 'error') reject(new Error(e.data.message));
      else { poolIdle.push(w); pumpPool(); resolve(); }
    };
    w.addEventListener('message', onInit);
    w.postMessage({ type: 'init', id, data, lookups: null } satisfies WorkerRequest);
  }))).then(() => undefined);
  pool = { data, workers, ready };
  return ready;
}

function terminatePool(): void {
  for (const w of pool?.workers ?? []) w.terminate();
  pool = null;
  poolIdle.length = 0;
  for (const job of poolQueue.splice(0)) job.reject(new Error('DLC worker pool terminated'));
}

/**
 * Compute DLC marginal values, and optionally the best DLC set, across the worker pool.
 *
 * @param dlcNameMap - mapping from DLC ID to display name (workers return IDs only)
 */
export async function computeDLCValuesAsync(
  rawData: AllData,
  dlcConfig: DLCConfig,
  dlcNameMap: Record<string, string>,
  onProgress?: (completed: number, total: number) => void,
  /** Also search for the best DLC set: ~2N more full re-rankings. */
  withOptimalSet = false,
): Promise<{ results: DLCMarginalValue[]; optimalSet: OptimalDLCSet | null }> {
  if (typeof Worker === 'undefined') {
    // Synchronous fallback. The set search is ~2N full re-rankings, which would block the UI thread
    // for far too long, so it is worker-only — the page degrades to per-DLC marginals alone.
    const { computeAllDLCValues } = await import('./dlc-value');
    return { results: await computeAllDLCValues(rawData, onProgress), optimalSet: null };
  }

  const { ownershipFromConfig, assembleDLCValues, searchOptimalDLCSet } = await import('./dlc-value');
  const o = ownershipFromConfig(dlcConfig);
  await ensurePool(rawData);

  // Progress counts finished scenarios; the set search's total is its usual 2N + 3 estimate.
  const searchable = dlcConfig.allMapDLCIds.length + dlcConfig.allCargoDLCIds.length;
  let completed = 0;
  const total = o.unowned.length + 1 + (withOptimalSet ? searchable * 2 + 3 : 0);
  const tick = <T>(p: Promise<T>): Promise<T> => p.then((v) => {
    completed++;
    onProgress?.(Math.min(completed, total), total);
    return v;
  });

  const scenario = (dlc: UnownedDLC | null) =>
    tick(submit<ScenarioSummary>({ type: 'evalDLCScenario', id: ++requestId, dlcConfig, dlc }));
  const marginals = Promise.all([scenario(null), ...o.unowned.map(scenario)])
    .then(([baseline, ...hypos]) => assembleDLCValues(rawData, o, baseline, hypos));

  const optimal = withOptimalSet
    ? searchOptimalDLCSet(
      [
        ...dlcConfig.allMapDLCIds.map(id => ({ id, type: 'map' as const, name: id })),
        ...dlcConfig.allTrailerDLCIds.map(id => ({ id, type: 'trailer' as const, name: id })),
        ...dlcConfig.allCargoDLCIds.map(id => ({ id, type: 'cargo' as const, name: id })),
      ],
      [...dlcConfig.ownedMap, ...dlcConfig.ownedCargo],
      (sets) => Promise.all(sets.map((ids) =>
        tick(submit<number>({ type: 'scoreDLCSet', id: ++requestId, dlcConfig, ids })))),
    )
    : Promise.resolve(null);

  const [results, optimalSet] = await Promise.all([marginals, optimal]);

  // Patch display names — workers only have IDs
  for (const r of results) {
    r.dlcName = dlcNameMap[r.dlcId] ?? r.dlcId;
  }
  for (const m of optimalSet?.members ?? []) {
    m.dlcName = dlcNameMap[m.dlcId] ?? m.dlcId;
  }
  return { results, optimalSet };
}

/** Terminate the worker (e.g., on page unload). */
export function terminateWorker(): void {
  terminatePool();
  if (worker) {
    worker.terminate();
    worker = null;
    pendingRequests.clear();
    initPromise = null;
  }
}
