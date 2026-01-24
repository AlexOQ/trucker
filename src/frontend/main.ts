import { loadAllData, buildLookups } from './data.js';
import { optimizeTrailerSet, calculateCityRankings } from './optimizer.js';
import {
  getSettings,
  updateSettings,
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

let data: AllData | null = null;
let lookups: Lookups | null = null;
let currentCityId: number | null = null;
let cachedRankings: any[] | null = null;

// Extract unique countries from data, sorted alphabetically
function getUniqueCountries(): string[] {
  if (!data || !data.cities) return [];
  const countries = Array.from(new Set(data.cities.map((c) => c.country)));
  return countries.sort();
}

// Toggle dropdown visibility
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
    // Focus first checkbox when opening
    const firstCheckbox = dropdown.querySelector('input[type="checkbox"]');
    if (firstCheckbox) {
      (firstCheckbox as HTMLElement).focus();
    }
  }
}

// Close dropdown
function closeDropdown() {
  const dropdown = document.getElementById('country-dropdown')!;
  const btn = document.getElementById('country-filter-btn')!;
  dropdown.style.display = 'none';
  btn.setAttribute('aria-expanded', 'false');
}

// Update button text based on selection
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

// Render country checkboxes in dropdown
function renderCountryCheckboxes() {
  const countries = getUniqueCountries();
  const countryOptions = document.getElementById('country-options')!;
  const selected = getSelectedCountries();

  countryOptions.innerHTML = `
    <label class="country-option all-countries" role="option">
      <input
        type="checkbox"
        id="all-countries-checkbox"
        aria-checked="${selected.length === 0 ? 'true' : 'false'}"
        ${selected.length === 0 ? 'checked' : ''}>
      <span>All Countries</span>
    </label>
    ${countries
      .map(
        (country) => `
      <label class="country-option" role="option">
        <input
          type="checkbox"
          value="${country}"
          aria-checked="${selected.includes(country) ? 'true' : 'false'}"
          aria-label="${country}"
          ${selected.includes(country) ? 'checked' : ''}>
        <span>${country}</span>
      </label>
    `
      )
      .join('')}
  `;

  // Add handler for "All Countries" checkbox
  const allCountriesCheckbox = document.getElementById('all-countries-checkbox')!;
  allCountriesCheckbox.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) {
      (e.target as HTMLElement).setAttribute('aria-checked', 'true');
      setSelectedCountries([]);
      renderCountryCheckboxes();
      updateCountryButtonText();
      renderRankings();
    }
  });

  // Add change handlers to country checkboxes
  countryOptions.querySelectorAll('input[type="checkbox"]:not(#all-countries-checkbox)').forEach((checkbox) => {
    checkbox.addEventListener('change', (e) => {
      const country = (e.target as HTMLInputElement).value;
      const selected = getSelectedCountries();

      if ((e.target as HTMLInputElement).checked) {
        (e.target as HTMLElement).setAttribute('aria-checked', 'true');
        if (!selected.includes(country)) {
          setSelectedCountries([...selected, country]);
        }
      } else {
        (e.target as HTMLElement).setAttribute('aria-checked', 'false');
        setSelectedCountries(selected.filter((c) => c !== country));
      }

      // Re-render checkboxes to update "All Countries" state
      renderCountryCheckboxes();
      // Update button text to show count
      updateCountryButtonText();
      // Re-render rankings with new filter
      renderRankings();
    });
  });
}

// Get city rank from cached rankings
function getCityRank(cityId: number) {
  if (!cachedRankings) return null;
  const index = cachedRankings.findIndex((r) => r.id === cityId);
  if (index === -1) return null;
  return { rank: index + 1, total: cachedRankings.length };
}

// Format rank for display (optional score for tooltip)
function formatRank(rank: number, total: number, score: number | null = null): string {
  const isTopTier = rank <= Math.ceil(total * 0.1); // Top 10%
  const baseClass = isTopTier ? 'rank-display top-tier' : 'rank-display';
  const className = score !== null ? `${baseClass} tooltip` : baseClass;
  const tooltipAttrs = score !== null ? ` tabindex="0" data-tooltip="Score: ${score.toFixed(0)}"` : '';
  return `<span class="${className}"${tooltipAttrs}><span class="rank">#${rank}</span> of ${total}</span>`;
}

// Update garage count badge
function updateGarageCount() {
  const count = getOwnedGarages().length;
  document.getElementById('garage-count')!.textContent = count.toString();
}

// DOM elements
const rankingsView = document.getElementById('rankings-view')!;
const rankingsContent = document.getElementById('rankings-content')!;
const cityView = document.getElementById('city-view')!;
const cityContent = document.getElementById('city-content')!;
const backLink = document.getElementById('back-link')!;

const scoringSlider = document.getElementById('scoring-slider') as HTMLInputElement;
const trailersSlider = document.getElementById('trailers-slider') as HTMLInputElement;
const diminishingSlider = document.getElementById('diminishing-slider') as HTMLInputElement;
const scoringValue = document.getElementById('scoring-value')!;
const trailersValue = document.getElementById('trailers-value')!;
const diminishingValue = document.getElementById('diminishing-value')!;
const resetBtn = document.getElementById('reset-btn')!;
const filterToggle = document.getElementById('filter-toggle')!;
const citySearch = document.getElementById('city-search') as HTMLInputElement;
const settingsToggle = document.getElementById('settings-toggle')!;
const controlsGrid = document.getElementById('controls-grid')!;

// Normalize text for accent-insensitive search
function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Filter toggle click handler
filterToggle.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.filter-btn');
  if (!btn) return;

  const mode = btn.getAttribute('data-filter')!;
  filterToggle.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  setFilterMode(mode);
  renderRankings();
});

// Get current options from sliders
function getOptions() {
  return {
    scoringBalance: parseInt(scoringSlider.value),
    maxTrailers: parseInt(trailersSlider.value),
    diminishingFactor: parseInt(diminishingSlider.value),
  };
}

// Update slider display values
function updateDisplayValues() {
  scoringValue.textContent = scoringSlider.value;
  trailersValue.textContent = trailersSlider.value;
  diminishingValue.textContent = diminishingSlider.value;
}

// Load settings from localStorage
function loadSettings() {
  const settings = getSettings();
  scoringSlider.value = settings.scoringBalance.toString();
  trailersSlider.value = settings.maxTrailers.toString();
  diminishingSlider.value = settings.diminishingFactor.toString();
  updateDisplayValues();
}

// Save settings to localStorage
function saveSettings() {
  updateSettings(getOptions());
}

// Render city rankings table
function renderRankings() {
  const options = getOptions();
  const rankings = calculateCityRankings(data!, lookups!, options);
  cachedRankings = rankings; // Cache for city detail lookup

  if (rankings.length === 0) {
    cachedRankings = null;
    rankingsContent.innerHTML = '<div class="empty-state">No cities with data yet.</div>';
    return;
  }

  // Filter by search term
  const searchTerm = normalize(citySearch.value);
  let filtered = rankings.filter(
    (r) => normalize(r.name).includes(searchTerm) || normalize(r.country).includes(searchTerm)
  );

  // Filter by selected countries
  const selectedCountries = getSelectedCountries();
  if (selectedCountries.length > 0) {
    filtered = filtered.filter((r) => selectedCountries.includes(r.country));
  }

  // Get filter mode and owned garages
  const filterMode = getFilterMode();
  const ownedSet = new Set(getOwnedGarages());

  // Filter by owned garages if mode is 'owned'
  const displayRankings = filterMode === 'owned' ? filtered.filter((r) => ownedSet.has(r.id)) : filtered;

  // Handle empty state when filtered but no garages
  if (filterMode === 'owned' && displayRankings.length === 0) {
    rankingsContent.innerHTML = `
      <div class="empty-garages">
        <p>No garages marked yet.</p>
        <p class="hint">Click any city row, then click the star to mark it as your garage.</p>
      </div>
    `;
    return;
  }

  rankingsContent.innerHTML = `
    <div class="table-section">
      <h2>City Rankings (${displayRankings.length} cities)</h2>
      <p class="table-hint">Click any city for trailer recommendations</p>
      <table class="table-rankings">
        <thead>
          <tr>
            <th>#</th>
            <th>City</th>
            <th>Country</th>
            <th class="tooltip" data-tooltip="Company facilities in this city">Depots</th>
            <th class="tooltip" data-tooltip="Total available cargo jobs">Jobs</th>
            <th class="tooltip" data-tooltip="Sum of all cargo values (with bonuses)">Value</th>
            <th class="tooltip" data-tooltip="Average value per cargo job">€/Job</th>
            <th class="tooltip" tabindex="0" data-tooltip="Ranks cities by combining job availability and cargo value. Higher score = more profitable garage location.">Score</th>
          </tr>
        </thead>
        <tbody>
          ${displayRankings
            .map(
              (r, i) => `
            <tr class="clickable${ownedSet.has(r.id) ? ' owned-garage' : ''}" data-city-id="${r.id}" tabindex="0">
              <td>${i + 1}</td>
              <td>${r.name}</td>
              <td class="country">${r.country}</td>
              <td>${r.depotCount}</td>
              <td class="amount">${r.jobs}</td>
              <td class="value">€${r.totalValue.toLocaleString()}</td>
              <td>€${r.avgValuePerJob.toFixed(2)}</td>
              <td class="score">${formatRank(i + 1, displayRankings.length, r.score)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  // Add click and keyboard handlers
  rankingsContent.querySelectorAll('tr.clickable').forEach((row) => {
    row.addEventListener('click', () => {
      showCity(parseInt((row as HTMLElement).dataset.cityId!));
    });
    row.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        showCity(parseInt((row as HTMLElement).dataset.cityId!));
      }
    });
  });
}

// Render city detail view
function renderCity(cityId: number) {
  const options = getOptions();
  const result = optimizeTrailerSet(cityId, data!, lookups!, options);
  const city = lookups!.citiesById.get(cityId);
  const isOwned = isOwnedGarage(cityId);

  if (!city) {
    cityContent.innerHTML = '<div class="empty-state">City not found.</div>';
    return;
  }

  if (result.recommendations.length === 0) {
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

  const totalTrailers = result.recommendations.reduce((sum, r) => sum + r.count, 0);
  const trailerTypes = result.recommendations.length;
  const cityRank = getCityRank(cityId);

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
        <div class="stat-value">${result.totalDepots}</div>
        <div class="stat-label">Depots</div>
      </div>
      <div class="stat">
        <div class="stat-value">${result.totalCargoInstances}</div>
        <div class="stat-label">Jobs Available</div>
      </div>
      <div class="stat">
        <div class="stat-value">€${result.totalValue.toLocaleString()}</div>
        <div class="stat-label">Total Value</div>
      </div>
      <div class="stat">
        <div class="stat-value">${totalTrailers}</div>
        <div class="stat-label">Trailers (${trailerTypes} types)</div>
      </div>
      <div class="stat">
        <div class="stat-value">${cityRank ? formatRank(cityRank.rank, cityRank.total) : '-'}</div>
        <div class="stat-label">Rank</div>
      </div>
    </div>

    <div class="table-section">
      <div class="section-header">
        <h2>Recommended Trailers</h2>
        <button class="btn copy-btn" id="copy-trailers-btn">Copy to clipboard</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Trailer</th>
            <th class="tooltip" data-tooltip="How many of this trailer to buy">Copies</th>
            <th class="tooltip" tabindex="0" data-tooltip="This trailer can haul this percentage of the different cargo types available at depots in this city">Coverage</th>
            <th class="tooltip" data-tooltip="Average value per job for this trailer">€/Job/km</th>
            <th class="tooltip" tabindex="0" data-tooltip="Combines €/km value and job coverage based on your Scoring Balance setting. Higher = better trailer choice.">Score</th>
          </tr>
        </thead>
        <tbody>
          ${result.recommendations
            .map(
              (r) => `
            <tr>
              <td>
                <div class="trailer-name">${r.trailerName}</div>
                <div class="trailer-cargoes">Hauls: ${r.topCargoes.join(', ')}</div>
              </td>
              <td class="amount">${r.count}</td>
              <td class="coverage">${r.coveragePct}%</td>
              <td class="value">€${r.avgValue.toFixed(2)}</td>
              <td>${r.score.toFixed(3)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  // Add copy button handler
  const copyBtn = document.getElementById('copy-trailers-btn')!;
  copyBtn.addEventListener('click', () => {
    const trailerList = result.recommendations
      .map((r) => (r.count > 1 ? `${r.trailerName} ×${r.count}` : r.trailerName))
      .join(', ');
    const text = `${city.name} (${totalTrailers} trailers): ${trailerList}`;

    copyToClipboard(text, copyBtn);
  });

  // Add garage toggle handler
  addGarageToggleHandler(cityId);
}

// Add garage toggle click and keyboard handler
function addGarageToggleHandler(cityId: number) {
  const toggleBtn = cityContent.querySelector('.garage-toggle');
  if (toggleBtn) {
    const toggleGarage = () => {
      const newState = toggleOwnedGarage(cityId);
      toggleBtn.setAttribute('aria-pressed', newState.toString());
      toggleBtn.querySelector('.star')!.textContent = newState ? '★' : '☆';
      updateGarageCount();
    };
    toggleBtn.addEventListener('click', toggleGarage);
    toggleBtn.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        toggleGarage();
      }
    });
  }
}

// Copy text to clipboard with fallback
function copyToClipboard(text: string, button: HTMLElement) {
  const originalText = button.textContent!;

  const showSuccess = () => {
    button.textContent = 'Copied!';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
    }, 2000);
  };

  const showError = () => {
    button.textContent = 'Failed';
    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
  };

  // Try modern clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(showSuccess)
      .catch(() => {
        // Fallback for non-HTTPS or permission denied
        fallbackCopy(text) ? showSuccess() : showError();
      });
  } else {
    // Fallback for older browsers
    fallbackCopy(text) ? showSuccess() : showError();
  }
}

// Fallback copy using execCommand
function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    document.body.removeChild(textarea);
    return false;
  }
}

// Show city detail view
function showCity(cityId: number) {
  currentCityId = cityId;
  rankingsView.style.display = 'none';
  cityView.style.display = 'block';
  if (window.location.hash !== `#city-${cityId}`) {
    window.location.hash = `city-${cityId}`;
  }
  renderCity(cityId);
  window.scrollTo(0, 0);
}

// Show rankings view
function showRankings() {
  currentCityId = null;
  cityView.style.display = 'none';
  rankingsView.style.display = 'block';
  window.location.hash = '';
  renderRankings();
}

// Handle hash navigation (e.g., #city-19)
function handleHashNavigation(): boolean {
  const hash = window.location.hash;
  if (hash.startsWith('#city-')) {
    const cityId = parseInt(hash.replace('#city-', ''));
    if (cityId && lookups?.citiesById.has(cityId)) {
      showCity(cityId);
      return true;
    }
  }
  return false;
}

// Handle slider changes
function onSliderChange() {
  updateDisplayValues();
  saveSettings();
  if (currentCityId) {
    renderCity(currentCityId);
  } else {
    renderRankings();
  }
}

// Show loading state
function showLoading() {
  rankingsContent.innerHTML = `
    <div class="table-section">
      <h2>Loading city data...</h2>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
    </div>
  `;
}

// Show error state
function showError(errorMessage: string) {
  rankingsContent.innerHTML = `
    <div class="empty-state">
      <p>Failed to load data</p>
      <p style="color: #888; font-size: 0.9rem; margin-top: 0.5rem;">${errorMessage}</p>
    </div>
  `;
}

// Initialize
async function init() {
  // Show loading state immediately
  showLoading();

  try {
    data = await loadAllData();
    lookups = buildLookups(data);

    loadSettings();
    renderCountryCheckboxes();
    updateCountryButtonText();

    // Initialize filter toggle from storage
    const savedFilterMode = getFilterMode();
    filterToggle.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === savedFilterMode);
    });
    updateGarageCount();

    // Check for hash navigation, otherwise show rankings
    if (!handleHashNavigation()) {
      renderRankings();
    }

    // Event listeners
    scoringSlider.addEventListener('input', onSliderChange);
    trailersSlider.addEventListener('input', onSliderChange);
    diminishingSlider.addEventListener('input', onSliderChange);
    citySearch.addEventListener('input', renderRankings);

    backLink.addEventListener('click', showRankings);
    window.addEventListener('hashchange', () => {
      if (!handleHashNavigation()) {
        showRankings();
      }
    });

    resetBtn.addEventListener('click', () => {
      const defaults = resetToDefaults();
      scoringSlider.value = defaults.scoringBalance.toString();
      trailersSlider.value = defaults.maxTrailers.toString();
      diminishingSlider.value = defaults.diminishingFactor.toString();
      onSliderChange();
    });

    // Settings toggle handler
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

    // Country filter dropdown toggle
    const countryFilterBtn = document.getElementById('country-filter-btn')!;
    countryFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    // Keyboard handler for dropdown button
    countryFilterBtn.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        toggleDropdown();
      }
    });

    // Keyboard navigation for dropdown
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

        let nextIndex;
        if ((e as KeyboardEvent).key === 'ArrowDown') {
          nextIndex = currentIndex < checkboxes.length - 1 ? currentIndex + 1 : 0;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : checkboxes.length - 1;
        }

        (checkboxes[nextIndex] as HTMLElement).focus();
      } else if ((e as KeyboardEvent).key === ' ' && (document.activeElement as HTMLInputElement).type === 'checkbox') {
        // Space handled by checkbox default behavior
        e.preventDefault();
        (document.activeElement as HTMLElement).click();
      }
    });

    // Close dropdown on outside click
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
