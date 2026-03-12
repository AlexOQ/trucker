import { loadAllData, buildLookups, applyDLCFilter, getBlockedCities } from './data.js';
import {
  calculateCityRankings, computeOptimalFleet,
  type CityRanking, type FleetEntry, type OptimalFleetEntry,
} from './optimizer.js';
import {
  getOwnedGarages, toggleOwnedGarage, isOwnedGarage,
  getFilterMode, setFilterMode,
  getSelectedCountries, setSelectedCountries,
  getOwnedTrailerDLCs, getOwnedCargoDLCs, getOwnedMapDLCs,
  isFirstVisit, isBannerDismissed, dismissBanner,
  COMBINED_CARGO_DLC_MAP, CITY_DLC_MAP,
} from './storage.js';
import { copyToClipboard } from './clipboard.js';
import type { AllData, Lookups } from './data.js';

let data: AllData | null = null;
let lookups: Lookups | null = null;
let currentCityId: string | null = null;
let cachedRankings: CityRanking[] | null = null;
let displayedRankings: CityRanking[] | null = null;

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function normalize(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}

function getUniqueCountries(): string[] {
  if (!data || !data.cities) return [];
  const countries = Array.from(new Set(data.cities.map((c) => c.country)));
  return countries.sort();
}

// ============================================
// Country filter dropdown
// ============================================

function toggleDropdown() {
  const dropdown = document.getElementById('country-dropdown')!;
  const btn = document.getElementById('country-filter-btn')!;
  const isVisible = dropdown.style.display !== 'none';
  if (isVisible) {
    dropdown.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
  } else {
    dropdown.style.display = 'block';
    btn.setAttribute('aria-expanded', 'true');
    const firstCheckbox = dropdown.querySelector('input[type="checkbox"]');
    if (firstCheckbox) (firstCheckbox as HTMLElement).focus();
  }
}

function closeDropdown() {
  const dropdown = document.getElementById('country-dropdown')!;
  const btn = document.getElementById('country-filter-btn')!;
  dropdown.style.display = 'none';
  btn.setAttribute('aria-expanded', 'false');
}

function updateCountryButtonText() {
  const selected = getSelectedCountries();
  const btn = document.getElementById('country-filter-btn')!;
  if (selected.length === 0) {
    btn.textContent = 'All Countries';
    btn.setAttribute('aria-label', 'Filter by country');
  } else if (selected.length === 1) {
    btn.textContent = '1 Country';
    btn.setAttribute('aria-label', 'Filter by country, 1 selected');
  } else {
    btn.textContent = `${selected.length} Countries`;
    btn.setAttribute('aria-label', `Filter by country, ${selected.length} selected`);
  }
}

function renderCountryCheckboxes() {
  const countries = getUniqueCountries();
  const countryOptions = document.getElementById('country-options')!;
  const selected = getSelectedCountries();

  countryOptions.innerHTML = `
    <label class="country-option all-countries" role="option">
      <input type="checkbox" id="all-countries-checkbox"
        aria-checked="${selected.length === 0 ? 'true' : 'false'}"
        ${selected.length === 0 ? 'checked' : ''}>
      <span>All Countries</span>
    </label>
    ${countries.map((country) => `
      <label class="country-option" role="option">
        <input type="checkbox" value="${country}"
          aria-checked="${selected.includes(country) ? 'true' : 'false'}"
          aria-label="${country}"
          ${selected.includes(country) ? 'checked' : ''}>
        <span>${country}</span>
      </label>
    `).join('')}
  `;

  document.getElementById('all-countries-checkbox')!.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) {
      setSelectedCountries([]);
      renderCountryCheckboxes();
      updateCountryButtonText();
      renderRankings();
    }
  });

  countryOptions.querySelectorAll('input[type="checkbox"]:not(#all-countries-checkbox)').forEach((checkbox) => {
    checkbox.addEventListener('change', (e) => {
      const country = (e.target as HTMLInputElement).value;
      const sel = getSelectedCountries();
      if ((e.target as HTMLInputElement).checked) {
        if (!sel.includes(country)) setSelectedCountries([...sel, country]);
      } else {
        setSelectedCountries(sel.filter((c) => c !== country));
      }
      renderCountryCheckboxes();
      updateCountryButtonText();
      renderRankings();
    });
  });
}

// ============================================
// Garage count badge
// ============================================

function updateGarageCount() {
  const ownedGarages = getOwnedGarages();
  if (!data || !lookups) {
    document.getElementById('garage-count')!.textContent = ownedGarages.length.toString();
    return;
  }
  const searchTerm = normalize(citySearch.value);
  const selectedCountries = getSelectedCountries();
  let count = 0;
  for (const cityIdStr of ownedGarages) {
    const city = lookups.citiesById.get(cityIdStr);
    if (!city) continue;
    if (searchTerm && !normalize(city.name).includes(searchTerm) && !normalize(city.country).includes(searchTerm)) continue;
    if (selectedCountries.length > 0 && !selectedCountries.includes(city.country)) continue;
    count++;
  }
  document.getElementById('garage-count')!.textContent = count.toString();
}

// ============================================
// Rank helpers
// ============================================

function getCityRank(cityId: string) {
  if (!displayedRankings) return null;
  const index = displayedRankings.findIndex((r) => r.id === cityId);
  if (index === -1) return null;
  return { rank: index + 1, total: displayedRankings.length };
}

function formatRank(rank: number, total: number): string {
  const isTopTier = rank <= Math.ceil(total * 0.1);
  const className = isTopTier ? 'rank-display top-tier' : 'rank-display';
  return `<span class="${className}"><span class="rank">#${rank}</span> of ${total}</span>`;
}

// ============================================
// DOM elements
// ============================================

const rankingsView = document.getElementById('rankings-view')!;
const rankingsContent = document.getElementById('rankings-content')!;
const cityView = document.getElementById('city-view')!;
const cityContent = document.getElementById('city-content')!;
const backLink = document.getElementById('back-link')!;
const filterToggle = document.getElementById('filter-toggle')!;
const citySearch = document.getElementById('city-search') as HTMLInputElement;
const howItWorksToggle = document.getElementById('how-it-works-toggle');

// Filter toggle
filterToggle.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.filter-btn');
  if (!btn) return;
  const mode = btn.getAttribute('data-filter')!;
  filterToggle.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  setFilterMode(mode);
  renderRankings();
});

// ============================================
// Rankings rendering
// ============================================

function summarizeTrailers(fleet: FleetEntry[]): string {
  return fleet.map(e => e.displayName).join(', ');
}

function renderRankings() {
  const rankings = calculateCityRankings(data!, lookups!);
  cachedRankings = rankings;

  if (rankings.length === 0) {
    cachedRankings = null;
    rankingsContent.innerHTML = '<div class="empty-state">No cities with data yet.</div>';
    return;
  }

  const searchTerm = normalize(citySearch.value);
  let filtered = rankings.filter(
    (r) => normalize(r.name).includes(searchTerm) || normalize(r.country).includes(searchTerm)
  );

  const selectedCountries = getSelectedCountries();
  if (selectedCountries.length > 0) {
    filtered = filtered.filter((r) => selectedCountries.includes(r.country));
  }

  const filterMode = getFilterMode();
  const ownedSet = new Set(getOwnedGarages());
  const displayRankings = filterMode === 'owned' ? filtered.filter((r) => ownedSet.has(r.id)) : filtered;
  displayedRankings = displayRankings;

  if (filterMode === 'owned' && displayRankings.length === 0) {
    rankingsContent.innerHTML = `
      <div class="empty-garages">
        <p>No garages marked yet.</p>
        <p class="hint">Click any city row, then click the star to mark it as your garage.</p>
      </div>
    `;
    return;
  }

  if (displayRankings.length === 0) {
    let message: string;
    if (searchTerm) {
      message = `No cities match '${citySearch.value.trim()}'`;
    } else if (selectedCountries.length > 0) {
      message = 'No cities match your filters';
    } else {
      message = 'No results found';
    }
    rankingsContent.innerHTML = `
      <div class="table-section">
        <table class="table-rankings">
          <thead>
            <tr>
              <th></th>
              <th>#</th>
              <th>City</th>
              <th>Country</th>
              <th class="tooltip" data-tooltip="Company facilities in this city">Depots</th>
              <th class="tooltip" data-tooltip="Distinct cargo types available">Cargo</th>
              <th class="tooltip" data-tooltip="Sum of top 5 body type EVs — fleet earning potential">Fleet EV</th>
              <th class="tooltip" data-tooltip="Top earning trailer types for this city">Best Trailers</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colspan="8" class="no-results">${message}</td></tr>
          </tbody>
        </table>
      </div>
    `;
    updateGarageCount();
    return;
  }

  rankingsContent.innerHTML = `
    <div class="table-section">
      <h2>City Rankings (${displayRankings.length} cities)</h2>
      <p class="table-hint">Ranked by combined fleet EV (top 5 trailer types). Click any city for details.</p>
      <table class="table-rankings">
        <thead>
          <tr>
            <th></th>
            <th>#</th>
            <th>City</th>
            <th>Country</th>
            <th class="tooltip" data-tooltip="Company facilities in this city">Depots</th>
            <th class="tooltip" data-tooltip="Distinct cargo types available">Cargo</th>
            <th class="tooltip" data-tooltip="Sum of top 5 body type EVs — fleet earning potential">Fleet EV</th>
            <th class="tooltip" data-tooltip="Top earning trailer types for this city">Best Trailers</th>
          </tr>
        </thead>
        <tbody>
          ${displayRankings.map((r, i) => {
            const trailerSummary = summarizeTrailers(r.topTrailers);
            const starred = ownedSet.has(r.id);
            return `
            <tr class="clickable${starred ? ' owned-garage' : ''}" data-city-id="${r.id}" tabindex="0">
              <td class="garage-star" data-city-id="${r.id}" title="${starred ? 'Remove garage' : 'Mark as garage'}">${starred ? '\u2605' : '\u2606'}</td>
              <td>${i + 1}</td>
              <td>${r.name}</td>
              <td class="country">${r.country}</td>
              <td>${r.depotCount}</td>
              <td class="amount">${r.cargoTypes}</td>
              <td class="score">${formatNumber(r.score)}</td>
              <td class="trailer-summary">${trailerSummary}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Star click toggles garage without navigating to city
  rankingsContent.querySelectorAll('.garage-star').forEach((star) => {
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      const cityId = (star as HTMLElement).dataset.cityId!;
      const nowOwned = toggleOwnedGarage(cityId);
      (star as HTMLElement).textContent = nowOwned ? '\u2605' : '\u2606';
      (star as HTMLElement).title = nowOwned ? 'Remove garage' : 'Mark as garage';
      const row = (star as HTMLElement).closest('tr')!;
      row.classList.toggle('owned-garage', nowOwned);
      updateGarageCount();
    });
  });

  rankingsContent.querySelectorAll('tr.clickable').forEach((row) => {
    row.addEventListener('click', () => showCity((row as HTMLElement).dataset.cityId!));
    row.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        showCity((row as HTMLElement).dataset.cityId!);
      }
    });
  });

  updateGarageCount();
}

// ============================================
// City detail rendering
// ============================================

function ensureRankingsCached() {
  if (cachedRankings === null && data && lookups) {
    cachedRankings = calculateCityRankings(data, lookups);
  }
  if (displayedRankings === null && cachedRankings) {
    // Apply current filters to build displayed rankings
    const searchTerm = normalize(citySearch.value);
    let filtered = cachedRankings.filter(
      (r) => normalize(r.name).includes(searchTerm) || normalize(r.country).includes(searchTerm)
    );
    const selectedCountries = getSelectedCountries();
    if (selectedCountries.length > 0) {
      filtered = filtered.filter((r) => selectedCountries.includes(r.country));
    }
    const filterMode = getFilterMode();
    const ownedSet = new Set(getOwnedGarages());
    displayedRankings = filterMode === 'owned' ? filtered.filter((r) => ownedSet.has(r.id)) : filtered;
  }
}

function renderFleetRow(entry: OptimalFleetEntry): string {
  const countLabel = entry.count > 1 ? ` ×${entry.count}` : '';
  const trailerLink = `trailers.html#body-${entry.bodyType}`;
  return `
    <tr>
      <td>
        <div><a href="${trailerLink}" class="body-type-link">${entry.displayName}${countLabel}</a></div>
        <div class="trailer-spec">${entry.trailerSpec}</div>
      </td>
      <td class="amount">${formatNumber(entry.ev)}</td>
      <td class="amount">${entry.cargoMatched}</td>
    </tr>
  `;
}

function renderCity(cityId: string) {
  ensureRankingsCached();

  const city = lookups!.citiesById.get(cityId);
  if (!city) {
    cityContent.innerHTML = '<div class="empty-state">City not found.</div>';
    return;
  }

  const optimal = computeOptimalFleet(cityId, data!, lookups!);
  if (!optimal) {
    const emptyOwned = isOwnedGarage(cityId);
    cityContent.innerHTML = `
      <div class="city-header">
        <div class="city-header-row">
          <div>
            <h2>${city.name}</h2>
            <span class="country">${city.country}</span>
          </div>
          <button class="garage-toggle" id="city-garage-toggle"
            aria-pressed="${emptyOwned}" aria-label="${emptyOwned ? 'Remove garage' : 'Mark as garage'}"
            title="${emptyOwned ? 'Remove garage' : 'Mark as garage'}"
            data-city-id="${cityId}">${emptyOwned ? '\u2605' : '\u2606'}</button>
        </div>
      </div>
      <div class="empty-state">No cargo data for this city yet.</div>
    `;
    wireGarageToggle(cityId);
    return;
  }

  const cityRank = getCityRank(cityId);
  const cityCompanies = lookups!.cityCompanyMap.get(cityId) || [];
  let depotCount = 0;
  for (const { count } of cityCompanies) depotCount += count;

  const rankingEntry = cachedRankings?.find(r => r.id === cityId);
  const cargoTypes = rankingEntry?.cargoTypes ?? 0;
  const score = rankingEntry?.score ?? 0;

  const owned = isOwnedGarage(cityId);

  cityContent.innerHTML = `
    <div class="city-header">
      <div class="city-header-row">
        <div>
          <h2>${city.name}</h2>
          <span class="country">${city.country}</span>
        </div>
        <button class="garage-toggle" id="city-garage-toggle"
          aria-pressed="${owned}" aria-label="${owned ? 'Remove garage' : 'Mark as garage'}"
          title="${owned ? 'Remove garage' : 'Mark as garage'}"
          data-city-id="${cityId}">${owned ? '\u2605' : '\u2606'}</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${depotCount}</div>
        <div class="stat-label">Depots</div>
      </div>
      <div class="stat">
        <div class="stat-value">${cargoTypes}</div>
        <div class="stat-label">Cargo Types</div>
      </div>
      <div class="stat">
        <div class="stat-value">${cityRank ? formatRank(cityRank.rank, cityRank.total) : '-'}</div>
        <div class="stat-label">Rank</div>
      </div>
      <div class="stat">
        <div class="stat-value">${formatNumber(score)}</div>
        <div class="stat-label">Score</div>
      </div>
    </div>

    <div class="table-section">
      <div class="section-header">
        <h2>Recommended Fleet — ${optimal.totalTrailers} trailers</h2>
        <div class="export-buttons">
          <button class="btn copy-btn" id="copy-fleet-btn" type="button">Copy Fleet</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Trailer Type</th>
            <th class="tooltip" data-tooltip="Expected value per job cycle">EV</th>
            <th class="tooltip" data-tooltip="Cargo types this trailer can haul">Cargo</th>
          </tr>
        </thead>
        <tbody>
          ${optimal.drivers.map(renderFleetRow).join('')}
        </tbody>
      </table>

    </div>
  `;

  wireGarageToggle(cityId);
  wireCopyFleetButton(city.name, optimal.drivers);
}

function wireCopyFleetButton(cityName: string, drivers: OptimalFleetEntry[]) {
  const copyBtn = document.getElementById('copy-fleet-btn') as HTMLButtonElement | null;
  if (!copyBtn) return;

  copyBtn.addEventListener('click', () => {
    const lines = drivers.map(d => {
      const countLabel = d.count > 1 ? ` x${d.count}` : '';
      return `${d.displayName}${countLabel} (EV: ${formatNumber(d.ev)}, ${d.cargoMatched} cargo)`;
    });
    const text = `${cityName} Fleet:\n${lines.join('\n')}`;
    copyToClipboard(text, copyBtn);
  });
}

function wireGarageToggle(cityId: string) {
  const garageToggle = document.getElementById('city-garage-toggle');
  if (garageToggle) {
    garageToggle.addEventListener('click', () => {
      const nowOwned = toggleOwnedGarage(cityId);
      garageToggle.textContent = nowOwned ? '\u2605' : '\u2606';
      garageToggle.setAttribute('aria-pressed', String(nowOwned));
      garageToggle.setAttribute('aria-label', nowOwned ? 'Remove garage' : 'Mark as garage');
      garageToggle.title = nowOwned ? 'Remove garage' : 'Mark as garage';
      // Sync the rankings table star if it exists
      const rankingStar = rankingsContent.querySelector(`.garage-star[data-city-id="${cityId}"]`) as HTMLElement | null;
      if (rankingStar) {
        rankingStar.textContent = nowOwned ? '\u2605' : '\u2606';
        rankingStar.title = nowOwned ? 'Remove garage' : 'Mark as garage';
        const row = rankingStar.closest('tr')!;
        row.classList.toggle('owned-garage', nowOwned);
      }
      updateGarageCount();
    });
  }
}


// ============================================
// Navigation
// ============================================

function showCity(cityId: string) {
  currentCityId = cityId;
  rankingsView.style.display = 'none';
  cityView.style.display = 'block';
  if (window.location.hash !== `#city-${cityId}`) {
    window.location.hash = `city-${cityId}`;
  }
  renderCity(cityId);
  window.scrollTo(0, 0);
}

function showRankings() {
  currentCityId = null;
  cityView.style.display = 'none';
  rankingsView.style.display = 'block';
  window.location.hash = '';
  renderRankings();
}

function handleHashNavigation(): boolean {
  const hash = window.location.hash;
  if (hash.startsWith('#city-')) {
    const cityId = hash.replace('#city-', '');
    if (cityId && lookups?.citiesById.has(cityId)) {
      showCity(cityId);
      return true;
    }
  }
  return false;
}

// ============================================
// Loading / Error states
// ============================================

function showLoading() {
  rankingsContent.innerHTML = `
    <div class="table-section">
      <h2>Loading city data...</h2>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div></div>
    </div>
  `;
}

function showError(errorMessage: string) {
  rankingsContent.innerHTML = `
    <div class="empty-state">
      <p>Failed to load data</p>
      <p style="color: #888; font-size: 0.9rem; margin-top: 0.5rem;">${errorMessage}</p>
    </div>
  `;
}

// ============================================
// Settings
// ============================================


// ============================================
// First-visit DLC banner
// ============================================

function showDLCBanner() {
  // Show banner only for first-time visitors who haven't dismissed it
  if (!isFirstVisit() || isBannerDismissed()) return;

  const banner = document.createElement('div');
  banner.className = 'dlc-banner';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <span class="dlc-banner-text">
      First time here? Configure your owned DLCs for accurate recommendations.
    </span>
    <a href="dlcs.html" class="dlc-banner-link">DLC Settings</a>
    <button class="dlc-banner-dismiss" aria-label="Dismiss banner" type="button">&times;</button>
  `;

  const main = document.getElementById('main-content')!;
  main.insertBefore(banner, main.firstChild);

  banner.querySelector('.dlc-banner-dismiss')!.addEventListener('click', () => {
    dismissBanner();
    banner.remove();
  });
}

// ============================================
// Init
// ============================================

async function init() {
  showDLCBanner();
  showLoading();

  try {
    const ownedCargoAndMap = new Set([...getOwnedCargoDLCs(), ...getOwnedMapDLCs()]);
    const blocked = getBlockedCities(getOwnedMapDLCs(), CITY_DLC_MAP);
    data = applyDLCFilter(await loadAllData(), getOwnedTrailerDLCs(), ownedCargoAndMap, COMBINED_CARGO_DLC_MAP, blocked);
    lookups = buildLookups(data);

    renderCountryCheckboxes();
    updateCountryButtonText();

    const savedFilterMode = getFilterMode();
    filterToggle.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === savedFilterMode);
    });
    updateGarageCount();

    if (!handleHashNavigation()) {
      renderRankings();
    }

    citySearch.addEventListener('input', debounce(renderRankings, 150));
    backLink.addEventListener('click', showRankings);
    window.addEventListener('hashchange', () => {
      if (!handleHashNavigation()) showRankings();
    });

    // How It Works toggle
    if (howItWorksToggle) {
      howItWorksToggle.addEventListener('click', () => {
        const section = howItWorksToggle.closest('.how-it-works')!;
        const isCollapsed = section.classList.contains('collapsed');
        if (isCollapsed) {
          section.classList.remove('collapsed');
          howItWorksToggle.setAttribute('aria-expanded', 'true');
          howItWorksToggle.querySelector('.toggle-icon')!.textContent = '▼';
        } else {
          section.classList.add('collapsed');
          howItWorksToggle.setAttribute('aria-expanded', 'false');
          howItWorksToggle.querySelector('.toggle-icon')!.textContent = '▶';
        }
      });
    }

    // Country filter dropdown
    const countryFilterBtn = document.getElementById('country-filter-btn')!;
    countryFilterBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(); });
    countryFilterBtn.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        toggleDropdown();
      }
    });

    document.addEventListener('keydown', (e) => {
      const dropdown = document.getElementById('country-dropdown')!;
      if (dropdown.style.display === 'none') return;
      if ((e as KeyboardEvent).key === 'Escape') {
        e.preventDefault();
        closeDropdown();
        countryFilterBtn.focus();
      } else if ((e as KeyboardEvent).key === 'ArrowDown' || (e as KeyboardEvent).key === 'ArrowUp') {
        e.preventDefault();
        const checkboxes = Array.from(dropdown.querySelectorAll('input[type="checkbox"]'));
        const currentIndex = checkboxes.findIndex(
          (cb) => cb === document.activeElement || (cb as HTMLElement).parentElement === document.activeElement
        );
        const nextIndex = (e as KeyboardEvent).key === 'ArrowDown'
          ? (currentIndex < checkboxes.length - 1 ? currentIndex + 1 : 0)
          : (currentIndex > 0 ? currentIndex - 1 : checkboxes.length - 1);
        (checkboxes[nextIndex] as HTMLElement).focus();
      }
    });

    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('country-dropdown')!;
      const filterContainer = document.querySelector('.country-filter')!;
      if (!filterContainer.contains(e.target as Node) && dropdown.style.display !== 'none') {
        closeDropdown();
      }
    });
  } catch (err) {
    console.error('Failed to initialize:', err);
    showError((err as Error).message || 'Unknown error occurred');
  }
}

init();
