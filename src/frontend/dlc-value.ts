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
  calculateCityRankings, clearTrailerInfoCache, buildCityDepotProfiles,
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
  /** Max-fleet delta under the 354-driver cap (register Q82). Can be negative. */
  totalDelta: number;
  /** Delta summed over every purchasable city, ignoring the cap. Monotone in cities added — kept for
   *  comparison, never for ranking: it is what made map DLCs look unconditionally positive. */
  uncappedDelta: number;
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

/**
 * The save allocates exactly 354 AI-driver records — a hard engine constant, identical in ETS2 and
 * ATS and independent of cities, companies or owned DLC (register Q82). At 5 slots per garage that
 * staffs 70 garages fully plus one at 4/5, whatever else you own. Buying a 72nd garage adds a slot
 * that can never be crewed, which is why a DLC's value is NOT "how many cities does it add" but
 * "does it put a city into the top 71".
 */
export const FLEET_DRIVER_CAP = 354;
export const DRIVERS_PER_GARAGE = 5;

/**
 * Fleet total under the driver cap: the best `FLEET_DRIVER_CAP / DRIVERS_PER_GARAGE` garages, with
 * the last one pro-rated for its partial crew.
 *
 * A city's ranking score is the summed EV of a full 5-driver roster, so the partial garage
 * contributes `leftover / DRIVERS_PER_GARAGE` of its score.
 */
export function cappedFleetTotal(scores: number[]): number {
  const sorted = [...scores].sort((x, y) => y - x);
  const full = Math.floor(FLEET_DRIVER_CAP / DRIVERS_PER_GARAGE);
  const leftover = FLEET_DRIVER_CAP % DRIVERS_PER_GARAGE;
  let total = 0;
  for (let i = 0; i < full && i < sorted.length; i++) total += sorted[i];
  if (leftover > 0 && sorted.length > full) total += sorted[full] * (leftover / DRIVERS_PER_GARAGE);
  return total;
}

interface ScenarioResult {
  /** Sum over the caller's garage set. Answers "what is this worth to my fleet as placed?" */
  total: number;
  /**
   * Sum over the best staffable garages drawn from every purchasable city the DLC set allows.
   * Answers "what is this worth to a maximum fleet?" — the question the DLC page exists for, and
   * the only one that can come out negative, because adding cities cannot help unless they
   * displace something already in the top 71.
   */
  cappedTotal: number;
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
  /** Every purchasable-garage city, for the capped max-fleet figure. Defaults to `garageCityIds`. */
  allPurchasable: ReadonlySet<string> = garageCityIds,
): ScenarioResult {
  const blocked = getBlockedCities(ownedMap, cityDlcMap);
  const filtered = applyDLCFilter(rawData, ownedTrailer, ownedCargoAndMap, combinedCargoDlcMap, blocked);
  const lookups = buildLookups(filtered);
  clearTrailerInfoCache();
  const rankings = calculateCityRankings(filtered, lookups);

  let total = 0;
  const perCity = new Map<string, number>();
  const purchasable: number[] = [];
  for (const r of rankings) {
    perCity.set(r.id, r.score);
    if (garageCityIds.has(r.id)) total += r.score;
    // `rankings` is already DLC-filtered, so a city behind an unowned map DLC never appears here.
    if (allPurchasable.has(r.id)) purchasable.push(r.score);
  }
  return { total, cappedTotal: cappedFleetTotal(purchasable), perCity, filtered, lookups };
}

/** Active garage city ids grouped by country. */
function garagesByCountryOf(rawData: AllData, activeGarages: Set<string>): Map<string, string[]> {
  const byCountry = new Map<string, string[]>();
  for (const c of rawData.cities) {
    if (!activeGarages.has(c.id)) continue;
    const list = byCountry.get(c.country);
    if (list) list.push(c.id); else byCountry.set(c.country, [c.id]);
  }
  return byCountry;
}

/** Body types actually demanded at the given garage cities (under a given scenario's
 *  trailer availability) — the union of bodyHV keys across their depots. */
function demandedBodyTypes(cities: string[], lookups: Lookups): Set<string> {
  const demanded = new Set<string>();
  for (const cityId of cities) {
    const depots = buildCityDepotProfiles(cityId, lookups);
    if (!depots) continue;
    for (const depot of depots) {
      for (const c of depot.cargo) {
        for (const bt of Object.keys(c.bodyHV)) demanded.add(bt);
      }
    }
  }
  return demanded;
}

/**
 * Per-body-type breakdown for a trailer DLC: across the player's garage countries,
 * find profiles whose best trailer's total HV rose when the DLC was added, and
 * report the DLC winner, the prior best (runner-up), and the HV margin. Diffs the
 * baseline scenario's per-country winners against the hypothetical's. The only
 * trailers hypo adds over baseline are this DLC's, so any HV increase is attributable
 * to it.
 *
 * Scoped to body types the player's garages actually demand (#257: the breakdown
 * must reflect the operating profile — a DLC that dominates a body type none of
 * your garages haul is irrelevant noise). A profile is reported only when one of
 * the country's garages spawns cargo for it.
 */
function computeBodyTypeBreakdown(
  baselineProfiles: Map<string, Map<string, ProfileTrailerInfo>>,
  hypo: ScenarioResult,
  garagesByCountry: Map<string, string[]>,
): BodyTypeWinDelta[] {
  const agg = new Map<string, {
    bodyTypes: string[]; winnerSpec: string; runnerUpSpec: string | null;
    maxMargin: number; countries: Set<string>;
  }>();

  for (const [country, cities] of garagesByCountry) {
    const baseInfo = baselineProfiles.get(country);
    if (!baseInfo) continue;
    const demanded = demandedBodyTypes(cities, hypo.lookups);
    const hypoInfo = computeProfileTrailerInfoForCountry(country, hypo.filtered, hypo.lookups);
    for (const [key, hypoRep] of hypoInfo) {
      if (!hypoRep.bodyTypes.some(bt => demanded.has(bt))) continue; // not hauled at this country's garages
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
  const baseline = sumGarageScores(rawData, o.ownedTrailer, baselineCargoSet, o.ownedMap, o.activeGarages, o.cityDlcMap, o.combinedCargoDlcMap, o.garageCities);

  const garagesByCountry = garagesByCountryOf(rawData, o.activeGarages);
  // Baseline per-(profile, country) winners — computed once, diffed against each hypo.
  const baselineProfiles = new Map<string, Map<string, ProfileTrailerInfo>>();
  for (const country of garagesByCountry.keys()) {
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

    const hypo = sumGarageScores(rawData, hypoTrailer, hypoCargoSet, hypoMap, hypoGarages, o.cityDlcMap, o.combinedCargoDlcMap, o.garageCities);

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
      // Capped: the max-fleet delta under the 354-driver ceiling. This is what can go negative when a
      // DLC's shadow cargo dilutes the draw pool more than its cities improve the top 71 (register Q81).
      totalDelta: hypo.cappedTotal - baseline.cappedTotal,
      uncappedDelta: hypo.total - baseline.total,
      existingGarageDelta,
      newCityPotential,
      newGarageCities,
    };

    if (dlc.type === 'trailer' && garagesByCountry.size > 0) {
      const breakdown = computeBodyTypeBreakdown(baselineProfiles, hypo, garagesByCountry);
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

/** One DLC's contribution to the optimal set, as found by `computeOptimalDLCSet`. */
export interface DLCSetMember {
  dlcId: string;
  dlcName: string;
  dlcType: 'map' | 'trailer' | 'cargo';
  /** Capped max-fleet delta from REMOVING this DLC from the full set. Negative = owning it costs you. */
  removalMarginal: number;
  inOptimalSet: boolean;
}

export interface OptimalDLCSet {
  /** DLC ids that maximise max-fleet earnings under the driver cap. */
  optimalIds: string[];
  optimalTotal: number;
  /** The same figure for the DLCs the player currently owns. */
  ownedTotal: number;
  /** Everything owned — the naive "buy it all" baseline. */
  everythingTotal: number;
  /** Fraction the owned set gives up against the optimum, e.g. -0.045 for 4.5% left on the table. */
  ownedShortfall: number;
  members: DLCSetMember[];
}

/**
 * Finds the DLC set that maximises max-fleet earnings under the 354-driver cap.
 *
 * Why a SET search and not the per-DLC marginals above: with 234 purchasable cities competing for 71
 * staffed slots, removing one map DLC just promotes the next-best cities, so single-DLC marginals are
 * heavily damped by substitution — measured at 0.01-1.74% each where the best *set* differs from
 * "own everything" by 4.5% (register Q81). Marginals get the sign right and the magnitude wrong.
 *
 * Strategy: start from everything, prune every DLC whose removal helps, then try re-adding the pruned
 * ones once. That is ~2N scenario evaluations rather than the O(N^2) a full greedy needs, and it
 * catches the known case (Scandinavia and Greece are both net-negative, together -4.5%).
 *
 * Trailer DLCs are never pruned: they add trailers and no cargo, so they cannot dilute a draw pool and
 * their removal marginal is bounded at <= 0 (register Q38 measured every brand at exactly 0.000).
 */
export function computeOptimalDLCSet(
  rawData: AllData,
  o: DLCValueOwnership,
  allDlcs: Array<{ id: string; type: 'map' | 'trailer' | 'cargo'; name: string }>,
  onProgress?: (completed: number, total: number) => void,
): OptimalDLCSet {
  const trailerIds = allDlcs.filter(d => d.type === 'trailer').map(d => d.id);
  const searchable = allDlcs.filter(d => d.type !== 'trailer');

  let completed = 0;
  const totalSteps = searchable.length * 2 + 3;
  const score = (ids: Set<string>): number => {
    const maps = allDlcs.filter(d => d.type === 'map' && ids.has(d.id)).map(d => d.id);
    const cargo = allDlcs.filter(d => d.type === 'cargo' && ids.has(d.id)).map(d => d.id);
    const r = sumGarageScores(
      rawData, trailerIds, new Set([...cargo, ...maps]), maps,
      o.activeGarages, o.cityDlcMap, o.combinedCargoDlcMap, o.garageCities,
    );
    completed++;
    onProgress?.(completed, totalSteps);
    return r.cappedTotal;
  };

  const everything = new Set(searchable.map(d => d.id));
  const everythingTotal = score(everything);

  // Removal marginals, each from the full set.
  const members: DLCSetMember[] = [];
  const marginal = new Map<string, number>();
  for (const d of searchable) {
    const without = new Set(everything);
    without.delete(d.id);
    const m = score(without) - everythingTotal;   // > 0 means dropping it HELPS
    marginal.set(d.id, -m);                       // report as "what owning it is worth"
  }

  // Prune everything whose removal helped, then try adding each back.
  const keep = new Set(searchable.filter(d => (marginal.get(d.id) ?? 0) >= 0).map(d => d.id));
  let bestTotal = score(keep);
  for (const d of searchable) {
    if (keep.has(d.id)) { completed++; onProgress?.(completed, totalSteps); continue; }
    const trial = new Set(keep);
    trial.add(d.id);
    const t = score(trial);
    if (t > bestTotal) { keep.add(d.id); bestTotal = t; }
  }
  // "Own everything" can still win if pruning overshot.
  if (everythingTotal > bestTotal) {
    keep.clear();
    for (const id of everything) keep.add(id);
    bestTotal = everythingTotal;
  }

  for (const d of searchable) {
    members.push({
      dlcId: d.id, dlcName: d.name, dlcType: d.type,
      removalMarginal: marginal.get(d.id) ?? 0,
      inOptimalSet: keep.has(d.id),
    });
  }
  for (const id of trailerIds) {
    const d = allDlcs.find(x => x.id === id)!;
    members.push({ dlcId: id, dlcName: d.name, dlcType: 'trailer', removalMarginal: 0, inOptimalSet: true });
  }
  members.sort((a, b) => b.removalMarginal - a.removalMarginal);

  const ownedTotal = score(new Set([...o.ownedMap, ...o.ownedCargo]));
  clearTrailerInfoCache();

  return {
    optimalIds: [...keep, ...trailerIds].sort(),
    optimalTotal: bestTotal,
    ownedTotal,
    everythingTotal,
    ownedShortfall: bestTotal > 0 ? ownedTotal / bestTotal - 1 : 0,
    members,
  };
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
