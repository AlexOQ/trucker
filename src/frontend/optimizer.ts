/**
 * Trailer Set Optimizer for ETS2 Trucker Advisor
 *
 * Model: Best-of-N Monte Carlo fleet optimization
 * - Each depot independently spawns JOBS_PER_DEPOT random jobs from its cargo pool
 * - AI drivers see the combined job board and pick the highest-value job they can haul
 * - Fleet composition determined by greedy selection: each pick maximizes marginal EV
 *
 * City rankings use an analytical E[max of N] formula for speed (no MC needed).
 *
 * Data source: game-defs.json (authoritative cargo values, spawn coefficients, trailer specs)
 */

import {
  formatTrailerSpec,
  cargoBonus,
} from './utils.js';
import type { AllData, Lookups, Trailer } from './types.js';

/** Jobs spawned per depot instance on each visit */
const JOBS_PER_DEPOT = 3;

/** Max AI drivers dispatched simultaneously */
const MAX_DRIVERS = 5;

/** Monte Carlo simulations for fleet computation (individual city) */
const MC_SIMS = 20_000;

/** Number of top trailers shown in rankings summary */
const TOP_TRAILERS = 5;

/** Drivers dispatched simultaneously for ranking score */
const RANKING_DRIVERS = 5;

// ============================================
// Interfaces
// ============================================

export interface FleetEntry {
  trailerId: string;
  bodyType: string;
  chainType: string;
  countryValidity: string[];
  displayName: string;
  trailerSpec: string;
  cityValue: number;
  pctOfTotal: number;
  cargoMatched: number;
  variants: number;
}

export interface OptimalFleetEntry {
  displayName: string;
  bodyType: string;
  trailerId: string;
  trailerSpec: string;
  ev: number;
  cargoMatched: number;
  count: number;           // 1-5 for drivers (collapsed by body type)
}

export interface OptimalFleet {
  drivers: OptimalFleetEntry[];
  totalTrailers: number;
}

export interface CityRanking {
  id: string;
  name: string;
  country: string;
  hasGarage: boolean;
  depotCount: number;
  cargoTypes: number;
  score: number;
  topTrailers: FleetEntry[];
}

// ============================================
// Display helpers
// ============================================

function bodyTypeDisplayName(bodyType: string): string {
  return bodyType.charAt(0).toUpperCase() + bodyType.slice(1).replace(/_/g, ' ');
}

// ============================================
// Depot cargo model
// ============================================

/** A cargo item in a depot's spawn pool */
interface DepotCargoItem {
  cargoId: string;
  probCoef: number;
  /** bodyType → best haul value (value × bonus × units) for standard ownable trailers */
  bodyHV: Record<string, number>;
}

/** A depot instance with its cargo profile and sampling CDF */
export interface CityDepotData {
  companyId: string;
  cargo: DepotCargoItem[];
  totalProbCoef: number;
  /** Pre-computed cumulative probability array for fast MC sampling */
  cumProbs: number[];
}

/**
 * Build depot cargo profiles for a city.
 * Each depot instance (company × depotCount) gets its own entry.
 * Each cargo item includes best haul value per body type from ownable trailers
 * available in the city's country (standard + zone variants if country qualifies).
 */
export function buildCityDepotProfiles(cityId: string, lookups: Lookups): CityDepotData[] | null {
  const city = lookups.citiesById.get(cityId);
  const country = city?.country ?? '';
  const cityCompanies = lookups.cityCompanyMap.get(cityId) || [];
  if (cityCompanies.length === 0) return null;

  const depots: CityDepotData[] = [];

  for (const { companyId, count: depotCount } of cityCompanies) {
    const cargoIds = lookups.companyCargoMap.get(companyId) || [];
    const cargo: DepotCargoItem[] = [];
    let totalProbCoef = 0;

    for (const cargoId of cargoIds) {
      const c = lookups.cargoById.get(cargoId);
      if (!c || c.excluded) continue;

      const probCoef = c.prob_coef ?? 1.0;
      const bonus = cargoBonus(c);
      const unitVal = c.value * bonus;

      // Find best haul value per body type from trailers available in this country
      const bodyHV: Record<string, number> = {};
      const compatibleTrailers = lookups.cargoTrailerMap.get(cargoId);
      if (!compatibleTrailers) continue;

      for (const trailerId of compatibleTrailers) {
        const trailer = lookups.trailersById.get(trailerId);
        if (!trailer || !trailer.ownable) continue;
        // Zone check: trailer must be available in this country
        if (trailer.country_validity && trailer.country_validity.length > 0
          && !trailer.country_validity.includes(country)) continue;

        const units = lookups.cargoTrailerUnits.get(`${cargoId}:${trailerId}`) ?? 1;
        if (units <= 0) continue;

        const bt = trailer.body_type;
        const hv = unitVal * units;
        if (!bodyHV[bt] || hv > bodyHV[bt]) bodyHV[bt] = hv;
      }

      if (Object.keys(bodyHV).length === 0) continue;
      cargo.push({ cargoId, probCoef, bodyHV });
      totalProbCoef += probCoef;
    }

    if (cargo.length === 0 || totalProbCoef === 0) continue;

    // Build CDF for fast binary-search sampling
    let cum = 0;
    const cumProbs = cargo.map((c) => { cum += c.probCoef / totalProbCoef; return cum; });

    // Add one entry per depot instance
    for (let i = 0; i < depotCount; i++) {
      depots.push({ companyId, cargo, totalProbCoef, cumProbs });
    }
  }

  return depots.length > 0 ? depots : null;
}

// ============================================
// Analytical E[max of N] — for city rankings
// ============================================

/**
 * Per-depot pre-built items for `analyticalFirstPickEV`.
 * Each entry is one cargo slot: bodyHV carries all body-type HV values,
 * p is the normalised spawn probability (probCoef / totalProbCoef).
 *
 * Build once per city with `buildDepotItemsCache`, then pass to every
 * `analyticalFirstPickEV` call for that city to avoid redundant allocation.
 */
export type DepotItemsCache = Array<Array<{ bodyHV: Record<string, number>; p: number }>>;

/**
 * Precompute per-depot cargo items (bodyHV + normalised probability).
 * Call once per city; pass the result to every `analyticalFirstPickEV` call.
 */
export function buildDepotItemsCache(depots: CityDepotData[]): DepotItemsCache {
  return depots.map((depot) =>
    depot.cargo.map((c) => ({
      bodyHV: c.bodyHV,
      p: c.probCoef / depot.totalProbCoef,
    }))
  );
}

/**
 * Analytical E[max of N draws] for a body type across all depots.
 *
 * Multi-depot formula:
 *   P(max across all depots ≤ H) = Π_d CDF_d(H)^K
 * where CDF_d(H) = Σ_{c in depot_d: hv_c ≤ H} p_c
 * and K = JOBS_PER_DEPOT.
 *
 * Then E[max] = Σ_i hv_i × [P(max ≤ hv_i) - P(max ≤ hv_{i-1})]
 *
 * Pass a pre-built `cache` from `buildDepotItemsCache` to avoid rebuilding
 * depot data on every body-type evaluation for the same city.
 */
export function analyticalFirstPickEV(
  depots: CityDepotData[],
  bodyType: string,
  cache?: DepotItemsCache,
): number {
  // Use the pre-built cache when available, otherwise build inline (for callers
  // that only need a single evaluation, e.g. tests).
  const depotItems: DepotItemsCache = cache ?? buildDepotItemsCache(depots);

  // Collect all unique HV values across all depots for this body type
  const hvSet = new Set<number>([0]);
  for (const items of depotItems) {
    for (const item of items) {
      const hv = item.bodyHV[bodyType] || 0;
      if (hv > 0) hvSet.add(hv);
    }
  }

  const hvValues = [...hvSet].sort((a, b) => a - b);
  if (hvValues.length <= 1) return 0; // only hv=0, no compatible cargo

  // P(max across all depots ≤ H) = Π_d CDF_d(H)^K
  function totalCDF(H: number): number {
    let result = 1;
    for (const items of depotItems) {
      let cdf = 0;
      for (const item of items) {
        if ((item.bodyHV[bodyType] || 0) <= H) cdf += item.p;
      }
      result *= Math.pow(cdf, JOBS_PER_DEPOT);
    }
    return result;
  }

  // E[max] = Σ_i hv_i × [totalCDF(hv_i) - totalCDF(hv_{i-1})]
  let ev = 0;
  for (let i = 1; i < hvValues.length; i++) {
    const pMax = totalCDF(hvValues[i]) - totalCDF(hvValues[i - 1]);
    ev += hvValues[i] * pMax;
  }

  return ev;
}

// ============================================
// Monte Carlo simulation helpers
// ============================================

/** Fast binary-search pick from a depot's cargo CDF */
function mcPick(depot: CityDepotData): DepotCargoItem {
  const r = Math.random();
  let lo = 0, hi = depot.cumProbs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (depot.cumProbs[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return depot.cargo[lo];
}

/** Fill a pre-allocated board buffer in-place. Returns number of slots filled. */
function fillBoard(buffer: DepotCargoItem[], depots: CityDepotData[]): number {
  let idx = 0;
  for (const depot of depots) {
    for (let j = 0; j < JOBS_PER_DEPOT; j++) {
      buffer[idx++] = mcPick(depot);
    }
  }
  return idx;
}

/** Find best job on board for a body type. Returns hv and index (for removal). */
function bestJob(board: DepotCargoItem[], bodyType: string): { hv: number; idx: number } {
  let best = -1, bestIdx = -1;
  for (let i = 0; i < board.length; i++) {
    const hv = board[i].bodyHV[bodyType] || 0;
    if (hv > best) { best = hv; bestIdx = i; }
  }
  return { hv: Math.max(0, best), idx: bestIdx };
}

// ============================================
// Body type display info (country-aware)
// ============================================

/** Cache: country → bodyType → best trailer info */
const trailerInfoCache = new Map<string, Map<string, { trailerId: string; trailerSpec: string }>>();

/** Clear trailer info cache — needed when DLC filter state changes between optimizer runs */
export function clearTrailerInfoCache(): void {
  trailerInfoCache.clear();
}

/**
 * Get the best representative trailer per body type for a specific country.
 * Picks the ownable trailer valid in this country with highest total haul value,
 * so HCT/double/b_double variants win when available (they have more capacity).
 */
function getTrailerInfoForCountry(
  country: string, data: AllData, lookups: Lookups,
): Map<string, { trailerId: string; trailerSpec: string }> {
  const cached = trailerInfoCache.get(country);
  if (cached) return cached;

  const info = new Map<string, { trailerId: string; trailerSpec: string }>();
  const bestByBT = new Map<string, { trailer: Trailer; totalHV: number }>();

  for (const t of data.trailers) {
    if (!t.ownable) continue;
    if (t.country_validity && t.country_validity.length > 0
      && !t.country_validity.includes(country)) continue;

    const bt = t.body_type;
    const cargoSet = lookups.trailerCargoMap.get(t.id);
    if (!cargoSet) continue;

    let totalHV = 0;
    for (const cargoId of cargoSet) {
      const c = lookups.cargoById.get(cargoId);
      if (!c || c.excluded) continue;
      const units = lookups.cargoTrailerUnits.get(`${cargoId}:${t.id}`) ?? 1;
      const bonus = cargoBonus(c);
      totalHV += c.value * bonus * units;
    }

    const existing = bestByBT.get(bt);
    if (!existing || totalHV > existing.totalHV) {
      bestByBT.set(bt, { trailer: t, totalHV });
    }
  }

  for (const [bt, { trailer }] of bestByBT) {
    info.set(bt, {
      trailerId: trailer.id,
      trailerSpec: formatTrailerSpec(trailer),
    });
  }

  trailerInfoCache.set(country, info);
  return info;
}

// ============================================
// Body type domination
// ============================================

/**
 * Find body types dominated by other body types in a city's depot profiles.
 * A is dominated by B if B covers every cargo A can haul with >= haul value,
 * and B covers strictly more cargo (or has strictly higher HV somewhere).
 */
function findDominatedBodyTypes(depots: CityDepotData[], bodyTypes: Set<string>): Set<string> {
  const dominated = new Set<string>();
  const btList = [...bodyTypes];

  // Collect per-cargo max bodyHV across all depots
  const cargoHV = new Map<string, Record<string, number>>();
  for (const depot of depots) {
    for (const c of depot.cargo) {
      let entry = cargoHV.get(c.cargoId);
      if (!entry) { entry = {}; cargoHV.set(c.cargoId, entry); }
      for (const [bt, hv] of Object.entries(c.bodyHV)) {
        if (!entry[bt] || hv > entry[bt]) entry[bt] = hv;
      }
    }
  }

  for (const a of btList) {
    if (dominated.has(a)) continue;
    for (const b of btList) {
      if (a === b || dominated.has(b)) continue;

      // Check: is A dominated by B?
      let covers = true;
      let bHasMore = false;

      for (const [, hvs] of cargoHV) {
        const hvA = hvs[a] ?? 0;
        const hvB = hvs[b] ?? 0;
        if (hvA > 0 && hvB < hvA) { covers = false; break; }
        if (hvA === 0 && hvB > 0) bHasMore = true;
        if (hvA > 0 && hvB > hvA) bHasMore = true;
      }

      if (covers && bHasMore) {
        dominated.add(a);
        break;
      }
    }
  }

  return dominated;
}

/** Count distinct cargo types compatible with a body type across city depots */
function countCityCargoForBodyType(depots: CityDepotData[], bodyType: string): number {
  const cargoIds = new Set<string>();
  for (const depot of depots) {
    for (const c of depot.cargo) {
      if (c.bodyHV[bodyType]) cargoIds.add(c.cargoId);
    }
  }
  return cargoIds.size;
}

// ============================================
// Optimal fleet recommendation (MC)
// ============================================

/**
 * Compute the optimal fleet for a city garage using Monte Carlo simulation.
 *
 * Phase 1: Greedy driver selection — each round, test all viable body types
 *          on the same set of random boards. Pick the one with highest marginal EV.
 *
 * Phase 2: Per-driver stats — simulate final fleet to get per-driver EV.
 *
 * Phase 3: Spare evaluation — for each candidate spare, compute expected
 *          improvement when ANY driver would benefit from swapping.
 */
export function computeOptimalFleet(
  cityId: string, data: AllData, lookups: Lookups,
): OptimalFleet | null {
  const depots = buildCityDepotProfiles(cityId, lookups);
  if (!depots) return null;

  const city = lookups.citiesById.get(cityId);
  const country = city?.country ?? '';
  const trailerInfo = getTrailerInfoForCountry(country, data, lookups);

  // Collect all body types and eliminate dominated ones
  const allBodyTypes = new Set<string>();
  for (const depot of depots) {
    for (const c of depot.cargo) {
      for (const bt of Object.keys(c.bodyHV)) allBodyTypes.add(bt);
    }
  }

  const dominated = findDominatedBodyTypes(depots, allBodyTypes);
  for (const bt of dominated) allBodyTypes.delete(bt);

  // Build depot items cache once; reused for every body type evaluation below.
  const depotItemsCache = buildDepotItemsCache(depots);

  const bodyTypeEVs: Array<{ bt: string; ev: number }> = [];
  for (const bt of allBodyTypes) {
    const ev = analyticalFirstPickEV(depots, bt, depotItemsCache);
    if (ev > 0) bodyTypeEVs.push({ bt, ev });
  }
  bodyTypeEVs.sort((a, b) => b.ev - a.ev);

  // Top body types for MC evaluation
  const viableBodyTypes = bodyTypeEVs.slice(0, 15).map((e) => e.bt);
  if (viableBodyTypes.length === 0) return null;

  // Pre-allocate board buffer (reused across all MC simulations)
  const totalSlots = depots.length * JOBS_PER_DEPOT;
  const boardBuffer: DepotCargoItem[] = new Array(totalSlots);

  // Phase 1: Greedy driver selection
  const fleet: string[] = [];

  console.time('computeOptimalFleet');

  for (let pick = 0; pick < MAX_DRIVERS; pick++) {
    // Generate shared boards for this round — store raw generated boards
    const rawBoards: DepotCargoItem[][] = [];
    for (let s = 0; s < MC_SIMS; s++) {
      const len = fillBoard(boardBuffer, depots);
      rawBoards.push(boardBuffer.slice(0, len));
    }

    // Pre-compute base fleet simulation on each board
    const baseRemainders: DepotCargoItem[][] = [];

    for (const board of rawBoards) {
      const remaining = board.slice();
      for (const bt of fleet) {
        const { hv, idx } = bestJob(remaining, bt);
        if (hv > 0 && idx >= 0) {
          remaining[idx] = remaining[remaining.length - 1];
          remaining.pop();
        }
      }
      baseRemainders.push(remaining);
    }

    // Evaluate each candidate body type's marginal contribution
    let bestBT = '';
    let bestMarginal = -1;

    for (const bt of viableBodyTypes) {
      let marginalSum = 0;
      for (const remaining of baseRemainders) {
        marginalSum += bestJob(remaining, bt).hv;
      }
      const marginal = marginalSum / MC_SIMS;
      if (marginal > bestMarginal) { bestMarginal = marginal; bestBT = bt; }
    }

    if (bestMarginal <= 0) break;
    fleet.push(bestBT);
  }

  console.timeEnd('computeOptimalFleet');

  if (fleet.length === 0) return null;

  // Phase 2: Compute per-driver EVs with final fleet
  const driverEVs = new Array(fleet.length).fill(0);

  for (let s = 0; s < MC_SIMS; s++) {
    const len = fillBoard(boardBuffer, depots);
    const remaining = boardBuffer.slice(0, len);
    for (let d = 0; d < fleet.length; d++) {
      const { hv, idx } = bestJob(remaining, fleet[d]);
      if (hv > 0 && idx >= 0) {
        driverEVs[d] += hv;
        remaining[idx] = remaining[remaining.length - 1];
        remaining.pop();
      }
    }
  }

  for (let d = 0; d < fleet.length; d++) driverEVs[d] /= MC_SIMS;

  // Collapse fleet into counts (e.g., 3× curtainside → one entry with count=3)
  const driverMap = new Map<string, { ev: number; count: number }>();
  for (let d = 0; d < fleet.length; d++) {
    const bt = fleet[d];
    const existing = driverMap.get(bt);
    if (existing) {
      existing.count++;
    } else {
      driverMap.set(bt, { ev: driverEVs[d], count: 1 });
    }
  }

  const drivers: OptimalFleetEntry[] = [...driverMap.entries()].map(([bt, { ev, count }]) => {
    const info = trailerInfo.get(bt);
    return {
      displayName: bodyTypeDisplayName(bt),
      bodyType: bt,
      trailerId: info?.trailerId ?? bt,
      trailerSpec: info?.trailerSpec ?? bt,
      ev,
      cargoMatched: countCityCargoForBodyType(depots, bt),
      count,
    };
  });

  const totalTrailers = drivers.reduce((s, d) => s + d.count, 0);

  return { drivers, totalTrailers };
}

// ============================================
// City rankings (analytical)
// ============================================

/**
 * Rank all cities by total earning potential using analytical E[max of N].
 *
 * Score = sum of top RANKING_DRIVERS body types' analytical first-pick EVs.
 * This approximates the greedy fleet total without needing MC per city.
 */
export function calculateCityRankings(
  data: AllData, lookups: Lookups,
): CityRanking[] {
  const rankings: CityRanking[] = [];

  for (const city of data.cities) {
    const depots = buildCityDepotProfiles(city.id, lookups);
    if (!depots) continue;

    const trailerInfo = getTrailerInfoForCountry(city.country, data, lookups);

    const cityCompanies = lookups.cityCompanyMap.get(city.id) || [];
    let depotCount = 0;
    for (const { count } of cityCompanies) depotCount += count;

    // Collect all body types and eliminate dominated ones
    const allBodyTypes = new Set<string>();
    for (const depot of depots) {
      for (const c of depot.cargo) {
        for (const bt of Object.keys(c.bodyHV)) allBodyTypes.add(bt);
      }
    }

    const dominated = findDominatedBodyTypes(depots, allBodyTypes);
    for (const bt of dominated) allBodyTypes.delete(bt);

    // Build depot items cache once; reused for every body type evaluation below.
    const depotItemsCache = buildDepotItemsCache(depots);

    // Compute analytical first-pick EV per body type
    const bodyTypeEVs: Array<{ bt: string; ev: number }> = [];
    for (const bt of allBodyTypes) {
      const ev = analyticalFirstPickEV(depots, bt, depotItemsCache);
      if (ev > 0) bodyTypeEVs.push({ bt, ev });
    }
    bodyTypeEVs.sort((a, b) => b.ev - a.ev);

    if (bodyTypeEVs.length === 0) continue;

    // Score = sum of top N body type EVs
    const topN = bodyTypeEVs.slice(0, RANKING_DRIVERS);
    const score = topN.reduce((s, e) => s + e.ev, 0);

    // Count unique cargo types across all depots
    const cargoIds = new Set<string>();
    for (const depot of depots) {
      for (const c of depot.cargo) cargoIds.add(c.cargoId);
    }

    // Build top trailer entries for display
    const topTrailers: FleetEntry[] = bodyTypeEVs.slice(0, TOP_TRAILERS).map((e) => {
      const info = trailerInfo.get(e.bt);
      return {
        trailerId: info?.trailerId ?? e.bt,
        bodyType: e.bt,
        chainType: 'single',
        countryValidity: [],
        displayName: bodyTypeDisplayName(e.bt),
        trailerSpec: info?.trailerSpec ?? e.bt,
        cityValue: e.ev,
        pctOfTotal: score > 0 ? (e.ev / score) * 100 : 0,
        cargoMatched: countCityCargoForBodyType(depots, e.bt),
        variants: 1,
      };
    });

    rankings.push({
      id: city.id,
      name: city.name,
      country: city.country,
      hasGarage: city.hasGarage,
      depotCount,
      cargoTypes: cargoIds.size,
      score,
      topTrailers,
    });
  }

  rankings.sort((a, b) => b.score - a.score);
  return rankings;
}
