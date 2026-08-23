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

// chain_type counts chassis units in the chain, which is a road train everywhere
// except ATS's scs.lowboy: its multi-chassis configurations are heavy-haul rigs —
// jeep dolly + lowboy (`double`) and jeep dolly + lowboy + spreader (`triple`),
// named tr_articulated_3axle … tr_articulated_9axle in the defs. Labelling those
// "Double"/"Triple" reads as an LCV, which is why they carry no country_validity
// while real doubles and triples do. See docs/ats-state-restrictions.md.
// ETS2 lowboys are all single, so this never fires outside ATS.
const ARTICULATED_LABELS: Record<string, string> = {
  double: 'Jeep dolly',
  triple: 'Jeep dolly + spreader',
};

function isArticulated(bodyType: string | undefined, chainType: string): boolean {
  return bodyType === 'lowboy' && chainType in ARTICULATED_LABELS;
}

/**
 * Configurator-style label for a chain configuration, including singles ("Single").
 * Pass `bodyType` so lowboy heavy-haul rigs aren't labelled as road trains.
 */
export function chainConfigLabel(chainType: string | undefined, bodyType?: string): string {
  if (!chainType || chainType === 'single') return 'Single';
  if (isArticulated(bodyType, chainType)) return ARTICULATED_LABELS[chainType];
  return CHAIN_LABELS[chainType] ?? chainType;
}

/**
 * Fold a configuration ladder into a region partition.
 *
 * A configuration's `country_validity` lists everywhere it is *legal*, which
 * overlaps heavily: an RM-double is legal in Nevada, but you would never run one
 * there because a turnpike double is legal too and hauls more. Walking the ladder
 * highest-HV first and letting each configuration claim only the regions nobody
 * above it already took turns "legal in" into "best in", and exposes the
 * configurations that are legal somewhere but optimal nowhere.
 *
 * `validity` maps chainType to the regions it is legal in; an empty array means
 * legal everywhere. Returns chainType to the regions where it wins, sorted.
 * Ties break toward the lighter configuration via CHAIN_ORDER — equal haul value
 * makes the cheaper rig the sensible pick.
 */
export function foldBestInRegions(
  configs: readonly { chainType: string; totalHV: number }[],
  validity: ReadonlyMap<string, readonly string[]>,
  allRegions: readonly string[],
): Map<string, string[]> {
  const claimed = new Set<string>();
  const out = new Map<string, string[]>();

  const ladder = [...configs].sort((a, b) =>
    b.totalHV - a.totalHV
    || CHAIN_ORDER.indexOf(a.chainType) - CHAIN_ORDER.indexOf(b.chainType)
  );

  for (const c of ladder) {
    const legal = validity.get(c.chainType) ?? [];
    const scope = legal.length === 0 ? allRegions : legal;
    const mine = scope.filter((r) => !claimed.has(r)).sort();
    for (const r of mine) claimed.add(r);
    out.set(c.chainType, mine);
  }

  return out;
}

/** Build a human-readable spec string from trailer properties, e.g. "Kassbohrer Double 5-axle 79t 16.4m" */
export function formatTrailerSpec(t: Trailer): string {
  const idParts = t.id.split('.');
  const brandRaw = idParts[0];
  const brand = brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1);

  const chainLabel = isArticulated(t.body_type, t.chain_type)
    ? 'Articulated'
    : CHAIN_LABELS[t.chain_type] ?? '';
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
