/**
 * Body type profiling for ETS2 Trucker Advisor
 *
 * Builds body type profiles from trailer data, detects chassis-based
 * merges, and identifies dominated body types.
 */

import type { AllData, Lookups, BodyTypeProfile } from './types';
import { getOwnableTrailers, formatTrailerSpec, trailerTotalHV, pickBestTrailer } from './utils';

/**
 * Compute chassis-based body type merge map from trailer data.
 * Body types sharing a physical chassis (same trailer ID prefix) merge together.
 * NO transitive merges -- only body types on the exact same chassis model merge.
 * When a body type appears on multiple chassis families, it joins the largest group.
 * Returns a map of absorbed_body_type -> survivor_body_type.
 */
export function getChassisMergeMap(data: AllData, lookups?: Lookups): Map<string, string> {
  const ownable = getOwnableTrailers(data);

  // Group body types by chassis model (trailer ID minus last segment)
  // e.g. scs.flatbed.single_3 -> {flatbed, container, flatbed_brck}
  const chassisBodyTypes = new Map<string, Set<string>>();
  for (const t of ownable) {
    const parts = t.id.split('.');
    if (parts.length < 2) continue;
    const chassis = parts.slice(0, -1).join('.');
    if (!chassisBodyTypes.has(chassis)) chassisBodyTypes.set(chassis, new Set());
    chassisBodyTypes.get(chassis)!.add(t.body_type);
  }

  // Group chassis models by their brand.model prefix (e.g. scs.flatbed, kassbohrer.sll)
  // Each brand.model family defines a set of interchangeable body types
  const familyBodyTypes = new Map<string, Set<string>>();
  for (const [chassis, bodyTypes] of chassisBodyTypes) {
    if (bodyTypes.size <= 1) continue;
    const parts = chassis.split('.');
    const family = parts.slice(0, 2).join('.');
    if (!familyBodyTypes.has(family)) familyBodyTypes.set(family, new Set());
    for (const bt of bodyTypes) familyBodyTypes.get(family)!.add(bt);
  }

  // Count distinct cargo per body type for survivor selection
  const cargoCounts = new Map<string, number>();
  for (const t of ownable) {
    if (cargoCounts.has(t.body_type)) continue;
    const cargoSet = new Set<string>();
    if (lookups) {
      for (const t2 of ownable) {
        if (t2.body_type !== t.body_type) continue;
        const cargo = lookups.trailerCargoMap.get(t2.id);
        if (cargo) for (const c of cargo) cargoSet.add(c);
      }
    }
    cargoCounts.set(t.body_type, cargoSet.size);
  }

  // When a body type appears in multiple families, assign it to the largest family
  // (most body types). This prevents bridging unrelated families.
  const btBestFamily = new Map<string, string>();
  for (const [family, bodyTypes] of familyBodyTypes) {
    for (const bt of bodyTypes) {
      const current = btBestFamily.get(bt);
      if (!current || bodyTypes.size > (familyBodyTypes.get(current)?.size ?? 0)) {
        btBestFamily.set(bt, family);
      }
    }
  }

  // Rebuild family groups with exclusive assignment
  const exclusiveFamilies = new Map<string, Set<string>>();
  for (const [bt, family] of btBestFamily) {
    if (!exclusiveFamilies.has(family)) exclusiveFamilies.set(family, new Set());
    exclusiveFamilies.get(family)!.add(bt);
  }

  // For each family, pick survivor and merge others into it.
  // Prefer the body type matching the chassis family name (e.g. scs.flatbed -> flatbed),
  // then fall back to most cargo.
  const mergeMap = new Map<string, string>();
  for (const [family, bodyTypes] of exclusiveFamilies) {
    if (bodyTypes.size <= 1) continue;
    const familyBaseName = family.split('.')[1] || '';
    const members = [...bodyTypes].sort((a, b) => {
      // Body type matching chassis family name wins
      if (a === familyBaseName && b !== familyBaseName) return -1;
      if (b === familyBaseName && a !== familyBaseName) return 1;
      return (cargoCounts.get(b) || 0) - (cargoCounts.get(a) || 0);
    });
    const survivor = members[0];
    for (let i = 1; i < members.length; i++) {
      mergeMap.set(members[i], survivor);
    }
  }

  return mergeMap;
}

export function getBodyTypeProfiles(data: AllData, lookups: Lookups): BodyTypeProfile[] {
  const ownable = getOwnableTrailers(data);

  // Group ownable trailers by body type
  const byBodyType = new Map<string, import('./types').Trailer[]>();
  for (const t of ownable) {
    const list = byBodyType.get(t.body_type) ?? [];
    list.push(t);
    byBodyType.set(t.body_type, list);
  }

  const profiles: BodyTypeProfile[] = [];

  for (const [bt, trailers] of byBodyType) {
    // Collect all cargo IDs this body type can haul
    const cargoIds = new Set<string>();
    for (const t of trailers) {
      const cargoes = lookups.trailerCargoMap.get(t.id);
      if (cargoes) {
        for (const c of cargoes) cargoIds.add(c);
      }
    }
    if (cargoIds.size === 0) continue;

    // Pick absolute best trailer across all chain types by totalHV
    const best = pickBestTrailer(trailers, trailers[0], lookups);
    const bestHV = trailerTotalHV(best, lookups);

    // Check doubles/b-doubles/HCT availability from country_validity
    const doublesSet = new Set<string>();
    const bdoublesSet = new Set<string>();
    const hctSet = new Set<string>();
    for (const t of trailers) {
      if (!t.country_validity) continue;
      if (t.id.includes('hct')) {
        for (const c of t.country_validity) hctSet.add(c);
      } else if (t.id.includes('bdouble')) {
        for (const c of t.country_validity) { bdoublesSet.add(c); doublesSet.add(c); }
      } else if (t.id.includes('double')) {
        for (const c of t.country_validity) { doublesSet.add(c); }
      }
    }

    const displayName = bt.charAt(0).toUpperCase() + bt.slice(1).replace(/_/g, ' ');

    profiles.push({
      bodyType: bt,
      displayName,
      cargoIds,
      cargoCount: cargoIds.size,
      bestTrailerId: best.id,
      bestTrailerName: formatTrailerSpec(best),
      bestTotalHV: bestHV,
      bestChainType: best.chain_type || 'single',
      bestCountries: best.country_validity ?? [],
      hasDoubles: doublesSet.size > 0,
      hasBDoubles: bdoublesSet.size > 0,
      hasHCT: hctSet.size > 0,
      doublesCountries: [...doublesSet].sort(),
      bdoublesCountries: [...bdoublesSet].sort(),
      hctCountries: [...hctSet].sort(),
      dominatedBy: null,
    });
  }

  // Merge body types that share a physical chassis family.
  // Uses getChassisMergeMap for consistent merge logic across the codebase.
  const chassisMerges = getChassisMergeMap(data, lookups);

  // Group by survivor
  const mergeGroups = new Map<string, string[]>();
  for (const [absorbed, survivor] of chassisMerges) {
    if (!mergeGroups.has(survivor)) mergeGroups.set(survivor, []);
    mergeGroups.get(survivor)!.push(absorbed);
  }

  for (const [survivorBT, absorbedBTs] of mergeGroups) {
    const survivorIdx = profiles.findIndex((p) => p.bodyType === survivorBT);
    if (survivorIdx < 0) continue;
    const survivor = profiles[survivorIdx];

    const toRemoveIndices: number[] = [];
    for (const absorbedBT of absorbedBTs) {
      const absIdx = profiles.findIndex((p) => p.bodyType === absorbedBT);
      if (absIdx < 0) continue;
      const src = profiles[absIdx];

      for (const c of src.cargoIds) survivor.cargoIds.add(c);
      if (src.hasDoubles) {
        survivor.hasDoubles = true;
        for (const c of src.doublesCountries) {
          if (!survivor.doublesCountries.includes(c)) survivor.doublesCountries.push(c);
        }
      }
      if (src.hasBDoubles) {
        survivor.hasBDoubles = true;
        for (const c of src.bdoublesCountries) {
          if (!survivor.bdoublesCountries.includes(c)) survivor.bdoublesCountries.push(c);
        }
      }
      if (src.hasHCT) {
        survivor.hasHCT = true;
        for (const c of src.hctCountries) {
          if (!survivor.hctCountries.includes(c)) survivor.hctCountries.push(c);
        }
      }
      toRemoveIndices.push(absIdx);
    }

    survivor.cargoCount = survivor.cargoIds.size;
    survivor.doublesCountries.sort();
    survivor.bdoublesCountries.sort();
    survivor.hctCountries.sort();
    survivor.displayName = survivor.displayName
      + ' (+' + absorbedBTs.map((bt) => bt.replace(/_/g, ' ')).join(', ') + ')';

    // Remove absorbed profiles (reverse order to preserve indices)
    toRemoveIndices.sort((a, b) => b - a);
    for (const idx of toRemoveIndices) profiles.splice(idx, 1);
  }

  // Detect dominated body types: A is dominated if A's cargo is a strict subset of B's cargo.
  // Pick smallest dominator (most specific superset) for the label.
  for (const a of profiles) {
    let bestDominator: BodyTypeProfile | null = null;
    for (const b of profiles) {
      if (a === b) continue;
      if (b.cargoCount <= a.cargoCount) continue;
      let isSubset = true;
      for (const c of a.cargoIds) {
        if (!b.cargoIds.has(c)) { isSubset = false; break; }
      }
      if (isSubset && (!bestDominator || b.cargoCount < bestDominator.cargoCount)) {
        bestDominator = b;
      }
    }
    if (bestDominator) {
      a.dominatedBy = bestDominator.bodyType;
    }
  }

  // Sort by totalHV descending (earning potential)
  profiles.sort((a, b) => b.bestTotalHV - a.bestTotalHV);
  return profiles;
}
