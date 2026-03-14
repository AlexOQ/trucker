/**
 * Rankings table view for ETS2 Trucker Advisor
 *
 * Handles rendering of the city rankings table, search/filter,
 * score tiers, results count, and garage star toggles in the table.
 */

import { computeRankingsAsync } from './optimizer-client.js';
import type { CityRanking, FleetEntry } from './optimizer.js';
import {
  getOwnedGarages, toggleOwnedGarage,
  getFilterMode, setFilterMode,
  getSelectedCountries, setSelectedCountries,
  getSortColumn, getSortDirection, setSortPreference,
  type SortColumn, type SortDirection,
} from './storage.js';
import { normalize } from './data.js';
import { escapeHtml } from './utils.js';
import type { AllData, Lookups } from './data.js';

// ============================================
// Types
// ============================================

export interface ScoreTier {
  className: string;
  label: string;
}

export interface RankingsState {
  data: AllData | null;
  lookups: Lookups | null;
  cachedRankings: CityRanking[] | null;
  displayedRankings: CityRanking[] | null;
}

// ============================================
// Comparison selection state (session only)
// ============================================

const MAX_COMPARE = 5;
const comparisonSet = new Set<string>();

export function getComparisonCityIds(): string[] {
  return Array.from(comparisonSet);
}

export function clearComparison(): void {
  comparisonSet.clear();
}

function toggleComparison(cityId: string): boolean {
  if (comparisonSet.has(cityId)) {
    comparisonSet.delete(cityId);
    return false;
  }
  if (comparisonSet.size >= MAX_COMPARE) return false; // silently reject
  comparisonSet.add(cityId);
  return true;
}

function updateCompareBar() {
  let bar = document.getElementById('compare-bar');
  const count = comparisonSet.size;

  if (count < 2) {
    if (bar) bar.style.display = 'none';
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'compare-bar';
    bar.className = 'compare-bar';
    document.body.appendChild(bar);
  }

  bar.style.display = 'flex';
  bar.innerHTML = `
    <span>Compare ${count} cities</span>
    <button class="compare-bar-go" id="compare-bar-go" type="button">Compare</button>
    <button class="compare-bar-clear" id="compare-bar-clear" type="button">&times;</button>
  `;

  document.getElementById('compare-bar-go')!.addEventListener('click', () => {
    window.location.hash = 'compare';
  });

  document.getElementById('compare-bar-clear')!.addEventListener('click', () => {
    comparisonSet.clear();
    updateCompareBar();
    // Uncheck all checkboxes
    document.querySelectorAll('.compare-check').forEach(cb => {
      (cb as HTMLInputElement).checked = false;
    });
  });
}

// ============================================
// Utility functions
// ============================================

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}

function getUniqueCountries(data: AllData): string[] {
  if (!data || !data.cities) return [];
  const countries = Array.from(new Set(data.cities.map((c) => c.country)));
  return countries.sort();
}

// ============================================
// Score tier helpers
// ============================================

export function getScoreTier(index: number, total: number): ScoreTier {
  if (total === 0) return { className: '', label: '' };
  const percentile = (index / total) * 100;
  if (percentile < 10) return { className: 'score-tier-excellent', label: 'Excellent \u2014 top 10%' };
  if (percentile < 25) return { className: 'score-tier-good', label: 'Good \u2014 top 25%' };
  if (percentile < 50) return { className: 'score-tier-average', label: 'Average \u2014 top 50%' };
  return { className: 'score-tier-below', label: 'Below average \u2014 bottom 50%' };
}

// ============================================
// Rank helpers
// ============================================

export function getCityRank(cityId: string, displayedRankings: CityRanking[] | null): { rank: number; total: number } | null {
  if (!displayedRankings) return null;
  const index = displayedRankings.findIndex((r) => r.id === cityId);
  if (index === -1) return null;
  return { rank: index + 1, total: displayedRankings.length };
}

export function formatRank(rank: number, total: number): string {
  const isTopTier = rank <= Math.ceil(total * 0.1);
  const className = isTopTier ? 'rank-display top-tier' : 'rank-display';
  return `<span class="${className}"><span class="rank">#${rank}</span> of ${total}</span>`;
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

function renderCountryCheckboxes(data: AllData, renderRankings: () => void) {
  const countries = getUniqueCountries(data);
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
      renderCountryCheckboxes(data, renderRankings);
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
      renderCountryCheckboxes(data, renderRankings);
      updateCountryButtonText();
      renderRankings();
    });
  });
}

// ============================================
// Garage count badge
// ============================================

export function updateGarageCount(data: AllData, lookups: Lookups, citySearch: HTMLInputElement) {
  const ownedGarages = getOwnedGarages();
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
// Results count feedback
// ============================================

function updateResultsCount(resultsCount: HTMLElement, shown: number, total: number) {
  if (shown === total || total === 0) {
    resultsCount.textContent = '';
  } else {
    resultsCount.textContent = `Showing ${shown} of ${total} cities`;
  }
}

// ============================================
// Rankings rendering
// ============================================

function summarizeTrailers(fleet: FleetEntry[]): string {
  return fleet.map(e => e.displayName).join(', ');
}

// ============================================
// Sorting
// ============================================

const SORTABLE_COLUMNS: { col: SortColumn; label: string; tooltip?: string }[] = [
  { col: 'name', label: 'City' },
  { col: 'country', label: 'Country' },
  { col: 'depotCount', label: 'Depots', tooltip: 'Company facilities in this city' },
  { col: 'cargoTypes', label: 'Cargo', tooltip: 'Distinct cargo types available' },
  { col: 'score', label: 'Fleet EV', tooltip: 'Sum of top 5 body type EVs \u2014 fleet earning potential' },
];

function sortRankings(rankings: CityRanking[], col: SortColumn, dir: SortDirection): CityRanking[] {
  return [...rankings].sort((a, b) => {
    let cmp: number;
    if (col === 'name' || col === 'country') {
      cmp = a[col].localeCompare(b[col]);
    } else {
      cmp = a[col] - b[col];
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

function buildSortableHeader(col: SortColumn, activeSortCol: SortColumn, activeSortDir: SortDirection): string {
  const meta = SORTABLE_COLUMNS.find(c => c.col === col)!;
  const isActive = activeSortCol === col;
  const indicator = isActive ? (activeSortDir === 'asc' ? ' \u25b2' : ' \u25bc') : '';
  const tooltipClass = meta.tooltip ? ' tooltip' : '';
  const tooltipAttr = meta.tooltip ? ` data-tooltip="${meta.tooltip}"` : '';
  return `<th class="sortable${tooltipClass}${isActive ? ' sort-active' : ''}" tabindex="0" data-sort-col="${col}"${tooltipAttr}>${meta.label}${indicator}</th>`;
}

function attachSortHandlers(
  container: HTMLElement,
  state: RankingsState,
  rankingsContent: HTMLElement,
  citySearch: HTMLInputElement,
  resultsCount: HTMLElement,
  showCity: (cityId: string) => void,
): void {
  container.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = (th as HTMLElement).dataset.sortCol as SortColumn;
      const currentCol = getSortColumn();
      const currentDir = getSortDirection();
      let newDir: SortDirection;
      if (col === currentCol) {
        newDir = currentDir === 'asc' ? 'desc' : 'asc';
      } else {
        // Numeric columns default desc, alpha columns default asc
        newDir = (col === 'name' || col === 'country') ? 'asc' : 'desc';
      }
      setSortPreference(col, newDir);
      renderRankings(state, rankingsContent, citySearch, resultsCount, showCity);
    });
  });
}

export async function renderRankings(
  state: RankingsState,
  rankingsContent: HTMLElement,
  citySearch: HTMLInputElement,
  resultsCount: HTMLElement,
  showCity: (cityId: string) => void,
): Promise<void> {
  if (!state.data || !state.lookups) return;
  const rankings = state.cachedRankings ?? await computeRankingsAsync(state.data, state.lookups);
  state.cachedRankings = rankings;

  if (rankings.length === 0) {
    state.cachedRankings = null;
    rankingsContent.innerHTML = '<div class="empty-state">No cities with data yet.</div>';
    updateResultsCount(resultsCount, 0, 0);
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
  const filteredByMode = filterMode === 'owned' ? filtered.filter((r) => ownedSet.has(r.id)) : filtered;

  // Apply sort after filtering
  const sortCol = getSortColumn();
  const sortDir = getSortDirection();
  const displayRankings = sortRankings(filteredByMode, sortCol, sortDir);
  state.displayedRankings = displayRankings;

  if (filterMode === 'owned' && displayRankings.length === 0) {
    rankingsContent.innerHTML = `
      <div class="empty-garages">
        <p>No garages marked yet.</p>
        <p class="hint">Click any city row, then click the star to mark it as your garage.</p>
      </div>
    `;
    updateResultsCount(resultsCount, 0, rankings.length);
    return;
  }

  if (displayRankings.length === 0) {
    let message: string;
    if (searchTerm) {
      const escaped = escapeHtml(citySearch.value.trim());
      message = `No cities match '${escaped}'`;
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
              ${buildSortableHeader('name', sortCol, sortDir)}
              ${buildSortableHeader('country', sortCol, sortDir)}
              ${buildSortableHeader('depotCount', sortCol, sortDir)}
              ${buildSortableHeader('cargoTypes', sortCol, sortDir)}
              ${buildSortableHeader('score', sortCol, sortDir)}
              <th class="tooltip" tabindex="0" data-tooltip="Top earning trailer types for this city">Best Trailers</th>
              <th class="compare-col tooltip" tabindex="0" data-tooltip="Select cities to compare side by side">Cmp</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colspan="9" class="no-results" role="status">${message}</td></tr>
          </tbody>
        </table>
      </div>
    `;
    attachSortHandlers(rankingsContent, state, rankingsContent, citySearch, resultsCount, showCity);
    if (state.data && state.lookups) updateGarageCount(state.data, state.lookups, citySearch);
    updateResultsCount(resultsCount, 0, rankings.length);
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
            ${buildSortableHeader('name', sortCol, sortDir)}
            ${buildSortableHeader('country', sortCol, sortDir)}
            ${buildSortableHeader('depotCount', sortCol, sortDir)}
            ${buildSortableHeader('cargoTypes', sortCol, sortDir)}
            ${buildSortableHeader('score', sortCol, sortDir)}
            <th class="tooltip" tabindex="0" data-tooltip="Top earning trailer types for this city">Best Trailers</th>
            <th class="compare-col tooltip" tabindex="0" data-tooltip="Select cities to compare side by side">Cmp</th>
          </tr>
        </thead>
        <tbody>
          ${displayRankings.map((r, i) => {
            const trailerSummary = summarizeTrailers(r.topTrailers);
            const starred = ownedSet.has(r.id);
            const globalIndex = state.cachedRankings!.findIndex(cr => cr.id === r.id);
            const tier = getScoreTier(globalIndex >= 0 ? globalIndex : i, state.cachedRankings!.length);
            const checked = comparisonSet.has(r.id);
            return `
            <tr class="clickable${starred ? ' owned-garage' : ''}" data-city-id="${r.id}" tabindex="0">
              <td class="garage-star" data-city-id="${r.id}" title="${starred ? 'Remove garage for' : 'Mark as garage for'} ${r.name}" tabindex="0" role="button" aria-label="${starred ? 'Remove garage for' : 'Mark as garage for'} ${r.name}">${starred ? '\u2605' : '\u2606'}</td>
              <td>${i + 1}</td>
              <td>${r.name}</td>
              <td class="country">${r.country}</td>
              <td>${r.depotCount}</td>
              <td class="amount">${r.cargoTypes}</td>
              <td class="score ${tier.className}" title="${tier.label}">${formatNumber(r.score)}${tier.label ? `<span class="score-tier-label">${tier.label.split(' \u2014 ')[0]}</span>` : ''}</td>
              <td class="trailer-summary">${trailerSummary}</td>
              <td class="compare-col"><input type="checkbox" class="compare-check" data-city-id="${r.id}" ${checked ? 'checked' : ''} aria-label="Compare ${r.name}" title="Compare ${r.name}"></td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Star click/keyboard toggles garage without navigating to city
  rankingsContent.querySelectorAll('.garage-star').forEach((star) => {
    const toggleStar = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      const el = star as HTMLElement;
      const cityId = el.dataset.cityId!;
      const nowOwned = toggleOwnedGarage(cityId);
      el.textContent = nowOwned ? '\u2605' : '\u2606';
      const cityName = el.closest('tr')!.querySelector('td:nth-child(3)')!.textContent!;
      el.title = `${nowOwned ? 'Remove garage for' : 'Mark as garage for'} ${cityName}`;
      el.setAttribute('aria-label', `${nowOwned ? 'Remove garage for' : 'Mark as garage for'} ${cityName}`);
      const row = el.closest('tr')!;
      row.classList.toggle('owned-garage', nowOwned);
      if (state.data && state.lookups) updateGarageCount(state.data, state.lookups, citySearch);
    };
    star.addEventListener('click', toggleStar);
    star.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        toggleStar(e);
      }
    });
  });

  rankingsContent.querySelectorAll('tr.clickable').forEach((row) => {
    row.addEventListener('click', (e) => {
      // Don't navigate when clicking the compare checkbox
      if ((e.target as HTMLElement).classList.contains('compare-check')) return;
      showCity((row as HTMLElement).dataset.cityId!);
    });
    row.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        if ((e.target as HTMLElement).classList.contains('compare-check')) return;
        e.preventDefault();
        showCity((row as HTMLElement).dataset.cityId!);
      }
    });
  });

  // Comparison checkboxes
  rankingsContent.querySelectorAll('.compare-check').forEach((cb) => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    cb.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      const cityId = el.dataset.cityId!;
      const added = toggleComparison(cityId);
      // If we tried to add but the set was full, uncheck
      if (el.checked && !added && !comparisonSet.has(cityId)) {
        el.checked = false;
      }
      updateCompareBar();
    });
  });

  attachSortHandlers(rankingsContent, state, rankingsContent, citySearch, resultsCount, showCity);
  updateCompareBar();
  if (state.data && state.lookups) updateGarageCount(state.data, state.lookups, citySearch);
  updateResultsCount(resultsCount, displayRankings.length, rankings.length);
}

// ============================================
// Initialization
// ============================================

export function initRankingsView(
  state: RankingsState,
  rankingsContent: HTMLElement,
  citySearch: HTMLInputElement,
  resultsCount: HTMLElement,
  filterToggle: HTMLElement,
  showCity: (cityId: string) => void,
): void {
  const doRender = () => renderRankings(state, rankingsContent, citySearch, resultsCount, showCity);

  // Country checkboxes
  if (state.data) renderCountryCheckboxes(state.data, doRender);
  updateCountryButtonText();

  // Filter toggle (All / My Garages)
  filterToggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.filter-btn');
    if (!btn) return;
    const mode = btn.getAttribute('data-filter')!;
    filterToggle.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    setFilterMode(mode);
    doRender();
  });

  const savedFilterMode = getFilterMode();
  filterToggle.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === savedFilterMode);
  });
  if (state.data && state.lookups) updateGarageCount(state.data, state.lookups, citySearch);

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
}

// ============================================
// Loading / Error states
// ============================================

export function showLoading(rankingsContent: HTMLElement): void {
  rankingsContent.innerHTML = `
    <div class="table-section" role="status" aria-label="Loading city data">
      <h2>Loading city data...</h2>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div></div>
    </div>
  `;
}

export function showError(rankingsContent: HTMLElement, errorMessage: string): void {
  rankingsContent.innerHTML = `
    <div class="empty-state" role="alert" aria-live="assertive">
      <p>Failed to load data</p>
      <p class="error-detail">${escapeHtml(errorMessage)}</p>
    </div>
  `;
}
