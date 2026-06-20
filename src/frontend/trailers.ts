/**
 * Trailers page module for ETS2 Trucker Advisor
 * Level 1: Body types with best trailer (single configuration)
 * Level 2: All chain configurations (Single/Double/B-double/HCT/Triple/…) for a body type
 * Level 3: All trailer variants within a configuration, best per region zone
 */

import { initPageData, initGameSelector } from './page-init';
import {
  normalize, cargoBonus, getOwnableTrailers,
  pickBestTrailer, trailerTotalHV, formatTrailerSpec,
  type AllData, type Lookups, type Cargo, type Trailer,
} from './data';
import { escapeHtml, chainConfigLabel, CHAIN_ORDER } from './utils';
import { COUNTRY_DISPLAY_NAMES } from './display-names';
import { getRegionTerms } from './game';

let data: AllData | null = null;
let lookups: Lookups | null = null;

interface BodyTypeSummary {
  bodyType: string;
  displayName: string;
  best: Trailer;          // best trailer of the headline (single) configuration
  bestSpec: string;
  bestHV: number;
  cargoCount: number;
  cargoIds: Set<string>;
  configs: ChainConfigSummary[];
  dominatedBy: string | null;  // body type that covers all our cargo + more
}

interface ChainConfigSummary {
  chainType: string;      // raw chain_type, e.g. 'single' | 'double' | 'b_double' | 'hct' | 'triple'
  label: string;          // configurator-style label, e.g. 'Single', 'B-double', 'HCT'
  best: Trailer;
  bestSpec: string;
  totalHV: number;
  variants: Trailer[];
  countries: string;
  axleRange: string;      // axle counts available in this config, e.g. '3' or '8–10'
}

let bodyTypes: BodyTypeSummary[] = [];

const content = document.getElementById('content') as HTMLElement;
const trailerDetail = document.getElementById('trailer-detail') as HTMLElement;
const detailContent = document.getElementById('detail-content') as HTMLElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const backLink = document.getElementById('back-link') as HTMLElement;

// URL hash chain-config vocabulary. 'standard' is a legacy alias from the
// retired 3-tier scheme (#250) — old links land on the single configuration.
const CHAIN_SUFFIXES = new Set(CHAIN_ORDER);
function resolveChainSuffix(suffix: string): string | null {
  if (suffix === 'standard') return 'single';
  return CHAIN_SUFFIXES.has(suffix) ? suffix : null;
}

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

function configCountries(trailers: Trailer[]): string {
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

/** Axle-count range across a configuration's variants, e.g. '3' or '8–10'. */
function axleRange(variants: Trailer[]): string {
  const axles = variants
    .map((v) => v.axles)
    .filter((a): a is number => typeof a === 'number');
  if (axles.length === 0) return '';
  const min = Math.min(...axles);
  const max = Math.max(...axles);
  return min === max ? `${min}` : `${min}–${max}`;
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

    // Group by chain configuration
    const configMap = new Map<string, Trailer[]>();
    for (const t of trailers) {
      const ct = t.chain_type || 'single';
      if (!configMap.has(ct)) configMap.set(ct, []);
      configMap.get(ct)!.push(t);
    }

    // Order configs lightest → heaviest; any chain_type not in CHAIN_ORDER trails alphabetically.
    const orderedChainTypes = [...configMap.keys()].sort((a, b) => {
      const ia = CHAIN_ORDER.indexOf(a);
      const ib = CHAIN_ORDER.indexOf(b);
      if (ia !== ib) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
      return a.localeCompare(b);
    });

    const configs: ChainConfigSummary[] = orderedChainTypes.map((ct) => {
      const variants = configMap.get(ct)!;
      const best = pickBestTrailer(variants, variants[0], lookups!);
      // Sort variants by axles, then volume (game-vocabulary ordering)
      variants.sort((a, b) =>
        (a.axles ?? 0) - (b.axles ?? 0)
        || a.volume - b.volume
      );
      return {
        chainType: ct,
        label: chainConfigLabel(ct),
        best,
        bestSpec: formatTrailerSpec(best),
        totalHV: trailerTotalHV(best, lookups!),
        variants,
        countries: configCountries(variants),
        axleRange: axleRange(variants),
      };
    });

    // Headline trailer: the single configuration (the baseline every region has),
    // or the lightest available configuration if a body type has no singles.
    const headline = configs.find((c) => c.chainType === 'single') ?? configs[0];

    result.push({
      bodyType: bt,
      displayName: bt.charAt(0).toUpperCase() + bt.slice(1).replace(/_/g, ' '),
      best: headline.best,
      bestSpec: headline.bestSpec,
      bestHV: headline.totalHV,
      cargoCount: cargoIds.size,
      cargoIds,
      configs,
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

  result.sort((a, b) => b.bestHV - a.bestHV);
  return result;
}

/* ── Level 1: Body type list ── */

function renderList(filter = ''): void {
  if (!data || !lookups) return;

  const filterNorm = normalize(filter);
  const filtered = bodyTypes.filter(
    (bt) => !bt.dominatedBy
      && (normalize(bt.displayName).includes(filterNorm)
        || normalize(bt.bestSpec).includes(filterNorm))
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
      <p class="table-hint">Best single-trailer per body type by total haul value. Click for configurations and variants.</p>
      <table>
        <thead>
          <tr>
            <th>Body Type</th>
            <th>Best Trailer</th>
            <th class="tooltip" data-tooltip="Sum of haul value across all compatible cargo">Total HV</th>
            <th class="tooltip" data-tooltip="Number of cargo types this body type can haul">Cargo</th>
            <th class="tooltip" data-tooltip="Chain configurations available for this body type">Configurations</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((bt) => {
            const configLabels = bt.configs.map((c) => c.label).join(', ');
            return `
              <tr class="clickable" data-body-type="${bt.bodyType}" tabindex="0">
                <td><strong>${bt.displayName}</strong></td>
                <td class="trailer-spec">${bt.bestSpec}</td>
                <td class="amount">${bt.bestHV.toFixed(0)}</td>
                <td class="amount">${bt.cargoCount}</td>
                <td>${configLabels}</td>
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

/* ── Level 2: Body type detail (all chain configurations) ── */

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
      <div class="subtitle">${bt.cargoCount} cargo types · Best: ${bt.bestSpec}</div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${bt.bestHV.toFixed(0)}</div>
        <div class="stat-label">Best HV</div>
      </div>
      <div class="stat">
        <div class="stat-value">${bt.cargoCount}</div>
        <div class="stat-label">Cargo Types</div>
      </div>
      <div class="stat">
        <div class="stat-value">${bt.configs.length}</div>
        <div class="stat-label">Configurations</div>
      </div>
    </div>

    <div class="table-section">
      <h2>Chain Configurations</h2>
      <p class="table-hint">Best trailer per configuration. Click to see all variants.</p>
      <table>
        <thead>
          <tr>
            <th>Configuration</th>
            <th>Best Trailer</th>
            <th class="tooltip" data-tooltip="Total axle count across all units (range over this configuration's variants)">Axles</th>
            <th class="tooltip" data-tooltip="Sum of haul value across all compatible cargo">Total HV</th>
            <th>Volume</th>
            <th>Length</th>
            <th>GWL</th>
            <th class="tooltip" data-tooltip="Number of ownable trailer models">Variants</th>
            <th>${getRegionTerms().plural}</th>
          </tr>
        </thead>
        <tbody>
          ${bt.configs.map((c) => `
            <tr class="clickable" data-chain-type="${c.chainType}" tabindex="0">
              <td><strong>${c.label}</strong></td>
              <td class="trailer-spec">${c.bestSpec}</td>
              <td class="amount">${c.axleRange}</td>
              <td class="amount">${c.totalHV.toFixed(0)}</td>
              <td class="amount">${c.best.volume}</td>
              <td class="amount">${c.best.length}</td>
              <td class="amount">${Math.round(c.best.gross_weight_limit / 1000)}t</td>
              <td class="amount">${c.variants.length}</td>
              <td>${c.countries}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="table-section">
      <h2>Compatible Cargo (${bt.cargoCount})</h2>
      <p class="table-hint">Units and values for best trailer: ${bt.bestSpec}.</p>
      ${renderCargoTable(bt.cargoIds, bt.best.id)}
    </div>
  `;

  detailContent.querySelectorAll('tr.clickable').forEach((row) => {
    const handler = () => showConfigVariants(bodyType, (row as HTMLElement).dataset.chainType!);
    row.addEventListener('click', handler);
    row.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        handler();
      }
    });
  });
}

/* ── Level 3: Configuration variants ── */

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
 * Pick the single best trailer per country zone within a configuration.
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

function showConfigVariants(bodyType: string, chainType: string): void {
  if (!lookups || !data) return;

  const bt = bodyTypes.find((b) => b.bodyType === bodyType);
  if (!bt) return;
  const config = bt.configs.find((c) => c.chainType === chainType);
  if (!config) {
    // Stale/legacy link to a configuration this body type doesn't have — show the body type.
    showBodyType(bodyType);
    return;
  }

  const zones = bestPerZone(config.variants);

  content.style.display = 'none';
  trailerDetail.style.display = 'block';
  window.location.hash = `body-${bodyType}-${chainType}`;

  detailContent.innerHTML = `
    <div class="detail-header">
      <h2>${bt.displayName} — ${config.label}</h2>
      <div class="subtitle">Best: ${config.bestSpec} · ${config.variants.length} total models</div>
    </div>

    <div class="table-section">
      <h2>Best ${config.label} Trailer by Region</h2>
      <p class="table-hint">Single best trailer per country zone. SCS (base game) fallback shown when best is DLC-only.</p>
      <table>
        <thead>
          <tr>
            <th>${getRegionTerms().plural}</th>
            <th>Best Trailer</th>
            <th class="tooltip" data-tooltip="Total axle count across all units">Axles</th>
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
              <td class="amount">${z.best.axles ?? ''}</td>
              <td class="amount">${z.totalHV.toFixed(0)}</td>
              <td class="amount">${z.best.volume}</td>
              <td class="amount">${z.best.length}</td>
              <td class="amount">${Math.round(z.best.gross_weight_limit / 1000)}t</td>
            </tr>
            ${(!z.bestIsSCS && z.scsFallback) ? `
            <tr class="scs-fallback-row">
              <td class="country"></td>
              <td class="trailer-spec">└ Base game: ${z.scsSpec}</td>
              <td class="amount">${z.scsFallback.axles ?? ''}</td>
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
      <p class="table-hint">Units and values for best ${config.label.toLowerCase()} trailer: ${config.bestSpec}.</p>
      ${renderCargoTable(bt.cargoIds, config.best.id)}
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
  // Check for a chain-config suffix: #body-curtainside-hct, #body-box-b_double, …
  // (legacy #body-curtainside-standard resolves to the single configuration).
  // Relies on the invariant that body_type ids contain no '-' (they use '_') and
  // chain_types contain no '-', so the segment after the last '-' is the chain
  // suffix. If a future game ships a hyphenated body_type, switch to URL-encoding.
  const lastDash = rest.lastIndexOf('-');
  if (lastDash > 0) {
    const chainType = resolveChainSuffix(rest.substring(lastDash + 1));
    if (chainType) {
      const bodyType = rest.substring(0, lastDash);
      showConfigVariants(bodyType, chainType);
      return;
    }
  }

  // No config suffix — show body type detail
  showBodyType(rest);
}

async function init(): Promise<void> {
  initGameSelector();
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
      // If on a configuration view, go back to body type; otherwise go to list
      const hash = window.location.hash;
      if (hash.startsWith('#body-')) {
        const rest = hash.replace('#body-', '');
        const lastDash = rest.lastIndexOf('-');
        if (lastDash > 0 && resolveChainSuffix(rest.substring(lastDash + 1))) {
          // On configuration view → go back to body type
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
