import { loadAllData, buildLookups } from './data.js';
import {
  calculateCityRankings,
  getCityBodyTypeStats,
  greedyAllocation,
  expectedIncome,
  type CityRanking,
} from './optimizer.js';
import {
  getSettings,
  resetToDefaults,
  getOwnedGarages,
  isOwnedGarage,
  toggleOwnedGarage,
  getFilterMode,
  setFilterMode,
  getSelectedCountries,
  setSelectedCountries,
} from './storage.js';
import type { AllData, Lookups } from './data.js';

const DRIVER_COUNT = 5;
const TRAILER_SLOTS = 10;

let data: AllData | null = null;
let lookups: Lookups | null = null;
let currentCityId: string | null = null;
let cachedRankings: CityRanking[] | null = null;

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function getUniqueCountries(): string[] {
  if (!data || !data.cities) return [];
  const countries = Array.from(new Set(data.cities.map((c) => c.country)));
  return countries.sort();
}

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

function getCityRank(cityId: string) {
  if (!cachedRankings) return null;
  const index = cachedRankings.findIndex((r) => r.id === cityId);
  if (index === -1) return null;
  return { rank: index + 1, total: cachedRankings.length };
}

function formatRank(rank: number, total: number, score: number | null = null, confidence: number | null = null, rawScore: number | null = null): string {
  const isTopTier = rank <= Math.ceil(total * 0.1);
  const baseClass = isTopTier ? 'rank-display top-tier' : 'rank-display';
  let tooltipText = '';
  if (score !== null) {
    tooltipText = `Score: €${score.toFixed(2)}`;
    if (rawScore !== null && confidence !== null) {
      tooltipText += ` (€${rawScore.toFixed(2)} × ${(confidence * 100).toFixed(0)}% confidence)`;
    }
  }
  const className = score !== null ? `${baseClass} tooltip` : baseClass;
  const tooltipAttrs = tooltipText ? ` tabindex="0" data-tooltip="${tooltipText}"` : '';
  return `<span class="${className}"${tooltipAttrs}><span class="rank">#${rank}</span> of ${total}</span>`;
}

function normalize(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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

// DOM elements
const rankingsView = document.getElementById('rankings-view')!;
const rankingsContent = document.getElementById('rankings-content')!;
const cityView = document.getElementById('city-view')!;
const cityContent = document.getElementById('city-content')!;
const backLink = document.getElementById('back-link')!;
const filterToggle = document.getElementById('filter-toggle')!;
const citySearch = document.getElementById('city-search') as HTMLInputElement;
const settingsToggle = document.getElementById('settings-toggle')!;
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

  if (filterMode === 'owned' && displayRankings.length === 0) {
    rankingsContent.innerHTML = `
      <div class="empty-garages">
        <p>No garages marked yet.</p>
        <p class="hint">Click any city row, then click the star to mark it as your garage.</p>
      </div>
    `;
    return;
  }

  const savesInfo = data?.observations?.meta
    ? `${data.observations.meta.saves_parsed} save(s), ${data.observations.meta.total_jobs} jobs observed`
    : 'theoretical data';

  rankingsContent.innerHTML = `
    <div class="table-section">
      <h2>City Rankings (${displayRankings.length} cities)</h2>
      <p class="table-hint">Based on ${savesInfo}. Click any city for details.</p>
      <table class="table-rankings">
        <thead>
          <tr>
            <th>#</th>
            <th>City</th>
            <th>Country</th>
            <th class="tooltip" data-tooltip="Company facilities in this city">Depots</th>
            <th class="tooltip" data-tooltip="Observed jobs from save game parsing">Jobs</th>
            <th class="tooltip" tabindex="0" data-tooltip="E[income/cycle] × confidence. Raw score adjusted for sample size.">Score</th>
            <th class="tooltip" tabindex="0" data-tooltip="n/(n+20) — how much we trust the estimate. More saves = higher confidence.">Conf.</th>
            <th class="tooltip" data-tooltip="Optimal trailer allocation">Best Trailers</th>
          </tr>
        </thead>
        <tbody>
          ${displayRankings.map((r, i) => {
            const trailerSummary = summarizeTrailers(r.optimalTrailers);
            const confPct = (r.confidence * 100).toFixed(0);
            const confClass = r.confidence >= 0.5 ? 'high' : r.confidence >= 0.25 ? 'med' : 'low';
            return `
            <tr class="clickable${ownedSet.has(r.id) ? ' owned-garage' : ''}" data-city-id="${r.id}" tabindex="0">
              <td>${i + 1}</td>
              <td>${r.name}</td>
              <td class="country">${r.country}</td>
              <td>${r.depotCount}</td>
              <td class="amount">${r.observedJobs || '-'}</td>
              <td class="score tooltip" data-tooltip="€${r.rawScore.toFixed(2)} raw × ${confPct}% conf">€${r.score.toFixed(2)}</td>
              <td class="confidence-${confClass}">${confPct}%</td>
              <td class="trailer-summary">${trailerSummary}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

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

function summarizeTrailers(trailers: string[]): string {
  const counts = new Map<string, number>();
  for (const t of trailers) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([bt, n]) => {
      const short = bt.replace(/_/g, ' ');
      return n > 1 ? `${short} ×${n}` : short;
    })
    .join(', ');
}

function ensureRankingsCached() {
  if (cachedRankings === null && data && lookups) {
    cachedRankings = calculateCityRankings(data, lookups);
  }
}

function renderCity(cityId: string) {
  ensureRankingsCached();

  const city = lookups!.citiesById.get(cityId);
  const isOwned = isOwnedGarage(cityId);

  if (!city) {
    cityContent.innerHTML = '<div class="empty-state">City not found.</div>';
    return;
  }

  const stats = getCityBodyTypeStats(cityId, data!, lookups!);
  if (stats.length === 0) {
    cityContent.innerHTML = `
      <div class="city-header">
        <h2>${city.name}</h2>
        <button class="garage-toggle" aria-label="Toggle garage" aria-pressed="${isOwned}">
          <span class="star">${isOwned ? '★' : '☆'}</span>
        </button>
        <span class="country">${city.country}</span>
      </div>
      <div class="empty-state">No cargo data for this city yet.</div>
    `;
    addGarageToggleHandler(cityId);
    return;
  }

  const optimal = greedyAllocation(stats, TRAILER_SLOTS, DRIVER_COUNT);
  const income = expectedIncome(stats, optimal, DRIVER_COUNT);
  const cityRank = getCityRank(cityId);
  const observedJobs = data?.observations?.city_job_count?.[cityId] ?? 0;
  const confidence = observedJobs / (observedJobs + 20);

  const cityCompanies = lookups!.cityCompanyMap.get(cityId) || [];
  let depotCount = 0;
  for (const { count } of cityCompanies) depotCount += count;

  const confidencePct = (confidence * 100).toFixed(0);
  const confidenceClass = confidence >= 0.5 ? 'high' : confidence >= 0.25 ? 'med' : 'low';

  cityContent.innerHTML = `
    <div class="city-header">
      <h2>${city.name}</h2>
      <button class="garage-toggle" aria-label="Toggle garage" aria-pressed="${isOwned}">
        <span class="star">${isOwned ? '★' : '☆'}</span>
      </button>
      <span class="country">${city.country}</span>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${depotCount}</div>
        <div class="stat-label">Depots</div>
      </div>
      <div class="stat">
        <div class="stat-value">${observedJobs}</div>
        <div class="stat-label">Observed Jobs</div>
      </div>
      <div class="stat">
        <div class="stat-value">€${income.totalIncome.toFixed(2)}</div>
        <div class="stat-label">E[income/cycle]</div>
      </div>
      <div class="stat">
        <div class="stat-value">${income.totalServed.toFixed(1)}/${DRIVER_COUNT}</div>
        <div class="stat-label">E[drivers served]</div>
      </div>
      <div class="stat">
        <div class="stat-value confidence-${confidenceClass}" title="${observedJobs} jobs / (${observedJobs} + 20)">${confidencePct}%</div>
        <div class="stat-label">Confidence</div>
      </div>
      <div class="stat">
        <div class="stat-value">${cityRank ? formatRank(cityRank.rank, cityRank.total) : '-'}</div>
        <div class="stat-label">Rank</div>
      </div>
    </div>

    <div class="table-section">
      <h2>Optimal Trailer Set (${TRAILER_SLOTS} slots, ${DRIVER_COUNT} drivers)</h2>
      <table>
        <thead>
          <tr>
            <th>Body Type</th>
            <th class="tooltip" data-tooltip="How many of this type to buy">Copies</th>
            <th class="tooltip" data-tooltip="Fraction of jobs needing this type">P(match)</th>
            <th class="tooltip" data-tooltip="Average cargo value when matched">Avg Value</th>
            <th class="tooltip" data-tooltip="Expected drivers served per cycle">E[served]</th>
            <th class="tooltip" data-tooltip="Expected income contribution per cycle">E[income]</th>
          </tr>
        </thead>
        <tbody>
          ${income.details.map((d) => {
            const stat = stats.find((s) => s.bodyType === d.bodyType);
            return `
            <tr>
              <td>${stat?.displayName ?? d.bodyType}</td>
              <td class="amount">${d.copies}</td>
              <td>${((stat?.probability ?? 0) * 100).toFixed(1)}%</td>
              <td class="value">€${(stat?.avgValue ?? 0).toFixed(2)}</td>
              <td>${d.served.toFixed(2)}</td>
              <td class="value">€${d.income.toFixed(2)}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="table-section">
      <h2>All Body Types in ${city.name}</h2>
      <table>
        <thead>
          <tr>
            <th>Body Type</th>
            <th>Jobs</th>
            <th>P(match)</th>
            <th>Avg Value</th>
            <th class="tooltip" data-tooltip="EV per roll = P(match) × Avg Value">EV/roll</th>
          </tr>
        </thead>
        <tbody>
          ${stats.map((s) => `
            <tr>
              <td>${s.displayName}</td>
              <td class="amount">${s.pool}</td>
              <td>${(s.probability * 100).toFixed(1)}%</td>
              <td class="value">€${s.avgValue.toFixed(2)}</td>
              <td class="value">€${(s.probability * s.avgValue).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  addGarageToggleHandler(cityId);
}

function addGarageToggleHandler(cityId: string) {
  const toggleBtn = cityContent.querySelector('.garage-toggle');
  if (toggleBtn) {
    const toggle = () => {
      const newState = toggleOwnedGarage(cityId);
      toggleBtn.setAttribute('aria-pressed', newState.toString());
      toggleBtn.querySelector('.star')!.textContent = newState ? '★' : '☆';
      updateGarageCount();
    };
    toggleBtn.addEventListener('click', toggle);
    toggleBtn.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  }
}

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

async function init() {
  showLoading();

  try {
    data = await loadAllData();
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

    // Settings toggle
    if (settingsToggle) {
      settingsToggle.addEventListener('click', () => {
        const controls = settingsToggle.closest('.controls')!;
        const isCollapsed = controls.classList.contains('collapsed');
        if (isCollapsed) {
          controls.classList.remove('collapsed');
          settingsToggle.setAttribute('aria-expanded', 'true');
          settingsToggle.querySelector('.toggle-icon')!.textContent = '▼';
        } else {
          controls.classList.add('collapsed');
          settingsToggle.setAttribute('aria-expanded', 'false');
          settingsToggle.querySelector('.toggle-icon')!.textContent = '▶';
        }
      });
    }

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
