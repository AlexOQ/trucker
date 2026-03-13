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
import type { DLCMarginalValue } from './dlc-value';
import type { WorkerRequest, WorkerResponse, DLCConfig } from './optimizer-worker';

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<number, {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onProgress?: (completed: number, total: number) => void;
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

      if (msg.type === 'dlcProgress') {
        const pending = pendingRequests.get(msg.id);
        pending?.onProgress?.(msg.completed, msg.total);
        return;
      }

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
      } else if (msg.type === 'dlcValuesResult') {
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

function postRequest(msg: WorkerRequest, onProgress?: (completed: number, total: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingRequests.set(msg.id, { resolve, reject, onProgress });
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

/**
 * Compute DLC marginal values entirely in the worker.
 * The worker runs the full loop: for each unowned DLC, apply filter + build lookups + rank.
 *
 * @param dlcNameMap - mapping from DLC ID to display name (worker returns IDs only)
 */
export async function computeDLCValuesAsync(
  rawData: AllData,
  dlcConfig: DLCConfig,
  dlcNameMap: Record<string, string>,
  onProgress?: (completed: number, total: number) => void,
): Promise<DLCMarginalValue[]> {
  const w = getWorker();
  if (!w) {
    // Synchronous fallback — use the original implementation
    const { computeAllDLCValues } = await import('./dlc-value');
    return computeAllDLCValues(rawData, onProgress);
  }

  // Ensure worker has the raw data (auto-init with lookups=null for DLC page)
  if (!initPromise) {
    initPromise = initWorkerData(rawData, null);
  }
  await initPromise;

  const id = ++requestId;
  const result = await postRequest(
    { type: 'computeDLCValues', id, dlcConfig },
    onProgress,
  );

  // Patch display names — worker only has IDs
  const results = result as DLCMarginalValue[];
  for (const r of results) {
    r.dlcName = dlcNameMap[r.dlcId] ?? r.dlcId;
  }
  return results;
}

/** Terminate the worker (e.g., on page unload). */
export function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    pendingRequests.clear();
    initPromise = null;
  }
}
