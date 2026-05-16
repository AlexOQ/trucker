/**
 * Type definitions for ETS2 Trucker Advisor
 *
 * Core interfaces and types used across the data layer.
 */

import type { DlcSection } from './dlc-data';

export interface City {
  id: string;
  name: string;           // native/game name (e.g. "København", "Αθήνα")
  displayName: string;    // English name (e.g. "Copenhagen", "Athens")
  country: string;        // country ID (e.g. "denmark")
  countryName: string;    // English country name (e.g. "Denmark")
  hasGarage: boolean;
}

export interface Company {
  id: string;
  name: string;
}

export interface Cargo {
  id: string;
  name: string;
  value: number;       // unit_reward_per_km from game defs
  volume: number;      // m3 per unit
  mass: number;        // kg per unit
  fragility: number;
  fragile: boolean;    // fragility >= 0.5
  high_value: boolean; // valuable: true in defs
  adr_class: number;
  prob_coef: number;   // spawn probability coefficient
  body_types: string[];
  groups: string[];
  excluded: boolean;
}

export interface Trailer {
  id: string;
  name: string;
  body_type: string;
  /**
   * Additional body types this trailer can physically haul beyond `body_type`.
   * Populated from `multi-body-overrides.json`. Example: a flatbed-with-container-pins
   * (body_type=container) can also serve as a regular flatbed when pins are unused,
   * so its `extra_body_types` is `['flatbed']`. Empty / unset for single-body trailers.
   */
  extra_body_types?: string[];
  /** Per-body-type volume override; missing keys fall back to `volume`. See multi-body-overrides.json. */
  bodyVolumes?: Record<string, number>;
  volume: number;
  chassis_mass: number;
  body_mass: number;
  gross_weight_limit: number;
  length: number;
  chain_type: string;
  country_validity?: string[];
  ownable: boolean;
  /** Total purchase price across all accessories, rounded UP to nearest 1000. 0 if no dealer data. */
  price: number;
  /**
   * True when `price` came from a hand-walked entry in manual-prices.json (full
   * configured cost). False/undefined when from parser, which reads only a
   * chain_base-adjacent field and is unreliable. Tiebreaker uses this to prefer
   * walked over parser-priced regardless of nominal value.
   */
  priceWalked?: boolean;
  /** Max accessory unlock level — level at which the trailer becomes available. 0 if no dealer data. */
  level_floor: number;
}

export interface GameDefs {
  cargo: Record<string, {
    name: string;
    value: number;
    volume: number;
    mass: number;
    fragility: number;
    fragile: boolean;
    high_value: boolean;
    adr_class: number;
    prob_coef: number;
    body_types: string[];
    groups: string[];
    excluded: boolean;
  }>;
  trailers: Record<string, {
    name: string;
    body_type: string;
    volume: number;
    chassis_mass: number;
    body_mass: number;
    gross_weight_limit: number;
    length: number;
    chain_type: string;
    country_validity?: string[];
    ownable: boolean;
    price: number;
    level_floor: number;
  }>;
  cities: Record<string, {
    name: string;
    country: string;
    has_garage?: boolean;
  }>;
  countries: Record<string, {
    name: string;
  }>;
  companies: Record<string, {
    name: string;
    cargo_out: string[];
    cargo_in: string[];
    cities: string[];
  }>;
  city_companies: Record<string, Record<string, number>>;
  company_cargo: Record<string, string[]>;
  cargo_trailers: Record<string, string[]>;
  cargo_trailer_units: Record<string, Record<string, number>>;
  economy: {
    fixed_revenue: number;
    revenue_coef_per_km: number;
    cargo_market_revenue_coef_per_km: number;
  };
  dlc?: DlcSection;
  trucks: Array<{
    id: string;
    brand: string;
    model: string;
    engines: Array<{
      id: string;
      name: string;
      torque: number;
      volume: number;
      rpm_limit: number;
      price: number;
      unlock: number;
    }>;
    transmissions: Array<{
      id: string;
      name: string;
      differential_ratio: number;
      forward_gears: number;
      reverse_gears: number;
      retarder: number;
      price: number;
      unlock: number;
    }>;
    chassis: Array<{
      id: string;
      name: string;
      axle_config: string;
      tank_size: number;
      price: number;
      unlock: number;
    }>;
    // Cabins + paints are optional so older game-defs.json snapshots (parsed
    // before #252) still type-check; loader.ts falls back to [] when missing.
    cabins?: Array<{
      id: string;
      name: string;
      price: number;
      unlock: number;
      /** Chassis IDs this cabin fits (fully-qualified, e.g. "4x2.volvo.fh_2024.chassis"). */
      suitable_for: string[];
    }>;
    paints?: Array<{
      id: string;
      name: string;
      price: number;
      unlock: number;
    }>;
  }>;
}

export interface Observations {
  meta: { saves_parsed: number; total_jobs: number; max_saves: number };
  variant_body_type: Record<string, string>;
  cities: string[];
  companies: string[];
  cargo: string[];
  trailers: string[];
  city_companies: Record<string, Record<string, number>>;
  company_cargo: Record<string, string[]>;
  cargo_trailers: Record<string, string[]>;
  cargo_frequency: Record<string, number>;
  cargo_spawn_weight: Record<string, number>;
  cargo_trailer_units: Record<string, Record<string, { median: number; count: number }>>;
  company_cargo_frequency: Record<string, Record<string, number>>;
  city_job_count: Record<string, number>;
  city_cargo_frequency: Record<string, Record<string, number>>;
  city_trailer_frequency: Record<string, Record<string, number>>;
  city_body_type_frequency: Record<string, Record<string, number>>;
  body_type_avg_value: Record<string, number>;
  city_zone_body_type_frequency: Record<string, Record<string, Record<string, number>>>;
  zone_body_type_avg_value: Record<string, Record<string, number>>;
  company_body_type_frequency?: Record<string, Record<string, number>>;
  company_zone_body_type_frequency?: Record<string, Record<string, Record<string, number>>>;
  company_job_count?: Record<string, number>;
  company_body_type_avg_value?: Record<string, Record<string, number>>;
}

/** Per-trailer entry in `multi-body-overrides.json` — see that file's `_doc`. */
export type MultiBodyOverrideEntry = string[] | {
  body_types: string[];
  volumes?: Record<string, number>;
};

/** Multi-body trailer overrides — see public/data/<game>/multi-body-overrides.json. */
export interface MultiBodyOverrides {
  game: 'ets2' | 'ats';
  schema_version: 1 | 2;
  /** trailerId -> body-type override entry (legacy bare array or object form) */
  overrides: Record<string, MultiBodyOverrideEntry>;
}

/**
 * Manual trailer-price walks — see public/data/<game>/manual-prices.json.
 * Frontend-side mirror of `scripts/types/manual-prices.ts`. Loaded at runtime
 * by `loader.ts` and applied to trailer.price + priceWalked, so walks show up
 * without needing to re-run the parser against the def/ folder.
 */
export interface ManualPriceEntry {
  price: number;
  source_pack?: string;
  last_verified_game_version?: string;
  notes?: string;
}
export interface ManualPricesFile {
  game: 'ets2' | 'ats';
  schema_version: 1;
  prices: Record<string, ManualPriceEntry>;
}

export interface AllData {
  gameDefs: GameDefs | null;
  observations: Observations | null;
  cities: City[];
  companies: Company[];
  cargo: Cargo[];
  trailers: Trailer[];
}

export interface Lookups {
  citiesById: Map<string, City>;
  companiesById: Map<string, Company>;
  cargoById: Map<string, Cargo>;
  trailersById: Map<string, Trailer>;
  cityCompanyMap: Map<string, Array<{ companyId: string; count: number }>>;
  companyCargoMap: Map<string, string[]>;
  trailerCargoMap: Map<string, Set<string>>;
  cargoTrailerMap: Map<string, Set<string>>;
  cargoTrailerUnits: Map<string, number>; // "cargoId:trailerId" -> units
}

export interface BodyTypeProfile {
  bodyType: string;
  displayName: string;
  cargoIds: Set<string>;
  cargoCount: number;
  bestTrailerId: string;     // absolute best trailer (any chain type) by totalHV
  bestTrailerName: string;
  bestTotalHV: number;       // sum of haulValue across all cargo for the best trailer
  bestChainType: string;     // chain_type of the best trailer
  bestCountries: string[];   // country_validity of the best trailer (empty = all)
  hasDoubles: boolean;
  hasBDoubles: boolean;
  hasHCT: boolean;
  doublesCountries: string[];
  bdoublesCountries: string[];
  hctCountries: string[];
  dominatedBy: string | null; // if non-null, this body type's cargo is a subset of the named body type
}

/** Result of deduplicating trailer profiles: unique earning types + dominated elimination */
export interface UniqueTrailerType {
  representative: TrailerProfile;   // the chosen representative trailer
  variants: string[];               // all trailer IDs that are cosmetically identical
  dominatedBy: string | null;       // if non-null, this type is dominated by another
}

/** A single cargo entry in a trailer's earning profile */
export interface TrailerCargoEntry {
  cargoId: string;
  units: number;         // max units on this specific trailer variant
  haulValue: number;     // value * bonus * units = max haul value/km
  spawnWeight: number;   // prob_coef (0.3-2.0)
}

/** Earning profile for one ownable trailer variant */
export interface TrailerProfile {
  trailerId: string;
  bodyType: string;
  volume: number;
  grossWeightLimit: number;
  length: number;
  chainType: string;            // single, double, b_double, hct
  countryValidity: string[];    // empty = all countries
  cargo: TrailerCargoEntry[];   // sorted by haulValue desc
  totalHaulValue: number;       // sum of all cargo haulValues
  totalWeightedValue: number;   // sum of haulValue * spawnWeight
}

/** A single cargo's contribution to a profile's spawn-weighted value */
export interface CargoWeight {
  cargoId: string;
  value: number;         // value * bonus (per unit per km)
  spawnWeight: number;   // prob_coef
  depotCount: number;    // how many depots spawn this cargo (city-level only)
  weightedValue: number; // value * spawnWeight * depotCount
}

/** Cargo profile for a depot type (company). Same company = same profile everywhere. */
export interface DepotProfile {
  companyId: string;
  companyName: string;
  cargo: CargoWeight[];
  totalWeightedValue: number;
}

/** Cargo profile for a city = sum of its depot profiles, weighted by depot counts. */
export interface CityCargoProfile {
  cityId: string;
  cityName: string;
  country: string;
  depotCount: number;                   // total depot slots
  companyCount: number;
  cargo: Map<string, CargoWeight>;      // cargoId -> aggregated weight
  totalWeightedValue: number;
}

/** A trailer type scored against a specific city */
export interface TrailerCityScore {
  trailerId: string;
  bodyType: string;
  chainType: string;
  cityValue: number;    // sum of haulValue * spawnWeight * depotCount for matching cargo
  cargoMatched: number; // how many of the city's cargo types this trailer covers
}

export interface CargoPoolEntry {
  companyId: string;
  depotCount: number;
  cargoId: string;
  cargoName: string;
  value: number;
  spawnWeight: number;
}
