/**
 * Utility functions for ETS2 Trucker Advisor
 *
 * Shared helpers: text normalization, trailer spec formatting,
 * haul value computation, trailer selection.
 */

import type { Trailer, Lookups } from './types';

/**
 * Cargo value bonus multiplier: +30% for fragile, +30% for high_value (stackable).
 * Returns 1.0 (no bonus), 1.3 (one flag), or 1.6 (both flags).
 */
export function cargoBonus(cargo: { fragile: boolean; high_value: boolean }): number {
  return 1 + (cargo.fragile ? 0.3 : 0) + (cargo.high_value ? 0.3 : 0);
}

/**
 * Normalize text for accent-insensitive search
 * Removes diacritics and converts to lowercase
 */
export function normalize(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Configurator-style label per chain_type. Singles carry no chain word (their
// spec reads as just "{brand} {n}-axle"); for a config-level label that includes
// singles, use chainConfigLabel().
// ETS2 emits b_double / hct; ATS emits bdouble, rmdouble, tpdouble, triple, double.
export const CHAIN_LABELS: Record<string, string> = {
  hct: 'HCT',
  b_double: 'B-double',
  bdouble: 'B-double',
  rmdouble: 'RM-double',
  tpdouble: 'Turnpike-double',
  triple: 'Triple',
  double: 'Double',
};

// Chain configurations from lightest to heaviest. Drives ordering of the trailer
// browser's configuration rows and the URL hash vocabulary. Keep in sync with
// the chain_type values the parser emits (utils.test.ts asserts it covers
// CHAIN_LABELS plus 'single').
export const CHAIN_ORDER = ['single', 'double', 'b_double', 'bdouble', 'tpdouble', 'rmdouble', 'hct', 'triple'];

/** Configurator-style label for a chain configuration, including singles ("Single"). */
export function chainConfigLabel(chainType: string | undefined): string {
  if (!chainType || chainType === 'single') return 'Single';
  return CHAIN_LABELS[chainType] ?? chainType;
}

/** Build a human-readable spec string from trailer properties, e.g. "Kassbohrer Double 5-axle 79t 16.4m" */
export function formatTrailerSpec(t: Trailer): string {
  const idParts = t.id.split('.');
  const brandRaw = idParts[0];
  const brand = brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1);

  const chainLabel = CHAIN_LABELS[t.chain_type] ?? '';
  // Axle count is the authoritative `axles` field (total across all units of the
  // chain). Omitted only for observations-only trailers that lack the field.
  const axleStr = t.axles ? `${t.axles}-axle` : '';

  const isLong = t.id.includes('.long') || t.id.includes('_ln.');
  const lengthLabel = isLong ? 'long' : '';

  // Extract meaningful subtype from last ID segment (belly/straight, crane, etc.)
  let subtype = '';
  const lastSeg = idParts[idParts.length - 1];
  if (/belly/.test(lastSeg)) subtype = 'belly';
  else if (/\bstr\b/.test(lastSeg)) subtype = 'straight';
  else if (/brick_crane/.test(lastSeg)) subtype = 'crane';
  else if (/\blight\b/.test(lastSeg)) subtype = 'light';
  else if (/\bsolid\b/.test(lastSeg)) subtype = 'solid';
  else if (/_sh\b/.test(idParts[idParts.length - 2] ?? '')) subtype = 'short';

  const gwt = `${Math.round(t.gross_weight_limit / 1000)}t`;
  const len = `${t.length}m`;

  const parts = [brand, chainLabel, axleStr, lengthLabel, subtype, gwt, len].filter(Boolean);
  return parts.join(' ');
}

/**
 * Total haul value for a trailer: sum of (value * bonus * units) across all compatible cargo.
 * Uses cargo_trailer_units which accounts for both volume and weight limits.
 */
export function trailerTotalHV(t: Trailer, lookups: Lookups): number {
  const cargoes = lookups.trailerCargoMap.get(t.id);
  if (!cargoes) return 0;
  let total = 0;
  for (const cargoId of cargoes) {
    const cargo = lookups.cargoById.get(cargoId);
    if (!cargo || cargo.excluded) continue;
    const units = lookups.cargoTrailerUnits.get(`${cargoId}:${t.id}`) ?? 1;
    const bonus = cargoBonus(cargo);
    total += cargo.value * bonus * units;
  }
  return total;
}

/**
 * Pick the best trailer by total haul value across all compatible cargo.
 * Tie-break order: SCS (base game) preferred over DLC, then shorter length.
 */
export function pickBestTrailer(candidates: Trailer[], fallback: Trailer, lookups: Lookups): Trailer {
  if (candidates.length === 0) return fallback;

  let bestTrailer = candidates[0];
  let bestValue = trailerTotalHV(bestTrailer, lookups);
  let bestIsSCS = bestTrailer.id.startsWith('scs.');
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const v = trailerTotalHV(c, lookups);
    if (v > bestValue) {
      bestTrailer = c; bestValue = v; bestIsSCS = c.id.startsWith('scs.');
    } else if (v === bestValue) {
      const cIsSCS = c.id.startsWith('scs.');
      if (cIsSCS && !bestIsSCS) {
        bestTrailer = c; bestIsSCS = true;
      } else if (cIsSCS === bestIsSCS && c.length < bestTrailer.length) {
        bestTrailer = c;
      }
    }
  }
  return bestTrailer;
}

/** Convert game ID to display name: "apples_c" -> "Apples C" */
export function titleCase(gameId: string): string {
  return gameId
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Get ownable trailers only
export function getOwnableTrailers(data: { trailers: Trailer[] }): Trailer[] {
  return data.trailers.filter((t) => t.ownable);
}

/**
 * Escape HTML special characters to prevent XSS when interpolating into innerHTML.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
