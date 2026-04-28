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

/** Build a human-readable spec string from trailer properties, e.g. "Kassbohrer 3-axle 79t 16.4m" */
export function formatTrailerSpec(t: Trailer): string {
  const idParts = t.id.split('.');
  const brandRaw = idParts[0];
  const brand = brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1);

  // Chain type label for non-single trailers.
  // ETS2 emits b_double / hct; ATS emits bdouble, rmdouble, tpdouble, triple, double.
  const CHAIN_LABELS: Record<string, string> = {
    hct: 'HCT',
    b_double: 'B-double',
    bdouble: 'B-double',
    rmdouble: 'RM-double',
    tpdouble: 'Turnpike-double',
    triple: 'Triple',
    double: 'Double',
  };
  const chainLabel = CHAIN_LABELS[t.chain_type] ?? '';

  // Extract axle count from ID
  let axleStr = '';
  const singleMatch = t.id.match(/single_(\d+)/);
  if (singleMatch) {
    const num = singleMatch[1];
    if (num === '41') axleStr = '4+1-axle';
    else axleStr = `${num.charAt(0)}-axle`;
    // Check for "+1" patterns like single_4_1 or single_3_1
    const plusMatch = t.id.match(/single_(\d)_1\b/);
    if (plusMatch) axleStr = `${plusMatch[1]}+1-axle`;
  } else if (t.id.includes('ch_')) {
    const chMatch = t.id.match(/ch_(\d+)/);
    if (chMatch) axleStr = `${chMatch[1]}-axle`;
  } else if (chainLabel) {
    // HCT: hct_3_2_3 -> 3+2+3, hct_3_2s_4 -> 3+2+4
    const hctMatch = t.id.match(/hct_(\d+)_(\d+)s?_(\d+)/);
    if (hctMatch) axleStr = `${hctMatch[1]}+${hctMatch[2]}+${hctMatch[3]}-axle`;
    // Double/b_double: double_3_2 -> 3+2, bdouble_2_2 -> 2+2
    const dblMatch = t.id.match(/(?:double|bdouble)_(\d+)_(\d+)/);
    if (!hctMatch && dblMatch) axleStr = `${dblMatch[1]}+${dblMatch[2]}-axle`;
  }

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

// ATS `triple` rides in the HCT bucket until the "configurations not tiers"
// rework replaces this 3-tier scheme; HCT and triple are distinct real
// configurations, but both live in the heaviest bucket for now.
export function tierFromChainType(chainType: string | undefined): string {
  switch (chainType) {
    case 'hct':
    case 'triple':
      return 'HCT';
    case 'double':
    case 'b_double':
    case 'bdouble':
    case 'tpdouble':
    case 'rmdouble':
      return 'Double';
    default:
      return 'Standard';
  }
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
