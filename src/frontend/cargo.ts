/**
 * Cargo page module for ETS2 Trucker Advisor
 * Displays cargo browser with provider/trailer information
 */

import { loadAllData, buildLookups, normalize, type AllData, type Lookups, type Company, type Trailer } from './data';

let data: AllData | null = null;
let lookups: Lookups | null = null;

const content = document.getElementById('content') as HTMLElement;
const cargoDetail = document.getElementById('cargo-detail') as HTMLElement;
const detailContent = document.getElementById('detail-content') as HTMLElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const backLink = document.getElementById('back-link') as HTMLElement;

function getCargoProviders(cargoId: number): Company[] {
  if (!lookups) return [];

  const providers: Company[] = [];
  for (const [companyId, cargoIds] of lookups.companyCargoMap) {
    if (cargoIds.includes(cargoId)) {
      const company = lookups.companiesById.get(companyId);
      if (company) {
        providers.push(company);
      }
    }
  }
  return providers.sort((a, b) => a.name.localeCompare(b.name));
}

function getCargoTrailers(cargoId: number): Trailer[] {
  if (!lookups) return [];

  const trailerIds = lookups.cargoTrailerMap.get(cargoId);
  if (!trailerIds) return [];
  return [...trailerIds]
    .map((id) => lookups!.trailersById.get(id))
    .filter((t): t is Trailer => t !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Format trailer names for display in cargo cards
 * Shows first 3 trailers, truncates rest with "+N more" pattern
 */
function formatTrailerNames(trailers: Trailer[]): string {
  if (!trailers || trailers.length === 0) return '';

  const MAX_DISPLAY = 3;
  const names = trailers.map((t) => t.name);

  if (names.length <= MAX_DISPLAY) {
    return `Hauls on: ${names.join(', ')}`;
  }

  const displayed = names.slice(0, MAX_DISPLAY).join(', ');
  const remaining = names.length - MAX_DISPLAY;
  return `Hauls on: ${displayed}, +${remaining} more`;
}

interface CargoStats {
  providerCount: number;
  trailerCount: number;
  cityCount: number;
}

function getCargoStats(cargoId: number): CargoStats {
  if (!lookups) return { providerCount: 0, trailerCount: 0, cityCount: 0 };

  const providers = getCargoProviders(cargoId);
  const trailers = getCargoTrailers(cargoId);

  // Count cities where this cargo is available
  const citySet = new Set<number>();
  for (const provider of providers) {
    for (const [cityId, companies] of lookups.cityCompanyMap) {
      if (companies.some((c) => c.companyId === provider.id)) {
        citySet.add(cityId);
      }
    }
  }

  return {
    providerCount: providers.length,
    trailerCount: trailers.length,
    cityCount: citySet.size,
  };
}

function renderCargoList(filter = ''): void {
  if (!data || !lookups) return;

  const filterNorm = normalize(filter);
  const filtered = data.cargo
    .filter((c) => normalize(c.name).includes(filterNorm))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (filtered.length === 0) {
    const escaped = filter.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    content.innerHTML = filter
      ? `<div class="empty-state">No cargo found matching "${escaped}". Try a different search term.</div>`
      : '<div class="empty-state">No cargo found.</div>';
    return;
  }

  // Group by first letter
  const groups = new Map<string, typeof filtered>();
  for (const cargo of filtered) {
    const letter = cargo.name[0].toUpperCase();
    if (!groups.has(letter)) {
      groups.set(letter, []);
    }
    groups.get(letter)!.push(cargo);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  content.innerHTML = sortedGroups
    .map(
      ([letter, cargoItems]) => `
        <div class="country-section">
          <div class="country-header">
            <h3>${letter}</h3>
            <span class="country-count">${cargoItems.length} cargo types</span>
          </div>
          <div class="country-content">
            <div class="cards-grid">
              ${cargoItems
                .map((cargo) => {
                  const stats = getCargoStats(cargo.id);
                  const trailers = getCargoTrailers(cargo.id);
                  const trailerText = formatTrailerNames(trailers);
                  const cardClasses = ['card', cargo.high_value && 'high-value', cargo.fragile && 'fragile']
                    .filter(Boolean)
                    .join(' ');
                  return `
                    <a href="#cargo-${cargo.id}" class="card-link" data-cargo-id="${cargo.id}">
                      <div class="${cardClasses}">
                        <div class="card-title">${cargo.name}</div>
                        <div class="card-subtitle">
                          €${cargo.value.toLocaleString()} · ${stats.providerCount} providers
                          ${cargo.excluded ? ' · No Trailer' : ''}
                        </div>
                        ${!cargo.excluded && trailerText ? `<div class="card-subtitle">${trailerText}</div>` : ''}
                        ${
                          cargo.high_value || cargo.fragile
                            ? `
                              <div class="tags">
                                ${cargo.high_value ? '<span class="tag highlight">High Value</span>' : ''}
                                ${cargo.fragile ? '<span class="tag">Fragile</span>' : ''}
                              </div>
                            `
                            : ''
                        }
                      </div>
                    </a>
                  `;
                })
                .join('')}
            </div>
          </div>
        </div>
      `
    )
    .join('');

  // Add click handlers
  content.querySelectorAll('[data-cargo-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      showCargoDetail(parseInt((el as HTMLElement).dataset.cargoId!, 10));
    });
  });
}

function showCargoDetail(cargoId: number): void {
  if (!lookups) return;

  const cargo = lookups.cargoById.get(cargoId);
  if (!cargo) return;

  const providers = getCargoProviders(cargoId);
  const trailers = getCargoTrailers(cargoId);
  const stats = getCargoStats(cargoId);

  content.style.display = 'none';
  cargoDetail.style.display = 'block';
  window.location.hash = `cargo-${cargoId}`;

  detailContent.innerHTML = `
    <div class="detail-header">
      <h2>${cargo.name}</h2>
      <div class="subtitle">
        €${cargo.value.toLocaleString()} per job
        ${cargo.excluded ? ' · No Trailer Choice' : ''}
      </div>
      ${
        cargo.high_value || cargo.fragile
          ? `
            <div class="tags">
              ${cargo.high_value ? '<span class="tag highlight">High Value</span>' : ''}
              ${cargo.fragile ? '<span class="tag">Fragile</span>' : ''}
            </div>
          `
          : ''
      }
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${stats.providerCount}</div>
        <div class="stat-label">Providers</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.cityCount}</div>
        <div class="stat-label">Cities</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.trailerCount}</div>
        <div class="stat-label">Trailer Types</div>
      </div>
    </div>

    ${
      !cargo.excluded && trailers.length > 0
        ? `
          <div class="table-section">
            <h2>Compatible Trailers</h2>
            <table>
              <thead>
                <tr>
                  <th>Trailer</th>
                  <th>Ownable</th>
                </tr>
              </thead>
              <tbody>
                ${trailers
                  .map(
                    (t) => `
                      <tr>
                        <td>${t.name}</td>
                        <td>${t.ownable ? '<span class="coverage">Yes</span>' : '<span class="country-name">No</span>'}</td>
                      </tr>
                    `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        : cargo.excluded
          ? `
            <div class="table-section">
              <h2>Trailer Information</h2>
              <p style="padding: 1rem; color: #888;">
                This is a trailer delivery job. The trailer is pre-assigned and cannot be chosen.
              </p>
            </div>
          `
          : ''
    }

    <div class="table-section">
      <h2>Providers</h2>
      ${
        providers.length > 0
          ? `
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                </tr>
              </thead>
              <tbody>
                ${providers
                  .map(
                    (p) => `
                      <tr>
                        <td><a href="companies.html#company-${p.id}" class="link">${p.name}</a></td>
                      </tr>
                    `
                  )
                  .join('')}
              </tbody>
            </table>
          `
          : '<div class="empty-state">No provider data yet.</div>'
      }
    </div>
  `;
}

function showCargoList(): void {
  cargoDetail.style.display = 'none';
  content.style.display = 'block';
  window.location.hash = '';
  renderCargoList(searchInput.value);
}

function handleHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#cargo-')) {
    const cargoId = parseInt(hash.replace('#cargo-', ''), 10);
    if (cargoId) showCargoDetail(cargoId);
  } else {
    showCargoList();
  }
}

async function init(): Promise<void> {
  // Show loading state
  content.innerHTML = '<div class="loading">Loading cargo...</div>';

  try {
    data = await loadAllData();
    lookups = buildLookups(data);

    renderCargoList();

    searchInput.addEventListener('input', () => {
      renderCargoList(searchInput.value);
    });

    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      showCargoList();
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
