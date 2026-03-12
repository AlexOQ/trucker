/**
 * Shared page initialization for ETS2 Trucker Advisor
 *
 * Centralizes the data loading + DLC filtering + lookup building
 * sequence that every page module needs. When DLC filtering logic
 * changes, only this file needs updating.
 */

import { loadAllData } from './loader';
import { buildLookups } from './lookups';
import { applyDLCFilter, getBlockedCities } from './dlc-filter';
import {
  getOwnedTrailerDLCs, getOwnedCargoDLCs, getOwnedMapDLCs,
  COMBINED_CARGO_DLC_MAP, CITY_DLC_MAP,
} from './storage';
import type { AllData, Lookups } from './types';

export interface PageData {
  data: AllData;
  lookups: Lookups;
}

/**
 * Load game data, apply DLC ownership filters, and build lookup maps.
 *
 * Every browser page calls this once at startup. The sequence is:
 * 1. loadAllData()       — fetch game-defs.json + observations.json
 * 2. applyDLCFilter()    — remove content from unowned DLCs
 * 3. buildLookups()      — build efficient access maps
 */
export async function initPageData(): Promise<PageData> {
  const ownedCargoAndMap = new Set([...getOwnedCargoDLCs(), ...getOwnedMapDLCs()]);
  const blocked = getBlockedCities(getOwnedMapDLCs(), CITY_DLC_MAP);
  const data = applyDLCFilter(
    await loadAllData(),
    getOwnedTrailerDLCs(),
    ownedCargoAndMap,
    COMBINED_CARGO_DLC_MAP,
    blocked,
  );
  const lookups = buildLookups(data);
  return { data, lookups };
}
