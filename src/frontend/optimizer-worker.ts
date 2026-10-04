/**
 * Web Worker for optimizer computation.
 *
 * Runs computeOptimalFleet(), calculateCityRankings(), and single DLC
 * scenarios off the main thread so the UI stays
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
import {
  evaluateDLCScenario, ownershipFromConfig,
  type DLCConfig, type ScenarioSummary, type DLCToggle,
} from './dlc-value';

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
  | { type: 'evalDLCScenario'; id: number; dlcConfig: DLCConfig; dlc: DLCToggle | null }

export type WorkerResponse =
  | { type: 'initResult'; id: number }
  | { type: 'fleetResult'; id: number; result: OptimalFleet | null }
  | { type: 'rankingsResult'; id: number; result: CityRanking[] }
  | { type: 'dlcScenarioResult'; id: number; result: ScenarioSummary }
  | { type: 'error'; id: number; message: string }

export type { DLCConfig } from './dlc-value';

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

      case 'evalDLCScenario': {
        if (!storedData) {
          throw new Error('Worker not initialized — send "init" before evalDLCScenario');
        }
        const result = evaluateDLCScenario(storedData, ownershipFromConfig(msg.dlcConfig), msg.dlc);
        self.postMessage({ type: 'dlcScenarioResult', id: msg.id, result } satisfies WorkerResponse);
        break;
      }

    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: 'error', id: msg.id, message } satisfies WorkerResponse);
  }
};
