/**
 * Cities page module for ETS2 Trucker Advisor
 * Displays city browser with company/depot information
 */

import { initPageData } from './page-init';
import { normalize, type AllData, type Lookups, type Company } from './data';
import { isOwnedGarage } from './storage';

let data: AllData | null = null;
let lookups: Lookups | null = null;

const content = document.getElementById('content') as HTMLElement;
const cityDetail = document.getElementById('city-detail') as HTMLElement;
const detailContent = document.getElementById('detail-content') as HTMLElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const backLink = document.getElementById('back-link') as HTMLElement;

// Collapse state persistence
const COLLAPSE_KEY = 'ets2-cities-collapsed';

function getCollapsedCountries(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCollapsedCountries(collapsed: string[]): void {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
}

function toggleCountry(country: string): boolean {
  const collapsed = getCollapsedCountries();
  const idx = collapsed.indexOf(country);
  if (idx >= 0) {
    collapsed.splice(idx, 1);
  } else {
    collapsed.push(country);
  }
  saveCollapsedCountries(collapsed);
  return collapsed.includes(country);
}

interface CityWithCountry {
  id: string;
  name: string;
  country: string;
}

function groupByCountry(cities: CityWithCountry[]): [string, CityWithCountry[]][] {
  const groups = new Map<string, CityWithCountry[]>();
  for (const city of cities) {
    const country = city.country || 'Unknown';
    if (!groups.has(country)) {
      groups.set(country, []);
    }
    groups.get(country)!.push(city);
  }
  // Sort countries and cities within
  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [, citiesList] of sorted) {
    citiesList.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

interface CompanyWithCount extends Company {
  count: number;
}

function getCityCompanies(cityId: string): CompanyWithCount[] {
  if (!lookups) return [];
  const cityCompanies = lookups.cityCompanyMap.get(cityId) || [];
  return cityCompanies
    .map(({ companyId, count }) => {
      const company = lookups!.companiesById.get(companyId);
      return company ? { ...company, count } : null;
    })
    .filter((c): c is CompanyWithCount => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface CityStats {
  companyCount: number;
  depotCount: number;
  cargoCount: number;
}

function getCityStats(cityId: string): CityStats {
  if (!lookups) return { companyCount: 0, depotCount: 0, cargoCount: 0 };

  const companies = getCityCompanies(cityId);
  const totalDepots = companies.reduce((sum, c) => sum + c.count, 0);

  // Count cargo types
  const cargoSet = new Set<string>();
  for (const company of companies) {
    const cargoIds = lookups.companyCargoMap.get(company.id) || [];
    cargoIds.forEach((id) => cargoSet.add(id));
  }

  return {
    companyCount: companies.length,
    depotCount: totalDepots,
    cargoCount: cargoSet.size,
  };
}

function renderCityList(filter = ''): void {
  if (!data || !lookups) return;

  const filterNorm = normalize(filter);
  const filtered = data.cities.filter(
    (c) => normalize(c.name).includes(filterNorm) || normalize(c.country).includes(filterNorm)
  );

  const grouped = groupByCountry(filtered);

  if (grouped.length === 0) {
    const escaped = filter.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    content.innerHTML = filter
      ? `<div class="empty-state">No cities found matching "${escaped}". Try a different search term.</div>`
      : '<div class="empty-state">No cities found.</div>';
    return;
  }

  const collapsed = getCollapsedCountries();

  content.innerHTML = grouped
    .map(
      ([country, cities]) => `
        <div class="country-section${collapsed.includes(country) ? ' collapsed' : ''}" data-country="${country}">
          <div class="country-header">
            <h3>${country}</h3>
            <span class="country-count">${cities.length} cities</span>
          </div>
          <div class="country-content">
            <div class="cards-grid">
              ${cities
                .map((city) => {
                  const stats = getCityStats(city.id);
                  return `
                    <a href="#city-${city.id}" class="card-link" data-city-id="${city.id}">
                      <div class="card">
                        ${isOwnedGarage(city.id) ? '<span class="card-garage-badge">★</span>' : ''}
                        <div class="card-title">${city.name}</div>
                        <div class="card-subtitle">
                          ${stats.companyCount} companies · ${stats.depotCount} depots
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

  // Add click handlers for city cards
  content.querySelectorAll('[data-city-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      showCityDetail((el as HTMLElement).dataset.cityId!);
    });
  });

  // Add click handlers for country collapse
  content.querySelectorAll('.country-header').forEach((header) => {
    header.addEventListener('click', () => {
      const section = header.closest('.country-section') as HTMLElement;
      const country = section.dataset.country!;
      toggleCountry(country);
      section.classList.toggle('collapsed');
    });
  });
}

function showCityDetail(cityId: string): void {
  if (!lookups) return;

  const city = lookups.citiesById.get(cityId);
  if (!city) return;

  const companies = getCityCompanies(cityId);
  const stats = getCityStats(cityId);

  content.style.display = 'none';
  cityDetail.style.display = 'block';
  window.location.hash = `city-${cityId}`;

  detailContent.innerHTML = `
    <div class="detail-header">
      <h2>${city.name}</h2>
      <div class="subtitle">${city.country || ''}</div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${stats.companyCount}</div>
        <div class="stat-label">Companies</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.depotCount}</div>
        <div class="stat-label">Total Depots</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.cargoCount}</div>
        <div class="stat-label">Cargo Types</div>
      </div>
    </div>

    <div class="table-section">
      <h2>Companies in ${city.name}</h2>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Depots</th>
            <th>Cargo Types</th>
          </tr>
        </thead>
        <tbody>
          ${companies
            .map((company) => {
              const cargoCount = (lookups!.companyCargoMap.get(company.id) || []).length;
              return `
                <tr class="clickable" data-company-id="${company.id}">
                  <td><a href="companies.html#company-${company.id}" class="link">${company.name}</a></td>
                  <td class="amount">${company.count}</td>
                  <td>${cargoCount}</td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>

    <p style="margin-top: 1rem;">
      <a href="index.html#city-${city.id}" class="link">View trailer recommendations →</a>
    </p>
  `;
}

function showCityList(): void {
  cityDetail.style.display = 'none';
  content.style.display = 'block';
  window.location.hash = '';
  renderCityList(searchInput.value);
}

function handleHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#city-')) {
    const cityId = hash.replace('#city-', '');
    if (cityId) showCityDetail(cityId);
  } else {
    showCityList();
  }
}

async function init(): Promise<void> {
  // Show loading state
  content.innerHTML = '<div class="loading">Loading cities...</div>';

  try {
    const page = await initPageData();
    data = page.data;
    lookups = page.lookups;

    renderCityList();

    searchInput.addEventListener('input', () => {
      renderCityList(searchInput.value);
    });

    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      showCityList();
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
