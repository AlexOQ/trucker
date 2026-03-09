/**
 * Trailers page module for ETS2 Trucker Advisor
 * Shows body type profiles — the minimal trailer set covering all cargo
 */

import {
  loadAllData, buildLookups, normalize, getBodyTypeProfiles, getChassisMergeMap, pickBestTrailer,
  type AllData, type Lookups, type Cargo, type BodyTypeProfile,
} from './data';

let data: AllData | null = null;
let lookups: Lookups | null = null;
let profiles: BodyTypeProfile[] = [];

const content = document.getElementById('content') as HTMLElement;
const trailerDetail = document.getElementById('trailer-detail') as HTMLElement;
const detailContent = document.getElementById('detail-content') as HTMLElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const backLink = document.getElementById('back-link') as HTMLElement;

interface CargoWithUnits extends Cargo {
  units: number;
  unitValue: number;      // value per unit with bonuses applied
  haulValue: number;      // unitValue × units = max haul value
}

function getProfileCargo(profile: BodyTypeProfile): CargoWithUnits[] {
  if (!lookups) return [];

  return [...profile.cargoIds]
    .map((cargoId) => {
      const cargo = lookups!.cargoById.get(cargoId);
      if (!cargo || cargo.excluded) return null;
      const units = lookups!.cargoTrailerUnits.get(`${cargoId}:${profile.bestTrailerId}`) ?? 1;
      const multiplier = 1 + (cargo.fragile ? 0.3 : 0) + (cargo.high_value ? 0.3 : 0);
      const unitValue = cargo.value * multiplier;
      return {
        ...cargo,
        units,
        unitValue,
        haulValue: unitValue * units,
      };
    })
    .filter((c): c is CargoWithUnits => c !== null)
    .sort((a, b) => b.haulValue - a.haulValue);
}

function renderProfileList(filter = ''): void {
  if (!data || !lookups) return;

  const filterNorm = normalize(filter);
  const filtered = profiles.filter(
    (p) => normalize(p.displayName).includes(filterNorm)
      || normalize(p.bestTrailerName).includes(filterNorm)
  );

  const totalCargo = data.cargo.filter((c) => !c.excluded).length;

  if (filtered.length === 0) {
    const escaped = filter.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    content.innerHTML = filter
      ? `<div class="empty-state">No body types found matching "${escaped}".</div>`
      : '<div class="empty-state">No trailer data found.</div>';
    return;
  }

  content.innerHTML = `
    <div class="table-section">
      <h2>Body Types (${filtered.length} types cover all ${totalCargo} cargo)</h2>
      <table>
        <thead>
          <tr>
            <th>Body Type</th>
            <th>Best Trailer</th>
            <th class="tooltip" data-tooltip="Number of cargo types this body type can haul">Cargo</th>
            <th class="tooltip" data-tooltip="Double/B-Double trailer variants available">Doubles</th>
            <th class="tooltip" data-tooltip="HCT (High Capacity Transport) variants available">HCT</th>
          </tr>
        </thead>
        <tbody>
          ${filtered
            .map(
              (p) => {
                const doublesCountries = new Set([...p.doublesCountries, ...p.bdoublesCountries]);
                const hasAnyDoubles = p.hasDoubles || p.hasBDoubles;
                return `
              <tr class="clickable${p.dominatedBy ? ' dominated-row' : ''}" data-body-type="${p.bodyType}" tabindex="0">
                <td><strong>${p.displayName}</strong>${p.dominatedBy ? `<span class="dominated-label"> (use ${p.dominatedBy.replace(/_/g, ' ')})</span>` : ''}</td>
                <td>${p.bestTrailerName}</td>
                <td class="amount">${p.cargoCount}</td>
                <td class="amount">${hasAnyDoubles ? `<span class="coverage">${doublesCountries.size} countries</span>` : '—'}</td>
                <td class="amount">${p.hasHCT ? `<span class="coverage">${p.hctCountries.length} countries</span>` : '—'}</td>
              </tr>
            `;
              }
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  content.querySelectorAll('tr.clickable').forEach((row) => {
    row.addEventListener('click', () => {
      showProfileDetail((row as HTMLElement).dataset.bodyType!);
    });
    row.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        showProfileDetail((row as HTMLElement).dataset.bodyType!);
      }
    });
  });
}

function showProfileDetail(bodyType: string): void {
  if (!lookups || !data) return;

  const profile = profiles.find((p) => p.bodyType === bodyType);
  if (!profile) return;

  const cargoList = getProfileCargo(profile);

  // Collapse ownable trailer variants into tiers (Standard/Double/HCT)
  // All variants within a tier haul the same cargo — show best (max volume) variant
  interface TierSummary {
    tier: string;
    count: number;
    bestName: string;
    bestId: string;
    volume: number;
    length: number;
    gwl: number;
    countries: string;
  }

  // Include all merged body types (e.g. flatbed + container + flatbed_brck)
  const mergedBodyTypes = new Set([bodyType]);
  const mergeMap = getChassisMergeMap(data!, lookups!);
  for (const [absorbed, survivor] of mergeMap) {
    if (survivor === bodyType) mergedBodyTypes.add(absorbed);
  }

  const tierMap = new Map<string, typeof data.trailers>();
  for (const t of data.trailers) {
    if (!t.ownable || !mergedBodyTypes.has(t.body_type)) continue;
    const tier = t.id.includes('hct') ? 'HCT'
      : (t.id.includes('double') || t.id.includes('bdouble')) ? 'Double'
      : 'Standard';
    if (!tierMap.has(tier)) tierMap.set(tier, []);
    tierMap.get(tier)!.push(t);
  }

  const tierOrder = ['Standard', 'Double', 'HCT'];
  const tiers: TierSummary[] = tierOrder
    .filter((tier) => tierMap.has(tier))
    .map((tier) => {
      const variants = tierMap.get(tier)!;
      // Best = SCS preferred, then max GWL, then max volume (same logic as profile best)
      const best = pickBestTrailer(variants, variants[0], lookups!);
      // Merge country restrictions across all variants in tier
      const countrySet = new Set<string>();
      let allCountries = false;
      for (const v of variants) {
        if (!v.country_validity || v.country_validity.length === 0) {
          allCountries = true;
        } else {
          for (const c of v.country_validity) countrySet.add(c);
        }
      }
      return {
        tier,
        count: variants.length,
        bestName: best.name,
        bestId: best.id,
        volume: best.volume,
        length: best.length,
        gwl: best.gross_weight_limit,
        countries: allCountries ? 'All' : [...countrySet].sort().join(', '),
      };
    });

  content.style.display = 'none';
  trailerDetail.style.display = 'block';
  window.location.hash = `body-${bodyType}`;

  detailContent.innerHTML = `
    <div class="detail-header">
      <h2>${profile.displayName}</h2>
      <div class="subtitle">
        ${profile.bestTrailerName}
        ${(profile.hasDoubles || profile.hasBDoubles) ? ' · Doubles available' : ''}
        ${profile.hasHCT ? ' · HCT available' : ''}
        ${profile.dominatedBy ? ` · <span class="dominated-label">Redundant (use ${profile.dominatedBy.replace(/_/g, ' ')})</span>` : ''}
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${profile.cargoCount}</div>
        <div class="stat-label">Cargo Types</div>
      </div>
      <div class="stat">
        <div class="stat-value">${tiers.length}</div>
        <div class="stat-label">Tiers</div>
      </div>
    </div>

    ${tiers.length > 0 ? `
    <div class="table-section">
      <h2>Available Tiers</h2>
      <p class="table-hint">All variants within a tier haul the same cargo. Best variant shown.</p>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Best Model</th>
            <th class="tooltip" data-tooltip="Number of ownable variants in this tier">Variants</th>
            <th class="tooltip" data-tooltip="Volume of best variant (m³)">Volume</th>
            <th class="tooltip" data-tooltip="Length of best variant (m)">Length</th>
            <th class="tooltip" data-tooltip="Gross weight limit (tonnes)">GWL</th>
            <th>Countries</th>
          </tr>
        </thead>
        <tbody>
          ${tiers.map((t) => `
            <tr>
              <td><strong>${t.tier}</strong></td>
              <td>${t.bestName}</td>
              <td class="amount">${t.count}</td>
              <td class="amount">${t.volume}</td>
              <td class="amount">${t.length}</td>
              <td class="amount">${Math.round(t.gwl / 1000)}t</td>
              <td>${t.countries}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <div class="table-section">
      <h2>Compatible Cargo (${cargoList.length})</h2>
      <p class="table-hint">Values for best standard trailer (vol ${tiers.find((t) => t.tier === 'Standard')?.volume ?? '?'}).</p>
      ${cargoList.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Cargo</th>
              <th class="tooltip" data-tooltip="Value per unit per km (with fragile/high-value bonuses)">Value/Unit</th>
              <th class="tooltip" data-tooltip="Units fitting in best standard trailer">Units</th>
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
      ` : '<div class="empty-state">No cargo data.</div>'}
    </div>
  `;
}

function showProfileList(): void {
  trailerDetail.style.display = 'none';
  content.style.display = 'block';
  window.location.hash = '';
  renderProfileList(searchInput.value);
}

function handleHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#body-')) {
    const bodyType = hash.replace('#body-', '');
    if (bodyType) showProfileDetail(bodyType);
  } else {
    showProfileList();
  }
}

async function init(): Promise<void> {
  content.innerHTML = '<div class="loading">Loading trailers...</div>';

  try {
    data = await loadAllData();
    lookups = buildLookups(data);
    profiles = getBodyTypeProfiles(data, lookups);

    renderProfileList();

    searchInput.addEventListener('input', () => {
      renderProfileList(searchInput.value);
    });

    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      showProfileList();
    });

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
  } catch (err) {
    console.error('Failed to initialize:', err);
    const message = err instanceof Error ? err.message : 'Unknown error occurred';
    content.innerHTML = `
      <div class="empty-state">
        <p>Failed to load data</p>
        <p style="color: #888; font-size: 0.9rem; margin-top: 0.5rem;">${message}</p>
      </div>
    `;
  }
}

init();
