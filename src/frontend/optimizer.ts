/**
 * Trailer Set Optimizer for ETS2 Trucker Advisor.
 *
 * Best-of-N Monte Carlo fleet optimization — depots spawn JOBS_PER_DEPOT random
 * jobs, drivers greedy-pick the highest-value job they can haul. See CLAUDE.md
 * "Key Algorithms" for model details and "City Ranking Score" for the rankings path.
 *
 * Data source: game-defs.json.
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

/** MC count for city rankings. ~4-5% variance per per-driver-EV. Bump if picks shuffle between runs. */
const RANKING_MC_SIMS = 500;

/** Penalty (per km) for driving back empty from a destination with no jobs. */
const EMPTY_RETURN_PENALTY = 10.0;

/** Number of top trailers shown in rankings summary */
const TOP_TRAILERS = 5;

// ============================================
// Interfaces
// ============================================

export interface FleetEntry {
  trailerId: string;
  /** Primary body type — for routes like `trailers.html#body-{bodyType}` and backwards compat. */
  bodyType: string;
  /** Full body-type set the recommended trailer can serve. Size 1 for single-body. */
  bodyTypes: string[];
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
  /** Primary body type — for routes like `trailers.html#body-{bodyType}` and backwards compat. */
  bodyType: string;
  /** Full body-type set the recommended trailer can serve. Size 1 for single-body; >1 for multi-body trailers (extra_body_types). */
  bodyTypes: string[];
  trailerId: string;
  trailerSpec: string;
  /** Mean per-driver EV across this profile's picks; multiply by `count` for total contribution. */
  ev: number;
  cargoMatched: number;
  count: number;           // 1-5 for drivers (collapsed by profile)
  /** Per-trailer purchase price (rounded to nearest 1000); 0 if no dealer data. */
  estimatedPrice: number;
  /** Level at which this trailer becomes available (max accessory unlock); 0 if no dealer data. */
  levelFloor: number;
}

export interface OptimalFleet {
  drivers: OptimalFleetEntry[];
  totalTrailers: number;
  /** Sum of `estimatedPrice × count` across all drivers; 0 when no dealer data is present. */
  totalEstimatedPrice: number;
  /** Highest level floor across all recommended drivers — when the full fleet becomes ownable. */
  fleetLevelFloor: number;
  /** Sum of per-driver EVs after contention/stacking — the fleet's expected haul value per cycle. */
  totalFleetEV: number;
}

export interface CityRanking {
  id: string;
  name: string;           // native name for search matching
  displayName: string;    // English name for display
  country: string;        // country ID for filtering
  countryName: string;    // English country name for display
  hasGarage: boolean;
  depotCount: number;
  cargoTypes: number;
  score: number;
  topTrailers: FleetEntry[];
  /** Cached fleet — detail view reads this for parity with the rankings column. */
  fleet: OptimalFleet;
}

// ============================================
// Display helpers
// ============================================

function bodyTypeDisplayName(bodyType: string): string {
  return bodyType.charAt(0).toUpperCase() + bodyType.slice(1).replace(/_/g, ' ');
}

/** Display name for a profile (set of body types). Joins multi-body sets with " + ". */
function profileDisplayName(bodyTypes: string[]): string {
  return bodyTypes.map(bodyTypeDisplayName).join(' + ');
}

/** Canonical key for a body-type set: sorted, pipe-joined. */
function profileKey(bodyTypes: Iterable<string>): string {
  return [...new Set(bodyTypes)].sort().join('|');
}


// ============================================
// Depot cargo model
// ============================================

/** A cargo item in a depot's spawn pool */
interface DepotCargoItem {
  cargoId: string;
  probCoef: number;
  /** value × bonus per unit — multiply by per-rep units for rep-specific HV */
  unitVal: number;
  /** bodyType → best haul value across ownable trailers in this body type */
  bodyHV: Record<string, number>;
  /** repId → unitVal × units; populated by populateRepHV before MC sim. */
  repHV?: Record<string, number>;
  /** Possible destination cities for this cargo */
  destinations: string[];
}

/** Populate repHV[repId] on each DepotCargoItem; call after candidate selection, before MC sim. */
function populateRepHV(depots: CityDepotData[], repIds: string[], lookups: Lookups): void {
  const seen = new Set<DepotCargoItem>();
  for (const depot of depots) {
    for (const c of depot.cargo) {
      if (seen.has(c)) continue;
      seen.add(c);
      const map: Record<string, number> = {};
      for (const repId of repIds) {
        const units = lookups.cargoTrailerUnits.get(`${c.cargoId}:${repId}`) ?? 0;
        map[repId] = c.unitVal * units;
      }
      c.repHV = map;
    }
  }
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

        const hv = unitVal * units;
        // Trailer contributes its HV to every body-type bucket it can serve that
        // also matches this cargo. Multi-body trailers (extra_body_types set via
        // multi-body-overrides.json) thus compete in multiple body slots from one
        // physical SKU. Falls back to single-bucket behavior when extras unset.
        const trailerBodyTypes = trailer.extra_body_types
          ? [trailer.body_type, ...trailer.extra_body_types]
          : [trailer.body_type];
        for (const bt of trailerBodyTypes) {
          if (!c.body_types.includes(bt)) continue;
          if (!bodyHV[bt] || hv > bodyHV[bt]) bodyHV[bt] = hv;
        }
      }

      if (Object.keys(bodyHV).length === 0) continue;
      let destinations = lookups.cargoDestinationsMap.get(cargoId) || [];
      if (destinations.length === 0) {
        // Fallback for tests or incomplete data: assume it can go to any other city
        destinations = Array.from(lookups.citiesById.keys()).filter(id => id !== cityId);
        // If still empty (single-city dataset), allow self-delivery
        if (destinations.length === 0) destinations = [cityId];
      }
      if (destinations.length === 0) continue;

      cargo.push({ cargoId, probCoef, unitVal, bodyHV, destinations });
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

/** Per-depot cargo items: cargoId, unitVal, bodyHV, normalised p — reused across EV evaluations. */
export type DepotItemsCache = Array<Array<{
  cargoId: string;
  unitVal: number;
  bodyHV: Record<string, number>;
  p: number;
}>>;

export function buildDepotItemsCache(depots: CityDepotData[]): DepotItemsCache {
  return depots.map((depot) =>
    depot.cargo.map((c) => ({
      cargoId: c.cargoId,
      unitVal: c.unitVal,
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
 *
 * If `bodyHV` storage ever shifts off Record, mirror `analyticalFirstPickEVForRep`'s `hvPerItem` precompute.
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

/**
 * Analytical first-pick EV for a multi-body profile. Same as
 * `analyticalFirstPickEV` but `hv` per cargo item is the max bodyHV across all
 * body types in the profile — so a multi-body trailer's flexibility shows up
 * in the ranking, not just in single-body slots.
 * For fleet-picking accuracy use `analyticalFirstPickEVForRep`.
 */
export function analyticalFirstPickEVProfile(
  depots: CityDepotData[],
  profile: string[],
  cache?: DepotItemsCache,
): number {
  if (profile.length === 1) return analyticalFirstPickEV(depots, profile[0], cache);

  const depotItems: DepotItemsCache = cache ?? buildDepotItemsCache(depots);

  const itemHv = (item: { bodyHV: Record<string, number> }): number => {
    let m = 0;
    for (const bt of profile) {
      const v = item.bodyHV[bt] || 0;
      if (v > m) m = v;
    }
    return m;
  };

  const hvSet = new Set<number>([0]);
  for (const items of depotItems) {
    for (const item of items) {
      const hv = itemHv(item);
      if (hv > 0) hvSet.add(hv);
    }
  }

  const hvValues = [...hvSet].sort((a, b) => a - b);
  if (hvValues.length <= 1) return 0;

  function totalCDF(H: number): number {
    let result = 1;
    for (const items of depotItems) {
      let cdf = 0;
      for (const item of items) {
        if (itemHv(item) <= H) cdf += item.p;
      }
      result *= Math.pow(cdf, JOBS_PER_DEPOT);
    }
    return result;
  }

  let ev = 0;
  for (let i = 1; i < hvValues.length; i++) {
    const pMax = totalCDF(hvValues[i]) - totalCDF(hvValues[i - 1]);
    ev += hvValues[i] * pMax;
  }
  return ev;
}

/**
 * Analytical first-pick EV using the rep's actual per-cargo HV
 * (weight/volume-clamped via cargoTrailerUnits). Correct EV for the fleet picker.
 */
export function analyticalFirstPickEVForRep(
  depots: CityDepotData[],
  repId: string,
  lookups: Lookups,
  cache?: DepotItemsCache,
  cargoExtraValue?: Map<string, number>,
): number {
  const depotItems: DepotItemsCache = cache ?? buildDepotItemsCache(depots);

  // Precompute per-depot, per-item HV once.
  const hvPerItem: number[][] = depotItems.map((items) =>
    items.map((item) => {
      const units = lookups.cargoTrailerUnits.get(`${item.cargoId}:${repId}`) ?? 0;
      if (units <= 0) return 0;
      const extra = cargoExtraValue?.get(item.cargoId) ?? 0;
      return (item.unitVal * units) + extra;
    })
  );

  const hvSet = new Set<number>([0]);
  for (const depotHvs of hvPerItem) {
    for (const hv of depotHvs) {
      if (hv > 0) hvSet.add(hv);
    }
  }

  const hvValues = [...hvSet].sort((a, b) => a - b);
  if (hvValues.length <= 1) return 0;

  function totalCDF(H: number): number {
    let result = 1;
    for (let d = 0; d < depotItems.length; d++) {
      const items = depotItems[d];
      const hvs = hvPerItem[d];
      let cdf = 0;
      for (let i = 0; i < items.length; i++) {
        if (hvs[i] <= H) cdf += items[i].p;
      }
      result *= Math.pow(cdf, JOBS_PER_DEPOT);
    }
    return result;
  }

  let ev = 0;
  for (let i = 1; i < hvValues.length; i++) {
    const pMax = totalCDF(hvValues[i]) - totalCDF(hvValues[i - 1]);
    ev += hvValues[i] * pMax;
  }
  return ev;
}

// ============================================
// Seeded PRNG for deterministic MC results
// ============================================

/** mulberry32 — fast 32-bit seeded PRNG, returns [0, 1) */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple string hash for seeding PRNG from city ID */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

// Module-level RNG, initialized per computeOptimalFleet call
let rng: () => number = Math.random;

// ============================================
// Monte Carlo simulation helpers
// ============================================

/** Fast binary-search pick from a depot's cargo CDF */
function mcPick(depot: CityDepotData): DepotCargoItem {
  const r = rng();
  let lo = 0, hi = depot.cumProbs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (depot.cumProbs[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return depot.cargo[lo];
}

/** Fill a pre-allocated board buffer in-place. Returns number of slots filled. */
function fillBoard(
  buffer: DepotCargoItem[],
  destIdxBuffer: number[],
  depots: CityDepotData[],
  cityToIndex: Map<string, number>,
): number {
  let idx = 0;
  for (const depot of depots) {
    for (let j = 0; j < JOBS_PER_DEPOT; j++) {
      const item = mcPick(depot);
      buffer[idx] = item;
      const destId = item.destinations[Math.floor(rng() * item.destinations.length)];
      destIdxBuffer[idx] = cityToIndex.get(destId) ?? -1;
      idx++;
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

/** Best job for rep; reads pre-populated repHV[repId]. Includes return benefit. */
function bestJobForRep(
  board: DepotCargoItem[],
  destIdxBuffer: number[],
  repId: string,
  benefitArray: Float64Array,
): { hv: number; idx: number } {
  let best = -1, bestIdx = -1;
  for (let i = 0; i < board.length; i++) {
    const outboundHV = board[i].repHV?.[repId] ?? 0;
    if (outboundHV <= 0) continue;

    const dIdx = destIdxBuffer[i];
    const returnBenefit = dIdx >= 0 ? benefitArray[dIdx] : 0;
    const totalHV = outboundHV + returnBenefit;

    if (totalHV > best) {
      best = totalHV;
      bestIdx = i;
    }
  }
  return { hv: Math.max(0, best), idx: bestIdx };
}

// ============================================
// Body type display info (country-aware)
// ============================================

interface TrailerInfo {
  trailerId: string;
  trailerSpec: string;
  estimatedPrice: number;
  levelFloor: number;
}

/** Cache: country → profileKey → best trailer info matching that exact profile */
const profileTrailerCache = new Map<string, Map<string, TrailerInfo & { bodyTypes: string[] }>>();

/** Cache: cityId → repId → return benefit (EV - P_empty * penalty) */
const returnBenefitCache = new Map<string, Map<string, number>>();

/** Clear trailer info cache — needed when DLC filter state changes between optimizer runs */
export function clearTrailerInfoCache(): void {
  profileTrailerCache.clear();
  returnBenefitCache.clear();
}

/**
 * Get (or compute) the analytical return benefit for a trailer at a city.
 * Benefit = analyticalFirstPickEV - (probOfNoJobs * EMPTY_RETURN_PENALTY).
 */
function getReturnBenefit(cityId: string, repId: string, data: AllData, lookups: Lookups): number {
  let cityMap = returnBenefitCache.get(cityId);
  if (!cityMap) {
    cityMap = new Map<string, number>();
    returnBenefitCache.set(cityId, cityMap);
  }

  if (cityMap.has(repId)) return cityMap.get(repId)!;

  const depots = buildCityDepotProfiles(cityId, lookups);
  if (!depots) {
    cityMap.set(repId, 0);
    return 0;
  }

  // totalCDF(0) gives the probability that no jobs are compatible/available
  const depotItems = buildDepotItemsCache(depots);
  const hvPerItem: number[][] = depotItems.map((items) =>
    items.map((item) => {
      const units = lookups.cargoTrailerUnits.get(`${item.cargoId}:${repId}`) ?? 0;
      return item.unitVal * units;
    })
  );

  function probNoJobs(): number {
    let result = 1;
    for (let d = 0; d < depotItems.length; d++) {
      const items = depotItems[d];
      const hvs = hvPerItem[d];
      let cdf = 0;
      for (let i = 0; i < items.length; i++) {
        if (hvs[i] <= 0) cdf += items[i].p;
      }
      result *= Math.pow(cdf, JOBS_PER_DEPOT);
    }
    return result;
  }

  const pEmpty = probNoJobs();
  const ev = analyticalFirstPickEVForRep(depots, repId, lookups, depotItems);
  const benefit = ev - (pEmpty * EMPTY_RETURN_PENALTY);

  cityMap.set(repId, benefit);
  return benefit;
}

/**
 * Distinct body-type profiles available in a country: each entry is the
 * sorted body-type set of at least one ownable trailer valid here. Multi-body
 * trailers contribute >1-sized profiles via `extra_body_types`.
 *
 * Also returns the best (cheapest among walked > parser > unpriced) trailer
 * realizing each profile — for display purposes after the optimizer picks.
 */
function getProfileTrailerInfoForCountry(
  country: string, data: AllData, lookups: Lookups,
): Map<string, TrailerInfo & { bodyTypes: string[] }> {
  const cached = profileTrailerCache.get(country);
  if (cached) return cached;

  // Per profile, track best trailer by total haul value across its body-type slots.
  const bestByProfile = new Map<string, { trailer: Trailer; bodyTypes: string[]; totalHV: number }>();

  for (const t of data.trailers) {
    if (!t.ownable) continue;
    if (t.country_validity && t.country_validity.length > 0
      && !t.country_validity.includes(country)) continue;

    const cargoSet = lookups.trailerCargoMap.get(t.id);
    if (!cargoSet) continue;

    // Profile *key* is canonical (sorted) so cache lookups dedupe, but the
    // bodyTypes array we expose retains chassis-natural order — primary first,
    // then declared extras — so OptimalFleetEntry.bodyType (= bodyTypes[0]) is
    // the trailer's true primary, not the alphabetically-first body type.
    const bodyTypes = [t.body_type, ...(t.extra_body_types ?? [])];
    const key = profileKey(bodyTypes);

    let totalHV = 0;
    for (const cargoId of cargoSet) {
      const c = lookups.cargoById.get(cargoId);
      if (!c || c.excluded) continue;
      const matches = c.body_types.some((bt) => bodyTypes.includes(bt));
      if (!matches) continue;
      const units = lookups.cargoTrailerUnits.get(`${cargoId}:${t.id}`) ?? 1;
      const bonus = cargoBonus(c);
      totalHV += c.value * bonus * units;
    }
    if (totalHV === 0) continue;

    const existing = bestByProfile.get(key);
    if (!existing) {
      bestByProfile.set(key, { trailer: t, bodyTypes, totalHV });
      continue;
    }
    if (totalHV > existing.totalHV) {
      bestByProfile.set(key, { trailer: t, bodyTypes, totalHV });
      continue;
    }
    if (totalHV === existing.totalHV) {
      // Tiebreaker: walked > parser > unpriced, then lowest price within tier.
      // Parser prices are chain_base only and unreliable, so any walked sibling beats them.
      const curWalked = existing.trailer.priceWalked === true;
      const newWalked = t.priceWalked === true;
      const curPriced = existing.trailer.price > 0;
      const newPriced = t.price > 0;
      if (newWalked && !curWalked) {
        bestByProfile.set(key, { trailer: t, bodyTypes, totalHV });
      } else if (newWalked === curWalked) {
        if (newPriced && (!curPriced || t.price < existing.trailer.price)) {
          bestByProfile.set(key, { trailer: t, bodyTypes, totalHV });
        }
      }
    }
  }

  const info = new Map<string, TrailerInfo & { bodyTypes: string[] }>();
  for (const [key, { trailer, bodyTypes }] of bestByProfile) {
    info.set(key, {
      trailerId: trailer.id,
      trailerSpec: formatTrailerSpec(trailer),
      estimatedPrice: trailer.price,
      levelFloor: trailer.level_floor,
      bodyTypes,
    });
  }

  profileTrailerCache.set(country, info);
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

/** Count distinct cargo types compatible with ANY body type in a profile across city depots */
function countCityCargoForProfile(depots: CityDepotData[], bodyTypes: string[]): number {
  const cargoIds = new Set<string>();
  for (const depot of depots) {
    for (const c of depot.cargo) {
      for (const bt of bodyTypes) {
        if (c.bodyHV[bt]) { cargoIds.add(c.cargoId); break; }
      }
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
export interface ComputeFleetOptions {
  /** Override MC sample count. Defaults to MC_SIMS (20k). Pass RANKING_MC_SIMS for city rankings. */
  mcSims?: number;
}

export function computeOptimalFleet(
  cityId: string, data: AllData, lookups: Lookups,
  opts?: ComputeFleetOptions,
): OptimalFleet | null {
  const mcSims = opts?.mcSims ?? MC_SIMS;

  // Seed PRNG from city ID for deterministic results
  rng = mulberry32(hashString(cityId));

  const depots = buildCityDepotProfiles(cityId, lookups);
  if (!depots) return null;

  const city = lookups.citiesById.get(cityId);
  const country = city?.country ?? '';
  const profileInfo = getProfileTrailerInfoForCountry(country, data, lookups);

  // Collect all body types and eliminate dominated ones (kept body-type level
  // since domination semantics are about cargo-coverage subsumption, not multi-body flexibility).
  const allBodyTypes = new Set<string>();
  for (const depot of depots) {
    for (const c of depot.cargo) {
      for (const bt of Object.keys(c.bodyHV)) allBodyTypes.add(bt);
    }
  }

  const dominated = findDominatedBodyTypes(depots, allBodyTypes);

  // Build depot items cache once; reused for every profile evaluation below.
  const depotItemsCache = buildDepotItemsCache(depots);

  const cityToIndex = new Map<string, number>();
  data.cities.forEach((c, i) => cityToIndex.set(c.id, i));

  // Candidate profiles drop any body_type that's dominated or absent in city depots;
  // a multi-body profile survives as long as at least one of its body_types remains.
  const candidates: Array<{ key: string; bodyTypes: string[]; repId: string; ev: number }> = [];
  for (const [key, info] of profileInfo) {
    const surviving = info.bodyTypes.filter((bt) => allBodyTypes.has(bt) && !dominated.has(bt));
    if (surviving.length === 0) continue;

    // For analytical candidate selection, compute mean return benefit across all reachable destinations
    const cargoReturnBenefits = new Map<string, number>();
    for (const depot of depots) {
      for (const item of depot.cargo) {
        if (cargoReturnBenefits.has(item.cargoId)) continue;
        const meanBenefit = item.destinations.length > 0
          ? item.destinations.reduce((sum, d) => sum + getReturnBenefit(d, info.trailerId, data, lookups), 0) / item.destinations.length
          : 0;
        cargoReturnBenefits.set(item.cargoId, meanBenefit);
      }
    }

    const ev = analyticalFirstPickEVForRep(depots, info.trailerId, lookups, depotItemsCache, cargoReturnBenefits);
    if (ev > 0) candidates.push({ key, bodyTypes: surviving, repId: info.trailerId, ev });
  }
  candidates.sort((a, b) => b.ev - a.ev);

  const viableProfiles = candidates.slice(0, 15);
  if (viableProfiles.length === 0) return null;

  // Pre-compute benefit arrays for viable profiles
  const benefitMatrices = new Map<string, Float64Array>();
  for (const cand of viableProfiles) {
    const arr = new Float64Array(data.cities.length);
    for (const c of data.cities) {
      arr[cityToIndex.get(c.id)!] = getReturnBenefit(c.id, cand.repId, data, lookups);
    }
    benefitMatrices.set(cand.repId, arr);
  }

  // Cache rep HV per (cargo, viable rep) so the MC inner loop is pure array access.
  populateRepHV(depots, viableProfiles.map((p) => p.repId), lookups);

  // Pre-allocate board buffers
  const totalSlots = depots.length * JOBS_PER_DEPOT;
  const boardBuffer: DepotCargoItem[] = new Array(totalSlots);
  const destIdxBuffer: number[] = new Array(totalSlots);

  // Phase 1: Greedy driver selection by profile (body-type set + rep trailer).
  const fleet: Array<{ key: string; bodyTypes: string[]; repId: string }> = [];

  for (let pick = 0; pick < MAX_DRIVERS; pick++) {
    // Generate shared boards for this round
    const rawBoards: DepotCargoItem[][] = [];
    const rawDestIdx: number[][] = [];
    for (let s = 0; s < mcSims; s++) {
      const len = fillBoard(boardBuffer, destIdxBuffer, depots, cityToIndex);
      rawBoards.push(boardBuffer.slice(0, len));
      rawDestIdx.push(destIdxBuffer.slice(0, len));
    }

    // Pre-compute base fleet simulation on each board (existing drivers pick first)
    const baseRemainders: Array<{ board: DepotCargoItem[]; destIdx: number[] }> = [];
    for (let s = 0; s < mcSims; s++) {
      const board = rawBoards[s].slice();
      const destIdx = rawDestIdx[s].slice();
      for (const driver of fleet) {
        const benefits = benefitMatrices.get(driver.repId)!;
        const { hv, idx } = bestJobForRep(board, destIdx, driver.repId, benefits);
        if (hv > 0 && idx >= 0) {
          board[idx] = board[board.length - 1];
          board.pop();
          destIdx[idx] = destIdx[destIdx.length - 1];
          destIdx.pop();
        }
      }
      baseRemainders.push({ board, destIdx });
    }

    // Evaluate each candidate profile's marginal contribution
    let bestProfile: { key: string; bodyTypes: string[]; repId: string } | null = null;
    let bestMarginal = -1;
    for (const cand of viableProfiles) {
      const benefits = benefitMatrices.get(cand.repId)!;
      let marginalSum = 0;
      for (const rem of baseRemainders) {
        marginalSum += bestJobForRep(rem.board, rem.destIdx, cand.repId, benefits).hv;
      }
      const marginal = marginalSum / mcSims;
      if (marginal > bestMarginal) {
        bestMarginal = marginal;
        bestProfile = { key: cand.key, bodyTypes: cand.bodyTypes, repId: cand.repId };
      }
    }

    if (bestMarginal <= 0 || !bestProfile) break;
    fleet.push(bestProfile);
  }

  if (fleet.length === 0) return null;

  // Phase 2: Compute per-driver EVs with final fleet
  const driverEVs = new Array(fleet.length).fill(0);

  for (let s = 0; s < mcSims; s++) {
    const len = fillBoard(boardBuffer, destIdxBuffer, depots, cityToIndex);
    const remaining = boardBuffer.slice(0, len);
    const remainingDestIdx = destIdxBuffer.slice(0, len);
    for (let d = 0; d < fleet.length; d++) {
      const benefits = benefitMatrices.get(fleet[d].repId)!;
      const { hv, idx } = bestJobForRep(remaining, remainingDestIdx, fleet[d].repId, benefits);
      if (hv > 0 && idx >= 0) {
        driverEVs[d] += hv;
        remaining[idx] = remaining[remaining.length - 1];
        remaining.pop();
        remainingDestIdx[idx] = remainingDestIdx[remainingDestIdx.length - 1];
        remainingDestIdx.pop();
      }
    }
  }

  for (let d = 0; d < fleet.length; d++) driverEVs[d] /= mcSims;

  // True fleet EV (sum of per-driver EVs) — used as ranking score below.
  const totalFleetEV = driverEVs.reduce((s, e) => s + e, 0);

  // Collapse fleet into counts by profile key. For stacked profiles, accumulate
  // each instance's per-driver EV and average at the end — first-pick alone is
  // misleading because picks 2+ of the same profile earn meaningfully less.
  const driverMap = new Map<string, { evSum: number; count: number; bodyTypes: string[] }>();
  for (let d = 0; d < fleet.length; d++) {
    const driver = fleet[d];
    const existing = driverMap.get(driver.key);
    if (existing) {
      existing.evSum += driverEVs[d];
      existing.count++;
    } else {
      driverMap.set(driver.key, { evSum: driverEVs[d], count: 1, bodyTypes: driver.bodyTypes });
    }
  }

  const drivers: OptimalFleetEntry[] = [...driverMap.entries()].map(([key, { evSum, count, bodyTypes }]) => {
    const info = profileInfo.get(key);
    const primary = bodyTypes[0];
    const cargoMatched = countCityCargoForProfile(depots, bodyTypes);
    return {
      displayName: profileDisplayName(bodyTypes),
      bodyType: primary,
      bodyTypes,
      trailerId: info?.trailerId ?? primary,
      trailerSpec: info?.trailerSpec ?? primary,
      ev: evSum / count,
      cargoMatched,
      count,
      estimatedPrice: info?.estimatedPrice ?? 0,
      levelFloor: info?.levelFloor ?? 0,
    };
  });

  const totalTrailers = drivers.reduce((s, d) => s + d.count, 0);
  const totalEstimatedPrice = drivers.reduce((s, d) => s + d.estimatedPrice * d.count, 0);
  const fleetLevelFloor = drivers.reduce((m, d) => Math.max(m, d.levelFloor), 0);

  return { drivers, totalTrailers, totalEstimatedPrice, fleetLevelFloor, totalFleetEV };
}

// ============================================
// City rankings (analytical)
// ============================================

/** Rank all cities by greedy fleet EV. See CLAUDE.md "City Ranking Score". */
export function calculateCityRankings(
  data: AllData, lookups: Lookups,
): CityRanking[] {
  const rankings: CityRanking[] = [];

  for (const city of data.cities) {
    const fleet = computeOptimalFleet(city.id, data, lookups, { mcSims: RANKING_MC_SIMS });
    if (!fleet || fleet.drivers.length === 0) continue;

    const depots = buildCityDepotProfiles(city.id, lookups);
    if (!depots) continue;

    const cityCompanies = lookups.cityCompanyMap.get(city.id) || [];
    let depotCount = 0;
    for (const { count } of cityCompanies) depotCount += count;

    // Count unique cargo types across all depots
    const cargoIds = new Set<string>();
    for (const depot of depots) {
      for (const c of depot.cargo) cargoIds.add(c.cargoId);
    }

    const score = fleet.totalFleetEV;

    // Top trailers = the actual fleet picks (pick order ≈ EV desc, but sort
    // explicitly by per-profile fleet contribution to honour the rankings
    // table's "sorted by cityValue desc" contract).
    const topTrailers: FleetEntry[] = fleet.drivers
      .map<FleetEntry>((d) => ({
        trailerId: d.trailerId,
        bodyType: d.bodyType,
        bodyTypes: d.bodyTypes,
        chainType: 'single',
        countryValidity: [],
        displayName: d.displayName,
        trailerSpec: d.trailerSpec,
        cityValue: d.ev * d.count,
        pctOfTotal: score > 0 ? (d.ev * d.count / score) * 100 : 0,
        cargoMatched: d.cargoMatched,
        variants: d.count,
      }))
      .sort((a, b) => b.cityValue - a.cityValue)
      .slice(0, TOP_TRAILERS);

    rankings.push({
      id: city.id,
      name: city.name,
      displayName: city.displayName,
      country: city.country,
      countryName: city.countryName,
      hasGarage: city.hasGarage,
      depotCount,
      cargoTypes: cargoIds.size,
      score,
      topTrailers,
      fleet,
    });
  }

  rankings.sort((a, b) => b.score - a.score);
  return rankings;
}
