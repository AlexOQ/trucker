/**
 * Shared page initialization for ETS2 Trucker Advisor
 *
 * Centralizes the data loading + DLC filtering + lookup building
 * sequence that every page module needs. When DLC filtering logic
 * changes, only this file needs updating.
 */

import { getActiveGame, setActiveGame, getGameMeta, type GameId } from './game';
import { loadAllData } from './loader';
import { buildLookups } from './lookups';
import { applyDLCFilter, getBlockedCities } from './dlc-filter';
import {
  getOwnedTrailerDLCs, getOwnedCargoDLCs, getOwnedMapDLCs,
  COMBINED_CARGO_DLC_MAP, CITY_DLC_MAP,
  getTheme, toggleTheme,
} from './storage';
import type { AllData, Lookups } from './types';

export interface PageData {
  data: AllData;
  lookups: Lookups;
}

/**
 * Wire up the theme toggle button (present in every page's nav).
 * Safe to call even if the button doesn't exist.
 */
export function initThemeToggle(): void {
  const btn = document.getElementById('theme-toggle') as HTMLButtonElement | null;
  if (!btn) return;

  function updateIcon() {
    const theme = getTheme();
    // Sun icon for dark mode (click to switch to light), moon for light mode
    btn!.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
  }

  updateIcon();

  btn.addEventListener('click', () => {
    toggleTheme();
    updateIcon();
  });
}

/**
 * Wire up the game selector (ETS2 / ATS toggle in every page's nav).
 * Sets page title and subtitle based on active game.
 */
export function initGameSelector(): void {
  const meta = getGameMeta();
  const activeGame = getActiveGame();

  // Set page title and subtitle
  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = `${meta.shortName} Trucker Advisor`;
  if (subtitleEl) subtitleEl.textContent = meta.subtitle;
  document.title = `${meta.shortName} Trucker Advisor`;

  // Highlight active game button
  const selector = document.getElementById('game-selector');
  if (!selector) return;

  selector.querySelectorAll('.game-btn').forEach((btn) => {
    const gameId = (btn as HTMLElement).dataset.game as GameId;
    if (gameId === activeGame) btn.classList.add('active');

    btn.addEventListener('click', () => {
      if (gameId !== activeGame) setActiveGame(gameId);
    });
  });
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
  // loadAllData() must run first — it calls initDlcData() which overrides
  // the DLC registries (ALL_MAP_DLC_IDS, CITY_DLC_MAP, etc.) with the
  // active game's data. DLC ownership reads must come AFTER this.
  const rawData = await loadAllData();

  const ownedCargoAndMap = new Set([...getOwnedCargoDLCs(), ...getOwnedMapDLCs()]);
  const blocked = getBlockedCities(getOwnedMapDLCs(), CITY_DLC_MAP);
  const data = applyDLCFilter(
    rawData,
    getOwnedTrailerDLCs(),
    ownedCargoAndMap,
    COMBINED_CARGO_DLC_MAP,
    blocked,
  );
  const lookups = buildLookups(data);
  return { data, lookups };
}
