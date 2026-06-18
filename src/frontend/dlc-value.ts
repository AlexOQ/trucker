/**
 * DLC Marginal Value Calculator
 *
 * For each unowned DLC, computes the fleet EV delta if the player were to own it.
 * Re-runs the city rankings (reduced-sample MC, seeded per city) per scenario.
 *
 * Trailer DLCs additionally carry a per-body-type breakdown (#257): which body
 * types the DLC's trailers now win, the trailer you'd otherwise use, and the
 * haul-value margin. This is a STRUCTURAL diagnostic (winner vs runner-up HV
 * across your garages' countries) — it explains where the value comes from and
 * intentionally does NOT sum to `totalDelta`, which is garage-scoped EV (folds
 * in spawn probability + contention) rather than raw HV.
 */

import { applyDLCFilter, buildLookups, getBlockedCities, type AllData, type Lookups } from './data';
import {
  calculateCityRankings, clearTrailerInfoCache,
  computeProfileTrailerInfoForCountry, bodyTypeDisplayName,
  type ProfileTrailerInfo,
} from './optimizer';
import {
  TRAILER_DLCS, ALL_DLC_IDS,
  CARGO_DLCS, ALL_CARGO_DLC_IDS,
  MAP_DLCS, ALL_MAP_DLC_IDS,
  CITY_DLC_MAP, COMBINED_CARGO_DLC_MAP,
  GARAGE_CITIES,
  getOwnedTrailerDLCs, getOwnedCargoDLCs, getOwnedMapDLCs,
  getOwnedGarages,
} from './storage';

/** A body-type profile a trailer DLC now wins, vs what you'd use without it. */
export interface BodyTypeWinDelta {
  bodyType: string;                    // primary body type (profile's first body type)
  displayName: string;                 // profile display label (multi-body joined with " + ")
  winnerTrailerSpec: string;           // the DLC trailer that now wins this profile
  runnerUpTrailerSpec: string | null;  // best non-DLC trailer for this profile (null if none existed)
  marginHV: number;                    // winner totalHV − runner-up totalHV (max across your garage countries)
  countries: number;                   // # of your garage countries where the DLC wins this profile
}

export interface DLCMarginalValue {
  dlcId: string;
  dlcName: string;
  dlcType: 'map' | 'trailer' | 'cargo';
  totalDelta: number;
  existingGarageDelta: number;
  newCityPotential: number;
  newGarageCities: Array<{ id: string; name: string; score: number }>;
  /** Trailer DLCs only — structural per-body-type win breakdown (#257). */
  bodyTypeBreakdown?: BodyTypeWinDelta[];
}

/** Ownership scenario for the shared core — assembled from storage (main thread) or worker config. */
export interface DLCValueOwnership {
  ownedTrailer: string[];
  ownedCargo: string[];
  ownedMap: string[];
  activeGarages: Set<string>;
  /** All purchasable-garage city ids. Passed in (not read from the storage
   *  GARAGE_CITIES export) so the worker — where initDlcData never ran — uses
   *  its config copy. */
  garageCities: ReadonlySet<string>;
  unowned: Array<{ id: string; type: 'map' | 'trailer' | 'cargo'; name: string }>;
  cityDlcMap: Record<string, string[]>;
  combinedCargoDlcMap: Record<string, string>;
}

interface ScenarioResult {
  total: number;
  perCity: Map<string, number>;
  filtered: AllData;
  lookups: Lookups;
}

/**
 * Compute total garage score and per-city scores for a given DLC ownership scenario.
 * Pure computation — takes all DLC maps as parameters so it works in both
 * the main thread and the Web Worker. Returns the filtered data + lookups it
 * builds so callers can diff per-(profile, country) winners across scenarios.
 */
export function sumGarageScores(
  rawData: AllData,
  ownedTrailer: string[],
  ownedCargoAndMap: Set<string>,
  ownedMap: string[],
  garageCityIds: Set<string>,
  cityDlcMap: Record<string, string[]>,
  combinedCargoDlcMap: Record<string, string>,
): ScenarioResult {
  const blocked = getBlockedCities(ownedMap, cityDlcMap);
  const filtered = applyDLCFilter(rawData, ownedTrailer, ownedCargoAndMap, combinedCargoDlcMap, blocked);
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
  return { total, perCity, filtered, lookups };
}

/** Distinct countries of the active garage cities. */
function garageCountriesOf(rawData: AllData, activeGarages: Set<string>): string[] {
  const countries = new Set<string>();
  for (const c of rawData.cities) {
    if (activeGarages.has(c.id)) countries.add(c.country);
  }
  return [...countries];
}

/**
 * Per-body-type breakdown for a trailer DLC: across the player's garage countries,
 * find profiles whose best trailer's total HV rose when the DLC was added, and
 * report the DLC winner, the prior best (runner-up), and the HV margin. Diffs the
 * baseline scenario's per-country winners against the hypothetical's. The only
 * trailers hypo adds over baseline are this DLC's, so any HV increase is attributable
 * to it.
 */
function computeBodyTypeBreakdown(
  baselineProfiles: Map<string, Map<string, ProfileTrailerInfo>>,
  hypo: ScenarioResult,
  garageCountries: string[],
): BodyTypeWinDelta[] {
  const agg = new Map<string, {
    bodyTypes: string[]; winnerSpec: string; runnerUpSpec: string | null;
    maxMargin: number; countries: Set<string>;
  }>();

  for (const country of garageCountries) {
    const baseInfo = baselineProfiles.get(country);
    if (!baseInfo) continue;
    const hypoInfo = computeProfileTrailerInfoForCountry(country, hypo.filtered, hypo.lookups);
    for (const [key, hypoRep] of hypoInfo) {
      const baseRep = baseInfo.get(key);
      const baseHV = baseRep ? baseRep.totalHV : 0;
      const margin = hypoRep.totalHV - baseHV;
      if (margin <= 1e-6) continue; // DLC didn't raise this profile's best HV here

      let a = agg.get(key);
      if (!a) {
        a = { bodyTypes: hypoRep.bodyTypes, winnerSpec: hypoRep.trailerSpec, runnerUpSpec: baseRep?.trailerSpec ?? null, maxMargin: margin, countries: new Set() };
        agg.set(key, a);
      }
      a.countries.add(country);
      if (margin > a.maxMargin) {
        a.maxMargin = margin;
        a.winnerSpec = hypoRep.trailerSpec;
        a.runnerUpSpec = baseRep?.trailerSpec ?? null;
      }
    }
  }

  const out: BodyTypeWinDelta[] = [];
  for (const a of agg.values()) {
    out.push({
      bodyType: a.bodyTypes[0],
      displayName: a.bodyTypes.map(bodyTypeDisplayName).join(' + '),
      winnerTrailerSpec: a.winnerSpec,
      runnerUpTrailerSpec: a.runnerUpSpec,
      marginHV: Math.round(a.maxMargin),
      countries: a.countries.size,
    });
  }
  out.sort((x, y) => y.marginHV - x.marginHV);
  return out;
}

/**
 * Shared per-DLC computation used by both the main-thread calculator and the
 * Web Worker — the single source of truth for the marginal-value math. Synchronous;
 * the main-thread fallback wraps it (the worker path is the normal one and doesn't
 * block the UI).
 */
export function computeDLCValuesCore(
  rawData: AllData,
  o: DLCValueOwnership,
  onProgress?: (completed: number, total: number) => void,
): DLCMarginalValue[] {
  const baselineCargoSet = new Set([...o.ownedCargo, ...o.ownedMap]);
  const baseline = sumGarageScores(rawData, o.ownedTrailer, baselineCargoSet, o.ownedMap, o.activeGarages, o.cityDlcMap, o.combinedCargoDlcMap);

  const garageCountries = garageCountriesOf(rawData, o.activeGarages);
  // Baseline per-(profile, country) winners — computed once, diffed against each hypo.
  const baselineProfiles = new Map<string, Map<string, ProfileTrailerInfo>>();
  for (const country of garageCountries) {
    baselineProfiles.set(country, computeProfileTrailerInfoForCountry(country, baseline.filtered, baseline.lookups));
  }

  const results: DLCMarginalValue[] = [];
  let completed = 0;

  for (const dlc of o.unowned) {
    const hypoTrailer = dlc.type === 'trailer' ? [...o.ownedTrailer, dlc.id] : o.ownedTrailer;
    const hypoCargo = dlc.type === 'cargo' ? [...o.ownedCargo, dlc.id] : o.ownedCargo;
    const hypoMap = dlc.type === 'map' ? [...o.ownedMap, dlc.id] : o.ownedMap;
    const hypoCargoSet = new Set([...hypoCargo, ...hypoMap]);

    const hypoGarages = new Set(o.activeGarages);
    const newGarageCities: Array<{ id: string; name: string; score: number }> = [];

    if (dlc.type === 'map') {
      for (const cityId of o.cityDlcMap[dlc.id] || []) {
        if (o.garageCities.has(cityId)) hypoGarages.add(cityId);
      }
    }

    const hypo = sumGarageScores(rawData, hypoTrailer, hypoCargoSet, hypoMap, hypoGarages, o.cityDlcMap, o.combinedCargoDlcMap);

    // Existing garage delta = improvement at current garages only
    let existingGarageDelta = 0;
    for (const g of o.activeGarages) {
      existingGarageDelta += (hypo.perCity.get(g) ?? 0) - (baseline.perCity.get(g) ?? 0);
    }

    // New city potential (map DLCs only)
    let newCityPotential = 0;
    if (dlc.type === 'map') {
      for (const cityId of o.cityDlcMap[dlc.id] || []) {
        if (o.garageCities.has(cityId) && !o.activeGarages.has(cityId)) {
          const score = hypo.perCity.get(cityId) ?? 0;
          newCityPotential += score;
          newGarageCities.push({
            id: cityId,
            name: rawData.cities.find(c => c.id === cityId)?.displayName ?? cityId,
            score,
          });
        }
      }
      newGarageCities.sort((a, b) => b.score - a.score);
    }

    const result: DLCMarginalValue = {
      dlcId: dlc.id,
      dlcName: dlc.name,
      dlcType: dlc.type,
      totalDelta: hypo.total - baseline.total,
      existingGarageDelta,
      newCityPotential,
      newGarageCities,
    };

    if (dlc.type === 'trailer' && garageCountries.length > 0) {
      const breakdown = computeBodyTypeBreakdown(baselineProfiles, hypo, garageCountries);
      if (breakdown.length > 0) result.bodyTypeBreakdown = breakdown;
    }

    results.push(result);
    completed++;
    onProgress?.(completed, o.unowned.length);
  }

  clearTrailerInfoCache();
  results.sort((a, b) => b.totalDelta - a.totalDelta);
  return results;
}

/**
 * Main-thread entry point (synchronous-fallback path when no Web Worker).
 * Reads ownership from storage and delegates to the shared core.
 */
export async function computeAllDLCValues(
  rawData: AllData,
  onProgress?: (completed: number, total: number) => void,
): Promise<DLCMarginalValue[]> {
  const ownedTrailer = getOwnedTrailerDLCs();
  const ownedCargo = getOwnedCargoDLCs();
  const ownedMap = getOwnedMapDLCs();

  const activeGarages = new Set<string>();
  for (const g of getOwnedGarages()) {
    if (GARAGE_CITIES.has(g)) activeGarages.add(g);
  }

  const unowned = [
    ...ALL_MAP_DLC_IDS.filter(id => !ownedMap.includes(id)).map(id => ({ id, type: 'map' as const, name: MAP_DLCS[id] })),
    ...ALL_DLC_IDS.filter(id => !ownedTrailer.includes(id)).map(id => ({ id, type: 'trailer' as const, name: TRAILER_DLCS[id] })),
    ...ALL_CARGO_DLC_IDS.filter(id => !ownedCargo.includes(id)).map(id => ({ id, type: 'cargo' as const, name: CARGO_DLCS[id] })),
  ];

  return computeDLCValuesCore(rawData, {
    ownedTrailer, ownedCargo, ownedMap, activeGarages, garageCities: GARAGE_CITIES, unowned,
    cityDlcMap: CITY_DLC_MAP, combinedCargoDlcMap: COMBINED_CARGO_DLC_MAP,
  }, onProgress);
}
