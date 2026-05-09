import { readFileSync, existsSync } from 'fs';
import type { ManualPricesFile } from './types/manual-prices';

interface Priced {
  id: string;
  price: number;
}

export interface MergeManualPricesResult<T extends Priced> {
  trailers: T[];
  /** Manual entries applied to a previously-unpriced (price=0) trailer. */
  applied: number;
  /** Manual entries that overrode a parser-derived price. Manual wins because dealer-stock includes accessories the parser misses; parserPrice retained for diff-advisory. */
  overrides: Array<{ id: string; parserPrice: number; manualPrice: number }>;
  /** Manual entries whose id has no matching trailer in the parsed data. */
  unknownIds: string[];
}

/**
 * Apply manual price overrides to parsed trailers. Pure: returns a new array,
 * does not mutate the input. Manual prices replace parser-derived prices
 * unconditionally — dealer-stock prices reflect player-visible reality
 * (parser sums miss paint/accessories per AlexOQ/trucker#254). Pre-existing
 * parser prices are preserved in `overrides` for diff-advisory tracking.
 */
export function mergeManualPrices<T extends Priced>(
  trailers: T[],
  manualPath: string,
  expectedGame: 'ets2' | 'ats',
): MergeManualPricesResult<T> {
  if (!existsSync(manualPath)) {
    return { trailers, applied: 0, overrides: [], unknownIds: [] };
  }
  const data = JSON.parse(readFileSync(manualPath, 'utf-8')) as ManualPricesFile;

  if (data.game !== expectedGame) {
    throw new Error(
      `manual-prices.json game=${data.game} but parser running with --game ${expectedGame}`,
    );
  }
  if (data.schema_version !== 1) {
    throw new Error(
      `manual-prices.json schema_version=${data.schema_version}, expected 1`,
    );
  }

  const merged = trailers.map((t) => ({ ...t }));
  const mergedById = new Map(merged.map((t) => [t.id, t]));
  const unknownIds: string[] = [];
  const overrides: MergeManualPricesResult<T>['overrides'] = [];
  let applied = 0;

  for (const [id, entry] of Object.entries(data.prices ?? {})) {
    const trailer = mergedById.get(id);
    if (!trailer) {
      unknownIds.push(id);
      continue;
    }
    if (trailer.price > 0) {
      overrides.push({ id, parserPrice: trailer.price, manualPrice: entry.price });
    } else {
      applied++;
    }
    trailer.price = entry.price;
  }

  return { trailers: merged, applied, overrides, unknownIds };
}
