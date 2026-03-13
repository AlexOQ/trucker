/**
 * Companies page module for ETS2 Trucker Advisor
 * Displays company browser with city/cargo information
 */

import { initPageData, initThemeToggle } from './page-init';
import { normalize, cargoBonus, type AllData, type Lookups, type City, type Cargo } from './data';

let data: AllData | null = null;
let lookups: Lookups | null = null;

const content = document.getElementById('content') as HTMLElement;
const companyDetail = document.getElementById('company-detail') as HTMLElement;
const detailContent = document.getElementById('detail-content') as HTMLElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const backLink = document.getElementById('back-link') as HTMLElement;

interface CityWithDepotCount extends City {
  depotCount: number;
}

function getCompanyCities(companyId: string): CityWithDepotCount[] {
  if (!lookups) return [];

  const cities: CityWithDepotCount[] = [];
  for (const [cityId, companies] of lookups.cityCompanyMap) {
    const match = companies.find((c) => c.companyId === companyId);
    if (match) {
      const city = lookups.citiesById.get(cityId);
      if (city) {
        cities.push({ ...city, depotCount: match.count });
      }
    }
  }
  return cities.sort((a, b) => a.name.localeCompare(b.name));
}

interface CargoWithSpawn extends Cargo {
  spawnWeight: number;
  expectedValue: number;
}

function getCompanyCargo(companyId: string): CargoWithSpawn[] {
  if (!lookups) return [];

  const cargoIds = lookups.companyCargoMap.get(companyId) || [];
  return cargoIds
    .map((id) => {
      const cargo = lookups!.cargoById.get(id);
      if (!cargo) return null;
      const spawnWeight = cargo.prob_coef ?? 1.0;
      const multiplier = cargoBonus(cargo);
      const expectedValue = cargo.value * multiplier * spawnWeight;
      return { ...cargo, spawnWeight, expectedValue };
    })
    .filter((c): c is CargoWithSpawn => c !== null)
    .sort((a, b) => b.expectedValue - a.expectedValue);
}

interface CompanyStats {
  cityCount: number;
  depotCount: number;
  cargoCount: number;
  totalExpectedValue: number;
}

function getCompanyStats(companyId: string): CompanyStats {
  const cities = getCompanyCities(companyId);
  const cargo = getCompanyCargo(companyId);
  const totalDepots = cities.reduce((sum, c) => sum + c.depotCount, 0);

  return {
    cityCount: cities.length,
    depotCount: totalDepots,
    cargoCount: cargo.length,
    totalExpectedValue: cargo.reduce((sum, c) => sum + c.expectedValue, 0),
  };
}

function renderCompanyList(filter = ''): void {
  if (!data || !lookups) return;

  const filterNorm = normalize(filter);
  const filtered = data.companies
    .filter((c) => normalize(c.name).includes(filterNorm))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (filtered.length === 0) {
    const escaped = filter.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    content.innerHTML = filter
      ? `<div class="empty-state">No companies found matching "${escaped}". Try a different search term.</div>`
      : '<div class="empty-state">No companies found.</div>';
    return;
  }

  // Group by first letter
  const groups = new Map<string, typeof filtered>();
  for (const company of filtered) {
    const letter = company.name[0].toUpperCase();
    if (!groups.has(letter)) {
      groups.set(letter, []);
    }
    groups.get(letter)!.push(company);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  content.innerHTML = sortedGroups
    .map(
      ([letter, companies]) => `
        <div class="country-section">
          <div class="country-header">
            <h3>${letter}</h3>
            <span class="country-count">${companies.length} companies</span>
          </div>
          <div class="country-content">
            <div class="cards-grid">
              ${companies
                .map((company) => {
                  const stats = getCompanyStats(company.id);
                  return `
                    <a href="#company-${company.id}" class="card-link" data-company-id="${company.id}">
                      <div class="card">
                        <div class="card-title">${company.name}</div>
                        <div class="card-subtitle">
                          ${stats.cityCount} cities · ${stats.cargoCount} cargo types
                        </div>
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
  content.querySelectorAll('[data-company-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      showCompanyDetail((el as HTMLElement).dataset.companyId!);
    });
  });
}

function showCompanyDetail(companyId: string): void {
  if (!lookups) return;

  const company = lookups.companiesById.get(companyId);
  if (!company) return;

  const cities = getCompanyCities(companyId);
  const cargo = getCompanyCargo(companyId);
  const stats = getCompanyStats(companyId);

  content.style.display = 'none';
  companyDetail.style.display = 'block';
  window.location.hash = `company-${companyId}`;

  // Group cities by country
  const citiesByCountry = new Map<string, CityWithDepotCount[]>();
  for (const city of cities) {
    const country = city.country || 'Unknown';
    if (!citiesByCountry.has(country)) {
      citiesByCountry.set(country, []);
    }
    citiesByCountry.get(country)!.push(city);
  }
  const sortedCountries = [...citiesByCountry.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  detailContent.innerHTML = `
    <div class="detail-header">
      <h2>${company.name}</h2>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${stats.cityCount}</div>
        <div class="stat-label">Cities</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.depotCount}</div>
        <div class="stat-label">Total Depots</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.cargoCount}</div>
        <div class="stat-label">Cargo Types</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.totalExpectedValue.toFixed(2)}</div>
        <div class="stat-label">Expected Value</div>
      </div>
    </div>

    <div class="table-section">
      <h2>Locations</h2>
      <table>
        <thead>
          <tr>
            <th>City</th>
            <th>Country</th>
            <th>Depots</th>
          </tr>
        </thead>
        <tbody>
          ${sortedCountries
            .map(([, countryCities]) =>
              countryCities
                .map(
                  (city) => `
                    <tr>
                      <td><a href="cities.html#city-${city.id}" class="link">${city.name}</a></td>
                      <td class="country-name">${city.country || ''}</td>
                      <td class="amount">${city.depotCount}</td>
                    </tr>
                  `
                )
                .join('')
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <div class="table-section">
      <h2>Cargo Provided</h2>
      ${
        cargo.length > 0
          ? `
            <table>
              <thead>
                <tr>
                  <th>Cargo</th>
                  <th>Value</th>
                  <th class="tooltip" data-tooltip="Observed spawn probability at this company">Spawn %</th>
                  <th class="tooltip" data-tooltip="Value × Spawn Weight (higher = more profitable)">Expected</th>
                  <th>Properties</th>
                </tr>
              </thead>
              <tbody>
                ${cargo
                  .map(
                    (c) => `
                      <tr>
                        <td><a href="cargo.html#cargo-${c.id}" class="link">${c.name}</a></td>
                        <td class="value">€${c.value.toLocaleString()}</td>
                        <td class="amount">${(c.spawnWeight * 100).toFixed(1)}%</td>
                        <td class="value">${c.expectedValue.toFixed(2)}</td>
                        <td>
                          ${c.excluded ? '<span class="tag">No Trailer</span>' : ''}
                          ${c.high_value ? '<span class="tag highlight">High Value</span>' : ''}
                          ${c.fragile ? '<span class="tag">Fragile</span>' : ''}
                        </td>
                      </tr>
                    `
                  )
                  .join('')}
              </tbody>
            </table>
          `
          : '<div class="empty-state">No cargo data yet.</div>'
      }
    </div>
  `;
}

function showCompanyList(): void {
  companyDetail.style.display = 'none';
  content.style.display = 'block';
  window.location.hash = '';
  renderCompanyList(searchInput.value);
}

function handleHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#company-')) {
    const companyId = hash.replace('#company-', '');
    if (companyId) showCompanyDetail(companyId);
  } else {
    showCompanyList();
  }
}

async function init(): Promise<void> {
  initThemeToggle();
  // Show loading state
  content.innerHTML = '<div class="loading">Loading companies...</div>';

  try {
    const page = await initPageData();
    data = page.data;
    lookups = page.lookups;

    renderCompanyList();

    searchInput.addEventListener('input', () => {
      renderCompanyList(searchInput.value);
    });

    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      showCompanyList();
    });

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
  } catch (err) {
    console.error('Failed to initialize:', err);
    const message = err instanceof Error ? err.message : 'Unknown error occurred';
    content.innerHTML = `
      <div class="empty-state" role="alert">
        <p>Failed to load data</p>
        <p class="error-detail">${message}</p>
      </div>
    `;
  }
}

init();
