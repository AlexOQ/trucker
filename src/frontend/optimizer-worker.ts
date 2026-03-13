/**
 * Web Worker for optimizer computation.
 *
 * Runs computeOptimalFleet(), calculateCityRankings(), and the full
 * DLC marginal value pipeline off the main thread so the UI stays
 * responsive during heavy Monte Carlo simulations.
 *
 * Communication uses the structured clone algorithm, which handles
 * Map and Set natively — no manual serialization needed.
 */

import {
  computeOptimalFleet, calculateCityRankings, clearTrailerInfoCache,
  type OptimalFleet, type CityRanking,
} from './optimizer';
import type { AllData, Lookups } from './types';
import { sumGarageScores, type DLCMarginalValue } from './dlc-value';

// ============================================
// Message types
// ============================================

export type WorkerRequest =
  | { type: 'computeFleet'; id: number; cityId: string; data: AllData; lookups: Lookups }
  | { type: 'computeRankings'; id: number; data: AllData; lookups: Lookups }
  | { type: 'computeDLCValues'; id: number; rawData: AllData; dlcConfig: DLCConfig }

export type WorkerResponse =
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
  const garageCitiesSet = new Set(config.garageCities);

  // Active garages = intersection of owned garages and garage cities
  const activeGarages = new Set<string>();
  for (const g of ownedGarages) {
    if (garageCitiesSet.has(g)) activeGarages.add(g);
  }

  // Baseline
  const baselineCargoSet = new Set([...ownedCargo, ...ownedMap]);
  const baseline = sumGarageScores(
    rawData, ownedTrailer, baselineCargoSet, ownedMap, activeGarages,
    config.cityDlcMap, config.combinedCargoDlcMap,
  );

  const unownedMap = config.allMapDLCIds.filter(id => !ownedMap.includes(id));
  const unownedTrailer = config.allTrailerDLCIds.filter(id => !ownedTrailer.includes(id));
  const unownedCargo = config.allCargoDLCIds.filter(id => !ownedCargo.includes(id));

  // Names are patched by the client after results come back
  const allUnowned = [
    ...unownedMap.map(id => ({ id, type: 'map' as const })),
    ...unownedTrailer.map(id => ({ id, type: 'trailer' as const })),
    ...unownedCargo.map(id => ({ id, type: 'cargo' as const })),
  ];

  const results: DLCMarginalValue[] = [];
  let completed = 0;

  for (const dlc of allUnowned) {
    const hypoTrailer = dlc.type === 'trailer' ? [...ownedTrailer, dlc.id] : ownedTrailer;
    const hypoCargo = dlc.type === 'cargo' ? [...ownedCargo, dlc.id] : ownedCargo;
    const hypoMap = dlc.type === 'map' ? [...ownedMap, dlc.id] : ownedMap;
    const hypoCargoSet = new Set([...hypoCargo, ...hypoMap]);

    const hypoGarages = new Set(activeGarages);
    const newGarageCities: Array<{ id: string; name: string; score: number }> = [];

    if (dlc.type === 'map') {
      const dlcCities = config.cityDlcMap[dlc.id] || [];
      for (const cityId of dlcCities) {
        if (garageCitiesSet.has(cityId)) {
          hypoGarages.add(cityId);
        }
      }
    }

    const hypo = sumGarageScores(
      rawData, hypoTrailer, hypoCargoSet, hypoMap, hypoGarages,
      config.cityDlcMap, config.combinedCargoDlcMap,
    );

    let existingGarageDelta = 0;
    for (const g of activeGarages) {
      const baseScore = baseline.perCity.get(g) ?? 0;
      const hypoScore = hypo.perCity.get(g) ?? 0;
      existingGarageDelta += hypoScore - baseScore;
    }

    let newCityPotential = 0;
    if (dlc.type === 'map') {
      const dlcCities = config.cityDlcMap[dlc.id] || [];
      for (const cityId of dlcCities) {
        if (garageCitiesSet.has(cityId) && !activeGarages.has(cityId)) {
          const score = hypo.perCity.get(cityId) ?? 0;
          newCityPotential += score;
          newGarageCities.push({
            id: cityId,
            name: rawData.cities.find(c => c.id === cityId)?.name ?? cityId,
            score,
          });
        }
      }
      newGarageCities.sort((a, b) => b.score - a.score);
    }

    results.push({
      dlcId: dlc.id,
      dlcName: dlc.id,  // placeholder — client patches with real name
      dlcType: dlc.type,
      totalDelta: hypo.total - baseline.total,
      existingGarageDelta,
      newCityPotential,
      newGarageCities,
    });

    completed++;
    postProgress(completed, allUnowned.length);
  }

  clearTrailerInfoCache();
  results.sort((a, b) => b.totalDelta - a.totalDelta);
  return results;
}

// ============================================
// Message handler
// ============================================

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'computeFleet': {
        const result = computeOptimalFleet(msg.cityId, msg.data, msg.lookups);
        self.postMessage({ type: 'fleetResult', id: msg.id, result } satisfies WorkerResponse);
        break;
      }

      case 'computeRankings': {
        const result = calculateCityRankings(msg.data, msg.lookups);
        self.postMessage({ type: 'rankingsResult', id: msg.id, result } satisfies WorkerResponse);
        break;
      }

      case 'computeDLCValues': {
        const result = computeDLCValuesInWorker(
          msg.rawData,
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
