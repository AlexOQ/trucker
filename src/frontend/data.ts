/**
 * Data layer barrel re-export for ETS2 Trucker Advisor
 *
 * This module re-exports everything from the focused sub-modules
 * for backward compatibility. Consumers can import from here or
 * directly from the specific module.
 *
 * Sub-modules:
 * - types.ts          — All interfaces and type definitions
 * - loader.ts         — JSON loading, entity builders, data caching
 * - lookups.ts        — buildLookups() for efficient access maps
 * - dlc-filter.ts     — applyDLCFilter(), getBlockedCities()
 * - trailer-profiles.ts — Trailer earning profiles, dedup, city scoring
 * - body-types.ts     — Body type profiles, chassis merging
 * - utils.ts          — normalize(), formatTrailerSpec(), trailerTotalHV(), etc.
 */

// Types
export type {
  City, Company, Cargo, Trailer,
  GameDefs, Observations, AllData, Lookups,
  BodyTypeProfile, UniqueTrailerType, TrailerCargoEntry, TrailerProfile,
  CargoWeight, DepotProfile, CityCargoProfile, TrailerCityScore, CargoPoolEntry,
} from './types';

// Loader
export { loadAllData } from './loader';

// Lookups
export { buildLookups } from './lookups';

// DLC filter
export { applyDLCFilter, getBlockedCities } from './dlc-filter';

// Trailer profiles
export {
  buildTrailerProfiles, buildDepotProfiles, buildCityCargoProfile,
  scoreTrailerInCity, rankTrailersForCity,
  deduplicateTrailerProfiles, getUniqueTrailerTypes,
  getCityCargoPool,
} from './trailer-profiles';

// Body types
export { getBodyTypeProfiles, getChassisMergeMap } from './body-types';

// Page initialization
export { initPageData, type PageData } from './page-init';

// Utils
export {
  cargoBonus,
  normalize, formatTrailerSpec, trailerTotalHV, pickBestTrailer,
  titleCase, getOwnableTrailers,
} from './utils';
