/**
 * Trailers page module for ETS2 Trucker Advisor
 * Level 1: Body types with best standard trailer
 * Level 2: All tiers (Standard/Double/HCT) for a body type
 * Level 3: All trailer variants within a tier, sorted by totalHV
 */

import { initPageData, initThemeToggle } from './page-init';
import {
  normalize, cargoBonus, getOwnableTrailers,
  pickBestTrailer, trailerTotalHV, formatTrailerSpec,
  type AllData, type Lookups, type Cargo, type Trailer,
} from './data';
import { escapeHtml } from './utils';
import { COUNTRY_DISPLAY_NAMES } from './display-names';

let data: AllData | null = null;
let lookups: Lookups | null = null;

interface BodyTypeSummary {
  bodyType: string;
  displayName: string;
  bestStandard: Trailer;
  bestStandardSpec: string;
  standardHV: number;
  cargoCount: number;
  cargoIds: Set<string>;
  tiers: TierSummary[];
  dominatedBy: string | null;  // body type that covers all our cargo + more
}

interface TierSummary {
  tier: string;
  best: Trailer;
  bestSpec: string;
  totalHV: number;
  variants: Trailer[];
  countries: string;
}

let bodyTypes: BodyTypeSummary[] = [];

const content = document.getElementById('content') as HTMLElement;
const trailerDetail = document.getElementById('trailer-detail') as HTMLElement;
const detailContent = document.getElementById('detail-content') as HTMLElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const backLink = document.getElementById('back-link') as HTMLElement;

interface CargoWithUnits extends Cargo {
  units: number;
  unitValue: number;
  haulValue: number;
}

function getCargo(cargoIds: Set<string>, trailerId: string): CargoWithUnits[] {
  if (!lookups) return [];
  return [...cargoIds]
    .map((cargoId) => {
      const cargo = lookups!.cargoById.get(cargoId);
      if (!cargo || cargo.excluded) return null;
      const units = lookups!.cargoTrailerUnits.get(`${cargoId}:${trailerId}`) ?? 1;
      const multiplier = cargoBonus(cargo);
      const unitValue = cargo.value * multiplier;
      return { ...cargo, units, unitValue, haulValue: unitValue * units };
    })
    .filter((c): c is CargoWithUnits => c !== null)
    .sort((a, b) => b.haulValue - a.haulValue);
}

function tierFromId(id: string): string {
  if (id.includes('hct')) return 'HCT';
  if (id.includes('double') || id.includes('bdouble')) return 'Double';
  return 'Standard';
}

function tierCountries(trailers: Trailer[]): string {
  const countrySet = new Set<string>();
  let allCountries = false;
  for (const t of trailers) {
    if (!t.country_validity || t.country_validity.length === 0) {
      allCountries = true;
    } else {
      for (const c of t.country_validity) countrySet.add(c);
    }
  }
  return allCountries ? 'All' : [...countrySet].sort().map(c => COUNTRY_DISPLAY_NAMES[c] ?? c).join(', ');
}

function buildBodyTypes(): BodyTypeSummary[] {
  if (!data || !lookups) return [];
  const ownable = getOwnableTrailers(data);

  // Group by body type
  const byBT = new Map<string, Trailer[]>();
  for (const t of ownable) {
    if (!byBT.has(t.body_type)) byBT.set(t.body_type, []);
    byBT.get(t.body_type)!.push(t);
  }

  const result: BodyTypeSummary[] = [];

  for (const [bt, trailers] of byBT) {
    // Cargo set for this body type (union across all trailers)
    const cargoIds = new Set<string>();
    for (const t of trailers) {
      const cargoes = lookups!.trailerCargoMap.get(t.id);
      if (cargoes) for (const c of cargoes) cargoIds.add(c);
    }
    if (cargoIds.size === 0) continue;

    // Group by tier
    const tierMap = new Map<string, Trailer[]>();
    for (const t of trailers) {
      const tier = tierFromId(t.id);
      if (!tierMap.has(tier)) tierMap.set(tier, []);
      tierMap.get(tier)!.push(t);
    }

    const tierOrder = ['Standard', 'Double', 'HCT'];
    const tiers: TierSummary[] = tierOrder
      .filter((tier) => tierMap.has(tier))
      .map((tier) => {
        const variants = tierMap.get(tier)!;
        const best = pickBestTrailer(variants, variants[0], lookups!);
        // Sort all variants by totalHV desc for the variant list
        variants.sort((a, b) => trailerTotalHV(b, lookups!) - trailerTotalHV(a, lookups!));
        return {
          tier,
          best,
          bestSpec: formatTrailerSpec(best),
          totalHV: trailerTotalHV(best, lookups!),
          variants,
          countries: tierCountries(variants),
        };
      });

    // Best standard trailer (or best overall if no standard tier)
    const stdTier = tiers.find((t) => t.tier === 'Standard') ?? tiers[0];

    result.push({
      bodyType: bt,
      displayName: bt.charAt(0).toUpperCase() + bt.slice(1).replace(/_/g, ' '),
      bestStandard: stdTier.best,
      bestStandardSpec: stdTier.bestSpec,
      standardHV: stdTier.totalHV,
      cargoCount: cargoIds.size,
      cargoIds,
      tiers,
      dominatedBy: null,
    });
  }

  // Detect dominated body types: A dominated if A's cargo ⊂ B's cargo (strict subset)
  for (const a of result) {
    let bestDominator: BodyTypeSummary | null = null;
    for (const b of result) {
      if (a === b || b.cargoCount <= a.cargoCount) continue;
      let isSubset = true;
      for (const c of a.cargoIds) {
        if (!b.cargoIds.has(c)) { isSubset = false; break; }
      }
      if (isSubset && (!bestDominator || b.cargoCount < bestDominator.cargoCount)) {
        bestDominator = b;
      }
    }
    if (bestDominator) a.dominatedBy = bestDominator.displayName;
  }

  result.sort((a, b) => b.standardHV - a.standardHV);
  return result;
}

/* ── Level 1: Body type list ── */

function renderList(filter = ''): void {
  if (!data || !lookups) return;

  const filterNorm = normalize(filter);
  const filtered = bodyTypes.filter(
    (bt) => !bt.dominatedBy
      && (normalize(bt.displayName).includes(filterNorm)
        || normalize(bt.bestStandardSpec).includes(filterNorm))
  );

  const totalCargo = data.cargo.filter((c) => !c.excluded).length;

  if (filtered.length === 0) {
    const escaped = escapeHtml(filter);
    content.innerHTML = filter
      ? `<div class="empty-state">No body types found matching "${escaped}".</div>`
      : '<div class="empty-state">No trailer data found.</div>';
    return;
  }

  content.innerHTML = `
    <div class="table-section">
      <h2>Body Types (${filtered.length} types, ${totalCargo} cargo in game)</h2>
      <p class="table-hint">Best standard trailer per body type by total haul value. Click for tiers and variants.</p>
      <table>
        <thead>
          <tr>
            <th>Body Type</th>
            <th>Best Standard Trailer</th>
            <th class="tooltip" data-tooltip="Sum of haul value across all compatible cargo">Total HV</th>
            <th class="tooltip" data-tooltip="Number of cargo types this body type can haul">Cargo</th>
            <th class="tooltip" data-tooltip="Available tiers: Standard, Double, HCT">Tiers</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((bt) => {
            const tierLabels = bt.tiers.map((t) => t.tier).join(', ');
            return `
              <tr class="clickable" data-body-type="${bt.bodyType}" tabindex="0">
                <td><strong>${bt.displayName}</strong></td>
                <td class="trailer-spec">${bt.bestStandardSpec}</td>
                <td class="amount">${bt.standardHV.toFixed(0)}</td>
                <td class="amount">${bt.cargoCount}</td>
                <td>${tierLabels}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  content.querySelectorAll('tr.clickable').forEach((row) => {
    const handler = () => showBodyType((row as HTMLElement).dataset.bodyType!);
    row.addEventListener('click', handler);
    row.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        handler();
      }
    });
  });
}

/* ── Level 2: Body type detail (all tiers) ── */

function showBodyType(bodyType: string): void {
  if (!lookups || !data) return;

  const bt = bodyTypes.find((b) => b.bodyType === bodyType);
  if (!bt) return;

  content.style.display = 'none';
  trailerDetail.style.display = 'block';
  window.location.hash = `body-${bodyType}`;

  detailContent.innerHTML = `
    <div class="detail-header">
      <h2>${bt.displayName}</h2>
      <div class="subtitle">${bt.cargoCount} cargo types · Best standard: ${bt.bestStandardSpec}</div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${bt.standardHV.toFixed(0)}</div>
        <div class="stat-label">Standard HV</div>
      </div>
      <div class="stat">
        <div class="stat-value">${bt.cargoCount}</div>
        <div class="stat-label">Cargo Types</div>
      </div>
      <div class="stat">
        <div class="stat-value">${bt.tiers.length}</div>
        <div class="stat-label">Tiers</div>
      </div>
    </div>

    <div class="table-section">
      <h2>Available Tiers</h2>
      <p class="table-hint">Best trailer per tier. Click to see all variants.</p>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Best Trailer</th>
            <th class="tooltip" data-tooltip="Sum of haul value across all compatible cargo">Total HV</th>
            <th>Volume</th>
            <th>Length</th>
            <th>GWL</th>
            <th class="tooltip" data-tooltip="Number of ownable trailer models">Variants</th>
            <th>Countries</th>
          </tr>
        </thead>
        <tbody>
          ${bt.tiers.map((t) => `
            <tr class="clickable" data-tier="${t.tier}" tabindex="0">
              <td><strong>${t.tier}</strong></td>
              <td class="trailer-spec">${t.bestSpec}</td>
              <td class="amount">${t.totalHV.toFixed(0)}</td>
              <td class="amount">${t.best.volume}</td>
              <td class="amount">${t.best.length}</td>
              <td class="amount">${Math.round(t.best.gross_weight_limit / 1000)}t</td>
              <td class="amount">${t.variants.length}</td>
              <td>${t.countries}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="table-section">
      <h2>Compatible Cargo (${bt.cargoCount})</h2>
      <p class="table-hint">Units and values for best standard trailer: ${bt.bestStandardSpec}.</p>
      ${renderCargoTable(bt.cargoIds, bt.bestStandard.id)}
    </div>
  `;

  detailContent.querySelectorAll('tr.clickable').forEach((row) => {
    const handler = () => showTierVariants(bodyType, (row as HTMLElement).dataset.tier!);
    row.addEventListener('click', handler);
    row.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        handler();
      }
    });
  });
}

/* ── Level 3: Tier variants ── */

interface ZoneRecommendation {
  zone: string;           // 'All' or comma-separated country list
  best: Trailer;
  bestSpec: string;
  totalHV: number;
  bestIsSCS: boolean;
  scsFallback: Trailer | null;   // best SCS trailer if top pick is DLC
  scsSpec: string;
  scsHV: number;
}

/**
 * Pick the single best trailer per country zone within a tier.
 * Within equal totalHV, prefer SCS (base game) over DLC brands.
 * Within equal totalHV+brand, prefer shorter length.
 */
function bestPerZone(variants: Trailer[]): ZoneRecommendation[] {
  // Group by country zone
  const zones = new Map<string, Trailer[]>();
  for (const t of variants) {
    const zone = (!t.country_validity || t.country_validity.length === 0)
      ? 'All' : [...t.country_validity].sort().map(c => COUNTRY_DISPLAY_NAMES[c] ?? c).join(', ');
    if (!zones.has(zone)) zones.set(zone, []);
    zones.get(zone)!.push(t);
  }

  const result: ZoneRecommendation[] = [];
  for (const [zone, trailers] of zones) {
    // Score each trailer: totalHV primary, then SCS preferred, then shorter
    const scored = trailers.map((t) => ({
      trailer: t,
      hv: trailerTotalHV(t, lookups!),
      isSCS: t.id.startsWith('scs.'),
    }));

    scored.sort((a, b) =>
      b.hv - a.hv
      || (b.isSCS ? 1 : 0) - (a.isSCS ? 1 : 0)
      || a.trailer.length - b.trailer.length
    );

    const best = scored[0];
    const bestIsSCS = best.isSCS;

    // Find best SCS fallback if top pick is DLC
    let scsFallback: Trailer | null = null;
    let scsSpec = '';
    let scsHV = 0;
    if (!bestIsSCS) {
      const bestSCS = scored.find((s) => s.isSCS);
      if (bestSCS) {
        scsFallback = bestSCS.trailer;
        scsSpec = formatTrailerSpec(bestSCS.trailer);
        scsHV = bestSCS.hv;
      }
    }

    result.push({
      zone,
      best: best.trailer,
      bestSpec: formatTrailerSpec(best.trailer),
      totalHV: best.hv,
      bestIsSCS,
      scsFallback,
      scsSpec,
      scsHV,
    });
  }

  // Only show restricted zones that beat the universal "All" zone.
  const allZone = result.find((z) => z.zone === 'All');
  const allHV = allZone?.totalHV ?? 0;
  const filtered = result.filter((z) => z.zone === 'All' || z.totalHV > allHV);

  // For restricted zones with no SCS fallback, inherit from "All" zone
  if (allZone) {
    for (const z of filtered) {
      if (z.zone !== 'All' && !z.bestIsSCS && !z.scsFallback && allZone.scsFallback) {
        z.scsFallback = allZone.scsFallback;
        z.scsSpec = allZone.scsSpec;
        z.scsHV = allZone.scsHV;
      }
    }
  }

  // Sort: restricted zones first (higher HV), then All
  filtered.sort((a, b) => {
    if (a.zone === 'All' && b.zone !== 'All') return 1;
    if (a.zone !== 'All' && b.zone === 'All') return -1;
    return b.totalHV - a.totalHV;
  });

  return filtered;
}

function showTierVariants(bodyType: string, tier: string): void {
  if (!lookups || !data) return;

  const bt = bodyTypes.find((b) => b.bodyType === bodyType);
  if (!bt) return;
  const tierData = bt.tiers.find((t) => t.tier === tier);
  if (!tierData) return;

  const zones = bestPerZone(tierData.variants);

  content.style.display = 'none';
  trailerDetail.style.display = 'block';
  window.location.hash = `body-${bodyType}-${tier.toLowerCase()}`;

  detailContent.innerHTML = `
    <div class="detail-header">
      <h2>${bt.displayName} — ${tier}</h2>
      <div class="subtitle">Best: ${tierData.bestSpec} · ${tierData.variants.length} total models</div>
    </div>

    <div class="table-section">
      <h2>Best ${tier} Trailer by Region</h2>
      <p class="table-hint">Single best trailer per country zone. SCS (base game) fallback shown when best is DLC-only.</p>
      <table>
        <thead>
          <tr>
            <th>Countries</th>
            <th>Best Trailer</th>
            <th class="tooltip" data-tooltip="Sum of haul value across all compatible cargo">Total HV</th>
            <th>Volume</th>
            <th>Length</th>
            <th>GWL</th>
          </tr>
        </thead>
        <tbody>
          ${zones.map((z) => `
            <tr>
              <td class="country">${z.zone}</td>
              <td class="trailer-spec">${z.bestSpec}${z.bestIsSCS ? '' : ' <span class="tag">DLC</span>'}</td>
              <td class="amount">${z.totalHV.toFixed(0)}</td>
              <td class="amount">${z.best.volume}</td>
              <td class="amount">${z.best.length}</td>
              <td class="amount">${Math.round(z.best.gross_weight_limit / 1000)}t</td>
            </tr>
            ${(!z.bestIsSCS && z.scsFallback) ? `
            <tr class="scs-fallback-row">
              <td class="country"></td>
              <td class="trailer-spec">\u2514 Base game: ${z.scsSpec}</td>
              <td class="amount">${z.scsHV.toFixed(0)}</td>
              <td class="amount">${z.scsFallback.volume}</td>
              <td class="amount">${z.scsFallback.length}</td>
              <td class="amount">${Math.round(z.scsFallback.gross_weight_limit / 1000)}t</td>
            </tr>
            ` : ''}
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="table-section">
      <h2>Compatible Cargo (${bt.cargoCount})</h2>
      <p class="table-hint">Units and values for best ${tier.toLowerCase()} trailer: ${tierData.bestSpec}.</p>
      ${renderCargoTable(bt.cargoIds, tierData.best.id)}
    </div>
  `;
}

/* ── Shared cargo table renderer ── */

function renderCargoTable(cargoIds: Set<string>, trailerId: string): string {
  const cargoList = getCargo(cargoIds, trailerId);
  if (cargoList.length === 0) return '<div class="empty-state">No cargo data.</div>';

  return `
    <table>
      <thead>
        <tr>
          <th>Cargo</th>
          <th class="tooltip" data-tooltip="Value per unit per km (with fragile/high-value bonuses)">Value/Unit</th>
          <th class="tooltip" data-tooltip="Units fitting in this trailer">Units</th>
          <th class="tooltip" data-tooltip="Value/Unit × Units = max haul value per km">Haul Value</th>
          <th>Properties</th>
        </tr>
      </thead>
      <tbody>
        ${cargoList.map((c) => `
          <tr>
            <td><a href="cargo.html#cargo-${c.id}" class="link">${c.name || c.id}</a></td>
            <td class="value">${c.unitValue.toFixed(2)}</td>
            <td class="amount">${c.units}</td>
            <td class="value">${c.haulValue.toFixed(2)}</td>
            <td>
              ${c.high_value ? '<span class="tag highlight">High Value</span>' : ''}
              ${c.fragile ? '<span class="tag">Fragile</span>' : ''}
              ${c.adr_class ? `<span class="tag">ADR ${c.adr_class}</span>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

/* ── Navigation ── */

function showList(): void {
  trailerDetail.style.display = 'none';
  content.style.display = 'block';
  window.location.hash = '';
  renderList(searchInput.value);
}

function handleHashChange(): void {
  const hash = window.location.hash;
  if (!hash.startsWith('#body-')) {
    showList();
    return;
  }

  const rest = hash.replace('#body-', '');
  // Check for tier suffix: #body-curtainside-hct, #body-curtainside-double, #body-curtainside-standard
  const tierSuffixes: Record<string, string> = { standard: 'Standard', double: 'Double', hct: 'HCT' };
  const lastDash = rest.lastIndexOf('-');
  if (lastDash > 0) {
    const maybeTier = rest.substring(lastDash + 1);
    if (tierSuffixes[maybeTier]) {
      const bodyType = rest.substring(0, lastDash);
      showTierVariants(bodyType, tierSuffixes[maybeTier]);
      return;
    }
  }

  // No tier suffix — show body type detail
  showBodyType(rest);
}

async function init(): Promise<void> {
  initThemeToggle();
  content.innerHTML = '<div class="loading">Loading trailers...</div>';

  try {
    const page = await initPageData();
    data = page.data;
    lookups = page.lookups;
    bodyTypes = buildBodyTypes();

    renderList();

    searchInput.addEventListener('input', () => {
      renderList(searchInput.value);
    });

    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      // If on variant view, go back to body type; otherwise go to list
      const hash = window.location.hash;
      if (hash.startsWith('#body-')) {
        const rest = hash.replace('#body-', '');
        const lastDash = rest.lastIndexOf('-');
        const tierSuffixes = ['standard', 'double', 'hct'];
        if (lastDash > 0 && tierSuffixes.includes(rest.substring(lastDash + 1))) {
          // On tier variant view → go back to body type
          const bodyType = rest.substring(0, lastDash);
          window.location.hash = `body-${bodyType}`;
          return;
        }
      }
      showList();
    });

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
  } catch (err) {
    console.error('Failed to initialize:', err);
    const message = err instanceof Error ? err.message : 'Unknown error occurred';
    content.innerHTML = `
      <div class="empty-state" role="alert">
        <p>Failed to load data</p>
        <p class="error-detail">${escapeHtml(message)}</p>
      </div>
    `;
  }
}

init();
