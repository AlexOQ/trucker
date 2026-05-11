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
      cargo.push({ cargoId, probCoef, unitVal, bodyHV });
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
): number {
  const depotItems: DepotItemsCache = cache ?? buildDepotItemsCache(depots);

  // Precompute per-depot, per-item HV once. The body-typed twin reads
  // item.bodyHV[bt] in totalCDF directly (cheap property access); the rep
  // version's lookup is unitVal × Map.get(cargoTrailerUnits) — 10x heavier per
  // call. Skipping the precompute would multiply that cost by hvValues.length
  // inside totalCDF, which compounds at city-rankings scale.
  const hvPerItem: number[][] = depotItems.map((items) =>
    items.map((item) => {
      const units = lookups.cargoTrailerUnits.get(`${item.cargoId}:${repId}`) ?? 0;
      return item.unitVal * units;
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

/** Best job for rep; reads pre-populated repHV[repId]. */
function bestJobForRep(
  board: DepotCargoItem[], repId: string,
): { hv: number; idx: number } {
  let best = -1, bestIdx = -1;
  for (let i = 0; i < board.length; i++) {
    const hv = board[i].repHV?.[repId] ?? 0;
    if (hv > best) { best = hv; bestIdx = i; }
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

/** Clear trailer info cache — needed when DLC filter state changes between optimizer runs */
export function clearTrailerInfoCache(): void {
  profileTrailerCache.clear();
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
export function computeOptimalFleet(
  cityId: string, data: AllData, lookups: Lookups,
): OptimalFleet | null {
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

  // Candidate profiles drop any body_type that's dominated or absent in city depots;
  // a multi-body profile survives as long as at least one of its body_types remains.
  const candidates: Array<{ key: string; bodyTypes: string[]; repId: string; ev: number }> = [];
  for (const [key, info] of profileInfo) {
    const surviving = info.bodyTypes.filter((bt) => allBodyTypes.has(bt) && !dominated.has(bt));
    if (surviving.length === 0) continue;
    const ev = analyticalFirstPickEVForRep(depots, info.trailerId, lookups, depotItemsCache);
    if (ev > 0) candidates.push({ key, bodyTypes: surviving, repId: info.trailerId, ev });
  }
  candidates.sort((a, b) => b.ev - a.ev);

  const viableProfiles = candidates.slice(0, 15);
  if (viableProfiles.length === 0) return null;

  // Cache rep HV per (cargo, viable rep) so the MC inner loop is pure array access.
  populateRepHV(depots, viableProfiles.map((p) => p.repId), lookups);

  // Pre-allocate board buffer (reused across all MC simulations)
  const totalSlots = depots.length * JOBS_PER_DEPOT;
  const boardBuffer: DepotCargoItem[] = new Array(totalSlots);

  // Phase 1: Greedy driver selection by profile (body-type set + rep trailer)
  const fleet: Array<{ key: string; bodyTypes: string[]; repId: string }> = [];

  for (let pick = 0; pick < MAX_DRIVERS; pick++) {
    // Generate shared boards for this round
    const rawBoards: DepotCargoItem[][] = [];
    for (let s = 0; s < MC_SIMS; s++) {
      const len = fillBoard(boardBuffer, depots);
      rawBoards.push(boardBuffer.slice(0, len));
    }

    // Pre-compute base fleet simulation on each board (existing drivers pick first)
    const baseRemainders: DepotCargoItem[][] = [];
    for (const board of rawBoards) {
      const remaining = board.slice();
      for (const driver of fleet) {
        const { hv, idx } = bestJobForRep(remaining, driver.repId);
        if (hv > 0 && idx >= 0) {
          remaining[idx] = remaining[remaining.length - 1];
          remaining.pop();
        }
      }
      baseRemainders.push(remaining);
    }

    // Evaluate each candidate profile's marginal contribution
    let bestProfile: { key: string; bodyTypes: string[]; repId: string } | null = null;
    let bestMarginal = -1;
    for (const cand of viableProfiles) {
      let marginalSum = 0;
      for (const remaining of baseRemainders) {
        marginalSum += bestJobForRep(remaining, cand.repId).hv;
      }
      const marginal = marginalSum / MC_SIMS;
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

  for (let s = 0; s < MC_SIMS; s++) {
    const len = fillBoard(boardBuffer, depots);
    const remaining = boardBuffer.slice(0, len);
    for (let d = 0; d < fleet.length; d++) {
      const { hv, idx } = bestJobForRep(remaining, fleet[d].repId);
      if (hv > 0 && idx >= 0) {
        driverEVs[d] += hv;
        remaining[idx] = remaining[remaining.length - 1];
        remaining.pop();
      }
    }
  }

  for (let d = 0; d < fleet.length; d++) driverEVs[d] /= MC_SIMS;

  // Collapse fleet into counts by profile key
  const driverMap = new Map<string, { ev: number; count: number; bodyTypes: string[] }>();
  for (let d = 0; d < fleet.length; d++) {
    const driver = fleet[d];
    const existing = driverMap.get(driver.key);
    if (existing) {
      existing.count++;
    } else {
      driverMap.set(driver.key, { ev: driverEVs[d], count: 1, bodyTypes: driver.bodyTypes });
    }
  }

  const drivers: OptimalFleetEntry[] = [...driverMap.entries()].map(([key, { ev, count, bodyTypes }]) => {
    const info = profileInfo.get(key);
    const primary = bodyTypes[0];
    const cargoMatched = countCityCargoForProfile(depots, bodyTypes);
    return {
      displayName: profileDisplayName(bodyTypes),
      bodyType: primary,
      bodyTypes,
      trailerId: info?.trailerId ?? primary,
      trailerSpec: info?.trailerSpec ?? primary,
      ev,
      cargoMatched,
      count,
      estimatedPrice: info?.estimatedPrice ?? 0,
      levelFloor: info?.levelFloor ?? 0,
    };
  });

  const totalTrailers = drivers.reduce((s, d) => s + d.count, 0);
  const totalEstimatedPrice = drivers.reduce((s, d) => s + d.estimatedPrice * d.count, 0);
  const fleetLevelFloor = drivers.reduce((m, d) => Math.max(m, d.levelFloor), 0);

  return { drivers, totalTrailers, totalEstimatedPrice, fleetLevelFloor };
}

// ============================================
// City rankings (analytical)
// ============================================

/**
 * Rank all cities by total earning potential using analytical E[max of N].
 *
 * Score = sum of top RANKING_DRIVERS profiles' analytical first-pick EVs.
 * Profile-aware so multi-body trailers credit toward the city's score
 * (a `[flatbed, container]` trailer counts as a candidate that competes in
 * both pools, matching what `computeOptimalFleet` would actually pick).
 */
export function calculateCityRankings(
  data: AllData, lookups: Lookups,
): CityRanking[] {
  const rankings: CityRanking[] = [];

  for (const city of data.cities) {
    const depots = buildCityDepotProfiles(city.id, lookups);
    if (!depots) continue;

    const profileInfo = getProfileTrailerInfoForCountry(city.country, data, lookups);

    const cityCompanies = lookups.cityCompanyMap.get(city.id) || [];
    let depotCount = 0;
    for (const { count } of cityCompanies) depotCount += count;

    // Body types present in this city's depots; domination still computed at
    // body-type level (cargo-coverage relation is a single-bt notion).
    const allBodyTypes = new Set<string>();
    for (const depot of depots) {
      for (const c of depot.cargo) {
        for (const bt of Object.keys(c.bodyHV)) allBodyTypes.add(bt);
      }
    }

    const dominated = findDominatedBodyTypes(depots, allBodyTypes);
    const depotItemsCache = buildDepotItemsCache(depots);

    // Per profile: analytical first-pick EV over the profile's surviving (non-dominated, present) body types.
    // Use rep-HV (same as fleet picker) so top-N picks match.
    const profileEVs: Array<{ key: string; bodyTypes: string[]; ev: number }> = [];
    for (const [key, info] of profileInfo) {
      const surviving = info.bodyTypes.filter((bt) => allBodyTypes.has(bt) && !dominated.has(bt));
      if (surviving.length === 0) continue;
      const ev = analyticalFirstPickEVForRep(depots, info.trailerId, lookups, depotItemsCache);
      if (ev > 0) profileEVs.push({ key, bodyTypes: surviving, ev });
    }
    profileEVs.sort((a, b) => b.ev - a.ev);

    if (profileEVs.length === 0) continue;

    // Score = sum of top N profile EVs
    const topN = profileEVs.slice(0, RANKING_DRIVERS);
    const score = topN.reduce((s, e) => s + e.ev, 0);

    // Count unique cargo types across all depots
    const cargoIds = new Set<string>();
    for (const depot of depots) {
      for (const c of depot.cargo) cargoIds.add(c.cargoId);
    }

    // Build top trailer entries for display
    const topTrailers: FleetEntry[] = profileEVs.slice(0, TOP_TRAILERS).map((e) => {
      const info = profileInfo.get(e.key);
      const primary = e.bodyTypes[0];
      return {
        trailerId: info?.trailerId ?? primary,
        bodyType: primary,
        bodyTypes: e.bodyTypes,
        chainType: 'single',
        countryValidity: [],
        displayName: profileDisplayName(e.bodyTypes),
        trailerSpec: info?.trailerSpec ?? primary,
        cityValue: e.ev,
        pctOfTotal: score > 0 ? (e.ev / score) * 100 : 0,
        cargoMatched: countCityCargoForProfile(depots, e.bodyTypes),
        variants: 1,
      };
    });

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
    });
  }

  rankings.sort((a, b) => b.score - a.score);
  return rankings;
}
