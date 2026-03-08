/**
 * Trailers page module for ETS2 Trucker Advisor
 * Shows body type profiles — the minimal trailer set covering all cargo
 */

import {
  loadAllData, buildLookups, normalize, getBodyTypeProfiles,
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
  effectiveValue: number;
}

function getProfileCargo(profile: BodyTypeProfile): CargoWithUnits[] {
  if (!lookups) return [];

  return [...profile.cargoIds]
    .map((cargoId) => {
      const cargo = lookups!.cargoById.get(cargoId);
      if (!cargo || cargo.excluded) return null;
      const units = lookups!.cargoTrailerUnits.get(`${cargoId}:${profile.bestTrailerId}`) ?? 1;
      const multiplier = 1 + (cargo.fragile ? 0.3 : 0) + (cargo.high_value ? 0.3 : 0);
      return {
        ...cargo,
        units,
        effectiveValue: cargo.value * multiplier * units,
      };
    })
    .filter((c): c is CargoWithUnits => c !== null)
    .sort((a, b) => b.effectiveValue - a.effectiveValue);
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
            <th>Representative Trailer</th>
            <th class="tooltip" data-tooltip="Number of cargo types this body type can haul">Cargo</th>
            <th class="tooltip" data-tooltip="Double trailer variants available">Doubles</th>
            <th class="tooltip" data-tooltip="HCT (High Capacity Transport) variants available">HCT</th>
          </tr>
        </thead>
        <tbody>
          ${filtered
            .map(
              (p) => `
              <tr class="clickable" data-body-type="${p.bodyType}" tabindex="0">
                <td><strong>${p.displayName}</strong></td>
                <td>${p.bestTrailerName}</td>
                <td class="amount">${p.cargoCount}</td>
                <td class="amount">${p.hasDoubles ? `<span class="coverage">${p.doublesCountries.length} countries</span>` : '—'}</td>
                <td class="amount">${p.hasHCT ? `<span class="coverage">${p.hctCountries.length} countries</span>` : '—'}</td>
              </tr>
            `
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
  const totalEffective = cargoList.reduce((sum, c) => sum + c.effectiveValue, 0);

  // Collapse ownable trailer variants into tiers (Standard/Double/HCT)
  // All variants within a tier haul the same cargo — only specs and countries differ
  interface TierSummary {
    tier: string;
    count: number;
    bestName: string;      // smallest entry-point trailer name
    bestId: string;
    volumeRange: [number, number];
    lengthRange: [number, number];
    gwlRange: [number, number];
    countries: string;
  }

  const tierMap = new Map<string, typeof data.trailers>();
  for (const t of data.trailers) {
    if (!t.ownable || t.body_type !== bodyType) continue;
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
      // Best = entry-point trailer: smallest GWL, then smallest volume, then shortest
      const best = [...variants].sort((a, b) =>
        a.gross_weight_limit - b.gross_weight_limit
        || a.volume - b.volume
        || a.length - b.length
      )[0];
      const volumes = variants.map((v) => v.volume);
      const lengths = variants.map((v) => v.length);
      const gwls = variants.map((v) => v.gross_weight_limit);
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
        volumeRange: [Math.min(...volumes), Math.max(...volumes)] as [number, number],
        lengthRange: [Math.min(...lengths), Math.max(...lengths)] as [number, number],
        gwlRange: [Math.min(...gwls), Math.max(...gwls)] as [number, number],
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
        ${profile.hasDoubles ? ' · Doubles available' : ''}
        ${profile.hasHCT ? ' · HCT available' : ''}
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
      <div class="stat">
        <div class="stat-value">${Math.round(totalEffective)}</div>
        <div class="stat-label">Total Value</div>
      </div>
    </div>

    ${tiers.length > 0 ? `
    <div class="table-section">
      <h2>Available Tiers</h2>
      <p class="table-hint">All variants within a tier haul the same cargo. Entry-point model shown.</p>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Entry Model</th>
            <th class="tooltip" data-tooltip="Number of ownable variants in this tier">Variants</th>
            <th class="tooltip" data-tooltip="Volume range across variants (m³)">Volume</th>
            <th class="tooltip" data-tooltip="Length range across variants (m)">Length</th>
            <th class="tooltip" data-tooltip="Gross weight limit range (tonnes)">GWL</th>
            <th>Countries</th>
          </tr>
        </thead>
        <tbody>
          ${tiers.map((t) => {
            const fmtRange = (r: [number, number]) => r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`;
            const fmtGwl = (r: [number, number]) => {
              const lo = Math.round(r[0] / 1000);
              const hi = Math.round(r[1] / 1000);
              return lo === hi ? `${lo}t` : `${lo}–${hi}t`;
            };
            return `
            <tr>
              <td><strong>${t.tier}</strong></td>
              <td>${t.bestName}</td>
              <td class="amount">${t.count}</td>
              <td class="amount">${fmtRange(t.volumeRange)}</td>
              <td class="amount">${fmtRange(t.lengthRange)}</td>
              <td class="amount">${fmtGwl(t.gwlRange)}</td>
              <td>${t.countries}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <div class="table-section">
      <h2>Compatible Cargo (${cargoList.length})</h2>
      ${cargoList.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Cargo</th>
              <th class="tooltip" data-tooltip="Base value per unit per km">Value</th>
              <th class="tooltip" data-tooltip="Units that fit in the best standard trailer">Units</th>
              <th class="tooltip" data-tooltip="Value × Multiplier × Units">Effective</th>
              <th>Properties</th>
            </tr>
          </thead>
          <tbody>
            ${cargoList.map((c) => `
              <tr>
                <td><a href="cargo.html#cargo-${c.id}" class="link">${c.name || c.id}</a></td>
                <td class="value">${c.value.toFixed(2)}</td>
                <td class="amount">${c.units}</td>
                <td class="value">${c.effectiveValue.toFixed(2)}</td>
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
