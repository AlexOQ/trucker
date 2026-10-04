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

/** One DLC on the page: what buying it (unowned) or disabling it (owned) does to max-fleet earnings. */
export interface DLCMarginalValue {
  dlcId: string;
  dlcName: string;
  dlcType: 'map' | 'trailer' | 'cargo';
  /** Owned now — the value is for disabling it; otherwise for buying it. */
  owned: boolean;
  /** Max-fleet delta under the 354-driver cap (register Q82) if the player toggles it. Can be negative. */
  totalDelta: number;
  /** `totalDelta` as a fraction of the current max-fleet earnings. */
  share: number;
  /** Cities that enter / leave the staffed best 71 after the toggle, best first. */
  enters: Array<{ id: string; name: string }>;
  leaves: Array<{ id: string; name: string }>;
  /** Buying a trailer DLC only — structural per-body-type win breakdown (#257). */
  bodyTypeBreakdown?: BodyTypeWinDelta[];
}

/** A DLC the page can toggle: buy it if unowned, disable it if owned. */
export interface DLCToggle {
  id: string;
  type: 'map' | 'trailer' | 'cargo';
  name: string;
  owned: boolean;
}

/** Ownership scenario for the shared core — assembled from storage (main thread) or worker config. */
export interface DLCValueOwnership {
  ownedTrailer: string[];
  ownedCargo: string[];
  ownedMap: string[];
  /** All purchasable-garage city ids. Passed in (not read from the storage
   *  GARAGE_CITIES export) so the worker — where initDlcData never ran — uses
   *  its config copy. */
  garageCities: ReadonlySet<string>;
  /** Every DLC, owned or not — one scenario each. */
  toggles: DLCToggle[];
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
  /** The staffed purchasable cities — the best 71, best first. */
  staffed: string[];
  perCity: Map<string, number>;
  filtered: AllData;
  lookups: Lookups;
}

/** Garages the driver cap staffs: the best 70 full plus the partial one. */
const STAFFED_GARAGES = Math.ceil(FLEET_DRIVER_CAP / DRIVERS_PER_GARAGE);

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
  const purchasable: Array<{ id: string; score: number }> = [];
  for (const r of rankings) {
    perCity.set(r.id, r.score);
    if (garageCityIds.has(r.id)) total += r.score;
    // `rankings` is already DLC-filtered, so a city behind an unowned map DLC never appears here.
    if (allPurchasable.has(r.id)) purchasable.push({ id: r.id, score: r.score });
  }
  purchasable.sort((x, y) => y.score - x.score);
  return {
    total,
    cappedTotal: cappedFleetTotal(purchasable.map(p => p.score)),
    staffed: purchasable.slice(0, STAFFED_GARAGES).map(p => p.id),
    perCity, filtered, lookups,
  };
}

/** Garage city ids grouped by country. */
function garagesByCountryOf(rawData: AllData, garages: ReadonlySet<string>): Map<string, string[]> {
  const byCountry = new Map<string, string[]>();
  for (const c of rawData.cities) {
    if (!garages.has(c.id)) continue;
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

/** DLC ownership state needed to run marginal value calculation */
export interface DLCConfig {
  ownedTrailer: string[];
  ownedCargo: string[];
  ownedMap: string[];
  // DLC registries
  allTrailerDLCIds: string[];
  allCargoDLCIds: string[];
  allMapDLCIds: string[];
  cityDlcMap: Record<string, string[]>;
  combinedCargoDlcMap: Record<string, string>;
  garageCities: string[];
}

/**
 * The ownership the DLC scenarios score against: every DLC is a toggle, named by its id — the client
 * patches display names after the results return (the worker has no name maps).
 */
export function ownershipFromConfig(config: DLCConfig): DLCValueOwnership {
  const { ownedTrailer, ownedCargo, ownedMap } = config;
  const toggles: DLCToggle[] = [
    ...config.allMapDLCIds.map(id => ({ id, type: 'map' as const, name: id, owned: ownedMap.includes(id) })),
    ...config.allTrailerDLCIds.map(id => ({ id, type: 'trailer' as const, name: id, owned: ownedTrailer.includes(id) })),
    ...config.allCargoDLCIds.map(id => ({ id, type: 'cargo' as const, name: id, owned: ownedCargo.includes(id) })),
  ];
  return {
    ownedTrailer, ownedCargo, ownedMap, garageCities: new Set(config.garageCities), toggles,
    cityDlcMap: config.cityDlcMap, combinedCargoDlcMap: config.combinedCargoDlcMap,
  };
}

/**
 * One scenario's scores, small enough to post back from a worker: the max-fleet total, the staffed
 * best 71, and a bought trailer DLC's body-type breakdown.
 */
export interface ScenarioSummary {
  dlcId: string | null;
  cappedTotal: number;
  staffed: string[];
  bodyTypeBreakdown?: BodyTypeWinDelta[];
}

/** `list` with `id` toggled: added if `on`, removed otherwise. */
function withToggle(list: string[], id: string, on: boolean): string[] {
  return on ? [...list.filter(x => x !== id), id] : list.filter(x => x !== id);
}

/**
 * Score one ownership scenario: the current ownership (`dlc` null), or it with one DLC toggled —
 * bought if unowned, disabled if owned. Scenarios are independent of each other — the unit a worker
 * pool runs in parallel.
 */
export function evaluateDLCScenario(rawData: AllData, o: DLCValueOwnership, dlc: DLCToggle | null): ScenarioSummary {
  const on = dlc ? !dlc.owned : false;
  const trailer = dlc?.type === 'trailer' ? withToggle(o.ownedTrailer, dlc.id, on) : o.ownedTrailer;
  const cargo = dlc?.type === 'cargo' ? withToggle(o.ownedCargo, dlc.id, on) : o.ownedCargo;
  const map = dlc?.type === 'map' ? withToggle(o.ownedMap, dlc.id, on) : o.ownedMap;

  const r = sumGarageScores(rawData, trailer, new Set([...cargo, ...map]), map, new Set(), o.cityDlcMap, o.combinedCargoDlcMap, o.garageCities);
  const summary: ScenarioSummary = { dlcId: dlc?.id ?? null, cappedTotal: r.cappedTotal, staffed: r.staffed };

  // Buying a trailer DLC: which body types it wins at the garages that would be staffed.
  const garagesByCountry = garagesByCountryOf(rawData, new Set(r.staffed));
  if (dlc?.type === 'trailer' && on && garagesByCountry.size > 0) {
    // Per-(profile, country) winners need only the current ownership's filtered data, not its rankings.
    const base = applyDLCFilter(rawData, o.ownedTrailer, new Set([...o.ownedCargo, ...o.ownedMap]), o.combinedCargoDlcMap, getBlockedCities(o.ownedMap, o.cityDlcMap));
    const baseLookups = buildLookups(base);
    clearTrailerInfoCache();
    const baselineProfiles = new Map<string, Map<string, ProfileTrailerInfo>>();
    for (const country of garagesByCountry.keys()) {
      baselineProfiles.set(country, computeProfileTrailerInfoForCountry(country, base, baseLookups));
    }
    const breakdown = computeBodyTypeBreakdown(baselineProfiles, r, garagesByCountry);
    if (breakdown.length > 0) summary.bodyTypeBreakdown = breakdown;
  }
  clearTrailerInfoCache();
  return summary;
}

/** Turn the current scenario and each toggle's scenario into values, best first. */
export function assembleDLCValues(
  rawData: AllData, o: DLCValueOwnership, baseline: ScenarioSummary, hypos: ScenarioSummary[],
): DLCMarginalValue[] {
  const nameOf = (id: string) => rawData.cities.find(c => c.id === id)?.displayName ?? id;
  const before = new Set(baseline.staffed);
  const results: DLCMarginalValue[] = [];
  for (const dlc of o.toggles) {
    const hypo = hypos.find(h => h.dlcId === dlc.id);
    if (!hypo) continue;
    const after = new Set(hypo.staffed);
    const totalDelta = hypo.cappedTotal - baseline.cappedTotal;
    const result: DLCMarginalValue = {
      dlcId: dlc.id,
      dlcName: dlc.name,
      dlcType: dlc.type,
      owned: dlc.owned,
      totalDelta,
      share: baseline.cappedTotal > 0 ? totalDelta / baseline.cappedTotal : 0,
      enters: hypo.staffed.filter(id => !before.has(id)).map(id => ({ id, name: nameOf(id) })),
      leaves: baseline.staffed.filter(id => !after.has(id)).map(id => ({ id, name: nameOf(id) })),
    };
    if (hypo.bodyTypeBreakdown) result.bodyTypeBreakdown = hypo.bodyTypeBreakdown;
    results.push(result);
  }
  results.sort((a, b) => b.totalDelta - a.totalDelta);
  return results;
}

/**
 * Per-DLC values, synchronously, one scenario after another — the main-thread fallback and the
 * tests. The page's normal path runs the same scenarios across a worker pool.
 */
export function computeDLCValuesCore(
  rawData: AllData,
  o: DLCValueOwnership,
  onProgress?: (completed: number, total: number) => void,
): DLCMarginalValue[] {
  const baseline = evaluateDLCScenario(rawData, o, null);
  const hypos: ScenarioSummary[] = [];
  for (const dlc of o.toggles) {
    hypos.push(evaluateDLCScenario(rawData, o, dlc));
    onProgress?.(hypos.length, o.toggles.length);
  }
  return assembleDLCValues(rawData, o, baseline, hypos);
}

/** One DLC's contribution to the optimal set, as found by `searchOptimalDLCSet`. */
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

/** Max-fleet total (capped) for a set of map + cargo DLCs, every trailer DLC owned. */
export function scoreDLCSet(rawData: AllData, o: DLCValueOwnership, trailerIds: string[], mapIds: Set<string>, ids: string[]): number {
  const maps = ids.filter(id => mapIds.has(id));
  const cargo = ids.filter(id => !mapIds.has(id));
  return sumGarageScores(
    rawData, trailerIds, new Set([...cargo, ...maps]), maps,
    new Set(), o.cityDlcMap, o.combinedCargoDlcMap, o.garageCities,
  ).cappedTotal;
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
 * `scoreMany` scores a batch of sets, each a list of map + cargo DLC ids, and may run them in
 * parallel. The removals score as one batch. The re-adds are tried in order against the growing set:
 * each batch scores every remaining trial against the current set, the walk accepts the first that
 * helps, and the rest re-score against the larger set — the same result as trying them one by one.
 *
 * Trailer DLCs are never pruned: they add trailers and no cargo, so they cannot dilute a draw pool and
 * their removal marginal is bounded at <= 0 (register Q38 measured every brand at exactly 0.000).
 */
export async function searchOptimalDLCSet(
  allDlcs: Array<{ id: string; type: 'map' | 'trailer' | 'cargo'; name: string }>,
  owned: string[],
  scoreMany: (sets: string[][]) => Promise<number[]>,
): Promise<OptimalDLCSet> {
  const trailerIds = allDlcs.filter(d => d.type === 'trailer').map(d => d.id);
  const searchable = allDlcs.filter(d => d.type !== 'trailer');
  const everything = searchable.map(d => d.id);

  // Everything, each removal from it, and the owned set: independent, one batch.
  const first = await scoreMany([everything, ...searchable.map(d => everything.filter(id => id !== d.id)), owned]);
  const everythingTotal = first[0];
  const ownedTotal = first[first.length - 1];
  const marginal = new Map<string, number>();
  searchable.forEach((d, i) => marginal.set(d.id, everythingTotal - first[i + 1]));  // what owning it is worth

  // Prune everything whose removal helped, then try adding each back, in order.
  const keep = searchable.filter(d => (marginal.get(d.id) ?? 0) >= 0).map(d => d.id);
  let pending = searchable.filter(d => !keep.includes(d.id)).map(d => d.id);
  let [bestTotal] = await scoreMany([keep]);
  while (pending.length > 0) {
    const trials = await scoreMany(pending.map(id => [...keep, id]));
    const accepted = trials.findIndex(t => t > bestTotal);
    if (accepted < 0) break;
    keep.push(pending[accepted]);
    bestTotal = trials[accepted];
    pending = pending.slice(accepted + 1);
  }

  // "Own everything" can still win if pruning overshot.
  const optimal = everythingTotal > bestTotal ? everything : keep;
  if (everythingTotal > bestTotal) bestTotal = everythingTotal;

  const members: DLCSetMember[] = searchable.map(d => ({
    dlcId: d.id, dlcName: d.name, dlcType: d.type,
    removalMarginal: marginal.get(d.id) ?? 0,
    inOptimalSet: optimal.includes(d.id),
  }));
  for (const id of trailerIds) {
    const d = allDlcs.find(x => x.id === id)!;
    members.push({ dlcId: id, dlcName: d.name, dlcType: 'trailer', removalMarginal: 0, inOptimalSet: true });
  }
  members.sort((a, b) => b.removalMarginal - a.removalMarginal);

  return {
    optimalIds: [...optimal, ...trailerIds].sort(),
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

  const toggles: DLCToggle[] = [
    ...ALL_MAP_DLC_IDS.map(id => ({ id, type: 'map' as const, name: MAP_DLCS[id], owned: ownedMap.includes(id) })),
    ...ALL_DLC_IDS.map(id => ({ id, type: 'trailer' as const, name: TRAILER_DLCS[id], owned: ownedTrailer.includes(id) })),
    ...ALL_CARGO_DLC_IDS.map(id => ({ id, type: 'cargo' as const, name: CARGO_DLCS[id], owned: ownedCargo.includes(id) })),
  ];

  return computeDLCValuesCore(rawData, {
    ownedTrailer, ownedCargo, ownedMap, garageCities: GARAGE_CITIES, toggles,
    cityDlcMap: CITY_DLC_MAP, combinedCargoDlcMap: COMBINED_CARGO_DLC_MAP,
  }, onProgress);
}
