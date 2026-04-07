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
}

export const GAMES: Record<GameId, GameMeta> = {
  ets2: {
    id: 'ets2',
    name: 'Euro Truck Simulator 2',
    shortName: 'ETS2',
    subtitle: 'Your AI drivers haul cargo from city garages. This tool finds the best trailer mix per garage to maximize income.',
    dataDir: 'ets2',
  },
  ats: {
    id: 'ats',
    name: 'American Truck Simulator',
    shortName: 'ATS',
    subtitle: 'Your AI drivers haul cargo from city garages. This tool finds the best trailer mix per garage to maximize income.',
    dataDir: 'ats',
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
