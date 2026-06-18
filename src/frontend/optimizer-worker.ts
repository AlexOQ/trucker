/**
 * Web Worker for optimizer computation.
 *
 * Runs computeOptimalFleet(), calculateCityRankings(), and the full
 * DLC marginal value pipeline off the main thread so the UI stays
 * responsive during heavy Monte Carlo simulations.
 *
 * Communication uses the structured clone algorithm, which handles
 * Map and Set natively — no manual serialization needed.
 *
 * Data lifecycle:
 *   1. Client sends `init` with AllData + Lookups (once per page load)
 *   2. Subsequent calls (`computeFleet`, etc.) use stored data
 *   3. `reset` replaces stored data (e.g., after DLC settings change)
 */

import {
  computeOptimalFleet, calculateCityRankings,
  type OptimalFleet, type CityRanking,
} from './optimizer';
import type { AllData, Lookups } from './types';
import { computeDLCValuesCore, type DLCMarginalValue } from './dlc-value';

// ============================================
// Module-level data store
// ============================================

let storedData: AllData | null = null;
let storedLookups: Lookups | null = null;

// ============================================
// Message types
// ============================================

export type WorkerRequest =
  | { type: 'init'; id: number; data: AllData; lookups: Lookups | null }
  | { type: 'reset'; id: number; data: AllData; lookups: Lookups | null }
  | { type: 'computeFleet'; id: number; cityId: string }
  | { type: 'computeRankings'; id: number }
  | { type: 'computeDLCValues'; id: number; dlcConfig: DLCConfig }

export type WorkerResponse =
  | { type: 'initResult'; id: number }
  | { type: 'fleetResult'; id: number; result: OptimalFleet | null }
  | { type: 'rankingsResult'; id: number; result: CityRanking[] }
  | { type: 'dlcValuesResult'; id: number; result: DLCMarginalValue[] }
  | { type: 'dlcProgress'; id: number; completed: number; total: number }
  | { type: 'error'; id: number; message: string }

/** DLC ownership state needed to run marginal value calculation */
export interface DLCConfig {
  ownedTrailer: string[];
  ownedCargo: string[];
  ownedMap: string[];
  ownedGarages: string[];
  // DLC registries
  allTrailerDLCIds: string[];
  allCargoDLCIds: string[];
  allMapDLCIds: string[];
  cityDlcMap: Record<string, string[]>;
  combinedCargoDlcMap: Record<string, string>;
  garageCities: string[];
}

// ============================================
// DLC marginal value (worker-side)
// ============================================

function computeDLCValuesInWorker(
  rawData: AllData,
  config: DLCConfig,
  postProgress: (completed: number, total: number) => void,
): DLCMarginalValue[] {
  const { ownedTrailer, ownedCargo, ownedMap, ownedGarages } = config;
  const garageCities = new Set(config.garageCities);

  // Active garages = intersection of owned garages and garage cities
  const activeGarages = new Set<string>();
  for (const g of ownedGarages) {
    if (garageCities.has(g)) activeGarages.add(g);
  }

  // Names are id placeholders — the client patches them after results return
  // (the worker has no DLC name maps).
  const unowned = [
    ...config.allMapDLCIds.filter(id => !ownedMap.includes(id)).map(id => ({ id, type: 'map' as const, name: id })),
    ...config.allTrailerDLCIds.filter(id => !ownedTrailer.includes(id)).map(id => ({ id, type: 'trailer' as const, name: id })),
    ...config.allCargoDLCIds.filter(id => !ownedCargo.includes(id)).map(id => ({ id, type: 'cargo' as const, name: id })),
  ];

  return computeDLCValuesCore(rawData, {
    ownedTrailer, ownedCargo, ownedMap, activeGarages, garageCities, unowned,
    cityDlcMap: config.cityDlcMap, combinedCargoDlcMap: config.combinedCargoDlcMap,
  }, postProgress);
}

// ============================================
// Message handler
// ============================================

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'init':
      case 'reset': {
        storedData = msg.data;
        storedLookups = msg.lookups;
        self.postMessage({ type: 'initResult', id: msg.id } satisfies WorkerResponse);
        break;
      }

      case 'computeFleet': {
        if (!storedData || !storedLookups) {
          throw new Error('Worker not initialized — send "init" before computeFleet');
        }
        const result = computeOptimalFleet(msg.cityId, storedData, storedLookups);
        self.postMessage({ type: 'fleetResult', id: msg.id, result } satisfies WorkerResponse);
        break;
      }

      case 'computeRankings': {
        if (!storedData || !storedLookups) {
          throw new Error('Worker not initialized — send "init" before computeRankings');
        }
        const result = calculateCityRankings(storedData, storedLookups);
        self.postMessage({ type: 'rankingsResult', id: msg.id, result } satisfies WorkerResponse);
        break;
      }

      case 'computeDLCValues': {
        if (!storedData) {
          throw new Error('Worker not initialized — send "init" before computeDLCValues');
        }
        const result = computeDLCValuesInWorker(
          storedData,
          msg.dlcConfig,
          (completed, total) => {
            self.postMessage({ type: 'dlcProgress', id: msg.id, completed, total } satisfies WorkerResponse);
          },
        );
        self.postMessage({ type: 'dlcValuesResult', id: msg.id, result } satisfies WorkerResponse);
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: 'error', id: msg.id, message } satisfies WorkerResponse);
  }
};
