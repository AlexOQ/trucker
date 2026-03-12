/**
 * Async wrapper around the optimizer Web Worker.
 *
 * Provides Promise-based functions that mirror the synchronous optimizer API.
 * Falls back to synchronous (main-thread) execution if Workers are unavailable.
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

  const id = ++requestId;
  const result = await postRequest({ type: 'computeFleet', id, cityId, data, lookups });
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

  const id = ++requestId;
  const result = await postRequest({ type: 'computeRankings', id, data, lookups });
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

  const id = ++requestId;
  const result = await postRequest(
    { type: 'computeDLCValues', id, rawData, dlcConfig },
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
  }
}
