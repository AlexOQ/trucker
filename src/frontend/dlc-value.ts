/**
 * DLC Marginal Value Calculator
 *
 * For each unowned DLC, computes the fleet EV delta if the player were to own it.
 * Uses analytical rankings (fast) rather than full MC simulation.
 */

import { applyDLCFilter, buildLookups, getBlockedCities, type AllData } from './data';
import { calculateCityRankings, clearTrailerInfoCache } from './optimizer';
import {
  TRAILER_DLCS, ALL_DLC_IDS,
  CARGO_DLCS, ALL_CARGO_DLC_IDS,
  MAP_DLCS, ALL_MAP_DLC_IDS,
  CITY_DLC_MAP, COMBINED_CARGO_DLC_MAP,
  GARAGE_CITIES,
  getOwnedTrailerDLCs, getOwnedCargoDLCs, getOwnedMapDLCs,
  getOwnedGarages,
} from './storage';

export interface DLCMarginalValue {
  dlcId: string;
  dlcName: string;
  dlcType: 'map' | 'trailer' | 'cargo';
  totalDelta: number;
  existingGarageDelta: number;
  newCityPotential: number;
  newGarageCities: Array<{ id: string; name: string; score: number }>;
}

function sumGarageScores(
  rawData: AllData,
  ownedTrailer: string[],
  ownedCargoAndMap: Set<string>,
  ownedMap: string[],
  garageCityIds: Set<string>,
): { total: number; perCity: Map<string, number> } {
  const blocked = getBlockedCities(ownedMap, CITY_DLC_MAP);
  const filtered = applyDLCFilter(rawData, ownedTrailer, ownedCargoAndMap, COMBINED_CARGO_DLC_MAP, blocked);
  const lookups = buildLookups(filtered);
  clearTrailerInfoCache();
  const rankings = calculateCityRankings(filtered, lookups);

  let total = 0;
  const perCity = new Map<string, number>();
  for (const r of rankings) {
    perCity.set(r.id, r.score);
    if (garageCityIds.has(r.id)) {
      total += r.score;
    }
  }
  return { total, perCity };
}

/**
 * Compute marginal EV delta for every unowned DLC.
 * Calls onProgress(completed, total) between each DLC evaluation.
 */
export async function computeAllDLCValues(
  rawData: AllData,
  onProgress?: (completed: number, total: number) => void,
): Promise<DLCMarginalValue[]> {
  const ownedTrailer = getOwnedTrailerDLCs();
  const ownedCargo = getOwnedCargoDLCs();
  const ownedMap = getOwnedMapDLCs();
  const ownedGarages = new Set(getOwnedGarages());

  // Garage cities the player currently uses (intersection of owned garages and GARAGE_CITIES)
  const activeGarages = new Set<string>();
  for (const g of ownedGarages) {
    if (GARAGE_CITIES.has(g)) activeGarages.add(g);
  }

  // Baseline with current DLC ownership
  const baselineCargoSet = new Set([...ownedCargo, ...ownedMap]);
  const baseline = sumGarageScores(rawData, ownedTrailer, baselineCargoSet, ownedMap, activeGarages);

  const unownedMap = ALL_MAP_DLC_IDS.filter(id => !ownedMap.includes(id));
  const unownedTrailer = ALL_DLC_IDS.filter(id => !ownedTrailer.includes(id));
  const unownedCargo = ALL_CARGO_DLC_IDS.filter(id => !ownedCargo.includes(id));

  const allUnowned = [
    ...unownedMap.map(id => ({ id, type: 'map' as const, name: MAP_DLCS[id] })),
    ...unownedTrailer.map(id => ({ id, type: 'trailer' as const, name: TRAILER_DLCS[id] })),
    ...unownedCargo.map(id => ({ id, type: 'cargo' as const, name: CARGO_DLCS[id] })),
  ];

  const results: DLCMarginalValue[] = [];
  let completed = 0;

  for (const dlc of allUnowned) {
    // Build hypothetical ownership
    const hypoTrailer = dlc.type === 'trailer' ? [...ownedTrailer, dlc.id] : ownedTrailer;
    const hypoCargo = dlc.type === 'cargo' ? [...ownedCargo, dlc.id] : ownedCargo;
    const hypoMap = dlc.type === 'map' ? [...ownedMap, dlc.id] : ownedMap;
    const hypoCargoSet = new Set([...hypoCargo, ...hypoMap]);

    // For map DLCs: new garage cities become available
    const hypoGarages = new Set(activeGarages);
    const newGarageCities: Array<{ id: string; name: string; score: number }> = [];

    if (dlc.type === 'map') {
      const dlcCities = CITY_DLC_MAP[dlc.id] || [];
      for (const cityId of dlcCities) {
        if (GARAGE_CITIES.has(cityId)) {
          hypoGarages.add(cityId);
        }
      }
    }

    const hypo = sumGarageScores(rawData, hypoTrailer, hypoCargoSet, hypoMap, hypoGarages);

    // Existing garage delta = improvement at current garages only
    let existingGarageDelta = 0;
    for (const g of activeGarages) {
      const baseScore = baseline.perCity.get(g) ?? 0;
      const hypoScore = hypo.perCity.get(g) ?? 0;
      existingGarageDelta += hypoScore - baseScore;
    }

    // New city potential (map DLCs only)
    let newCityPotential = 0;
    if (dlc.type === 'map') {
      const dlcCities = CITY_DLC_MAP[dlc.id] || [];
      for (const cityId of dlcCities) {
        if (GARAGE_CITIES.has(cityId) && !activeGarages.has(cityId)) {
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
      dlcName: dlc.name,
      dlcType: dlc.type,
      totalDelta: hypo.total - baseline.total,
      existingGarageDelta,
      newCityPotential,
      newGarageCities,
    });

    completed++;
    onProgress?.(completed, allUnowned.length);

    // Yield to UI between iterations
    if (completed % 3 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Clean up cache state
  clearTrailerInfoCache();

  results.sort((a, b) => b.totalDelta - a.totalDelta);
  return results;
}
