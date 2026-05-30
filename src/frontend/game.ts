/**
 * Game identity system — ETS2 / ATS selector.
 *
 * The active game determines which data files to load, which DLC registries
 * to use, and which localStorage namespace to read/write.
 */

export type GameId = 'ets2' | 'ats';

export interface GameMeta {
  id: GameId;
  name: string;          // "Euro Truck Simulator 2"
  shortName: string;     // "ETS2"
  subtitle: string;      // shown below the title
  dataDir: string;       // "ets2" — subdirectory under /data/
  currencySymbol: string; // "€" for ETS2, "$" for ATS
  regionNoun: string;       // "Country" (ETS2) / "State" (ATS) — ATS data models US states as "countries"
  regionNounPlural: string; // "Countries" / "States"
}

export const GAMES: Record<GameId, GameMeta> = {
  ets2: {
    id: 'ets2',
    name: 'Euro Truck Simulator 2',
    shortName: 'ETS2',
    subtitle: 'Your AI drivers haul cargo from city garages. This tool finds the best trailer mix per garage to maximize income.',
    dataDir: 'ets2',
    currencySymbol: '€',
    regionNoun: 'Country',
    regionNounPlural: 'Countries',
  },
  ats: {
    id: 'ats',
    name: 'American Truck Simulator',
    shortName: 'ATS',
    subtitle: 'Your AI drivers haul cargo from city garages. This tool finds the best trailer mix per garage to maximize income.',
    dataDir: 'ats',
    currencySymbol: '$',
    regionNoun: 'State',
    regionNounPlural: 'States',
  },
};

const GAME_KEY = 'trucker-game';

/** Get the active game. Defaults to ETS2. */
export function getActiveGame(): GameId {
  try {
    const stored = localStorage.getItem(GAME_KEY);
    if (stored === 'ats') return 'ats';
  } catch { /* not in browser */ }
  return 'ets2';
}

/** Set the active game and reload the page. */
export function setActiveGame(id: GameId): void {
  localStorage.setItem(GAME_KEY, id);
  window.location.reload();
}

/** Get metadata for the active game. */
export function getGameMeta(): GameMeta {
  return GAMES[getActiveGame()];
}

/**
 * Region term for the active game — "Country/Countries" (ETS2) or "State/States"
 * (ATS). The data model stores both as `country`; this is the user-facing label.
 */
export function getRegionTerms(): { singular: string; plural: string } {
  const m = getGameMeta();
  return { singular: m.regionNoun, plural: m.regionNounPlural };
}
