/**
 * DLC management page — toggle DLC ownership and see marginal value analysis.
 * No page reload on toggle; changes apply immediately to stored state
 * and update the value calculations live.
 */

import { loadAllData, type AllData } from './data';
import { initThemeToggle, initGameSelector } from './page-init';
import {
  TRAILER_DLCS, ALL_DLC_IDS,
  CARGO_DLCS, ALL_CARGO_DLC_IDS,
  MAP_DLCS, ALL_MAP_DLC_IDS,
  GARAGE_CITIES, CITY_DLC_MAP, COMBINED_CARGO_DLC_MAP,
  getOwnedTrailerDLCs, setOwnedTrailerDLCs, toggleTrailerDLC,
  getOwnedCargoDLCs, setOwnedCargoDLCs, toggleCargoDLC,
  getOwnedMapDLCs, setOwnedMapDLCs, toggleMapDLC,
  getOwnedGarages,
} from './storage';
import { computeDLCValuesAsync } from './optimizer-client';
import type { DLCMarginalValue } from './dlc-value';

const settingsEl = document.getElementById('dlc-settings') as HTMLElement;
const valueSection = document.getElementById('dlc-value-section') as HTMLElement;
const calcBtn = document.getElementById('calc-value-btn') as HTMLButtonElement;
const progressEl = document.getElementById('dlc-value-progress') as HTMLElement;
const resultsEl = document.getElementById('dlc-value-results') as HTMLElement;

let rawData: AllData | null = null;
let lastResults: DLCMarginalValue[] | null = null;

function sortedEntries(dict: Record<string, string>): [string, string][] {
  return Object.entries(dict).sort((a, b) => a[1].localeCompare(b[1]));
}

function renderSettings(): void {
  const ownedMap = getOwnedMapDLCs();
  const ownedTrailer = getOwnedTrailerDLCs();
  const ownedCargo = getOwnedCargoDLCs();

  const mapRows = sortedEntries(MAP_DLCS).map(([id, name]) => {
    const isBase = id === 'base_game';
    const checked = isBase || ownedMap.includes(id) ? 'checked' : '';
    const disabled = isBase ? 'disabled' : '';
    return `<label class="dlc-row"><input type="checkbox" data-map-dlc="${id}" ${checked} ${disabled}> ${name}</label>`;
  }).join('');

  // Group trailer DLC entries by display name (e.g. lodeking+prestige → one row)
  const trailerGroups = new Map<string, string[]>();
  for (const [id, name] of sortedEntries(TRAILER_DLCS)) {
    if (!trailerGroups.has(name)) trailerGroups.set(name, []);
    trailerGroups.get(name)!.push(id);
  }
  const trailerRows = [...trailerGroups.entries()].map(([name, ids]) => {
    const allOwned = ids.every(id => ownedTrailer.includes(id));
    const checked = allOwned ? 'checked' : '';
    return `<label class="dlc-row"><input type="checkbox" data-trailer-dlc="${ids.join(',')}" ${checked}> ${name}</label>`;
  }).join('');

  const cargoRows = sortedEntries(CARGO_DLCS).map(([id, name]) => {
    const checked = ownedCargo.includes(id) ? 'checked' : '';
    return `<label class="dlc-row"><input type="checkbox" data-cargo-dlc="${id}" ${checked}> ${name}</label>`;
  }).join('');

  const totalMap = ALL_MAP_DLC_IDS.length;
  const totalTrailer = ALL_DLC_IDS.length;
  const totalCargo = ALL_CARGO_DLC_IDS.length;

  settingsEl.innerHTML = `
    <div class="dlc-page-columns">
      <div class="dlc-page-column">
        <div class="dlc-page-header">
          <span>Map Expansions <span class="dlc-count">${ownedMap.length}/${totalMap}</span></span>
          <span class="dlc-actions">
            <button class="dlc-map-all">All</button>
            <button class="dlc-map-none">None</button>
          </span>
        </div>
        ${mapRows}
      </div>
      <div class="dlc-page-column">
        <div class="dlc-page-header">
          <span>Trailer DLCs <span class="dlc-count">${ownedTrailer.length}/${totalTrailer}</span></span>
          <span class="dlc-actions">
            <button class="dlc-trailer-all">All</button>
            <button class="dlc-trailer-none">None</button>
          </span>
        </div>
        ${trailerRows}
      </div>
      <div class="dlc-page-column">
        <div class="dlc-page-header">
          <span>Cargo DLCs <span class="dlc-count">${ownedCargo.length}/${totalCargo}</span></span>
          <span class="dlc-actions">
            <button class="dlc-cargo-all">All</button>
            <button class="dlc-cargo-none">None</button>
          </span>
        </div>
        ${cargoRows}
      </div>
    </div>
  `;

  wireCheckboxes();
}

function wireCheckboxes(): void {
  settingsEl.querySelectorAll<HTMLInputElement>('input[data-map-dlc]').forEach(cb => {
    cb.addEventListener('change', () => {
      toggleMapDLC(cb.dataset.mapDlc!);
      renderSettings();
      invalidateResults();
    });
  });
  settingsEl.querySelectorAll<HTMLInputElement>('input[data-trailer-dlc]').forEach(cb => {
    cb.addEventListener('change', () => {
      // Support comma-separated IDs for grouped DLC brands (e.g. lodeking,prestige)
      const ids = cb.dataset.trailerDlc!.split(',');
      for (const id of ids) toggleTrailerDLC(id);
      renderSettings();
      invalidateResults();
    });
  });
  settingsEl.querySelectorAll<HTMLInputElement>('input[data-cargo-dlc]').forEach(cb => {
    cb.addEventListener('change', () => {
      toggleCargoDLC(cb.dataset.cargoDlc!);
      renderSettings();
      invalidateResults();
    });
  });

  settingsEl.querySelector('.dlc-map-all')?.addEventListener('click', () => {
    setOwnedMapDLCs([...ALL_MAP_DLC_IDS]);
    renderSettings();
    invalidateResults();
  });
  settingsEl.querySelector('.dlc-map-none')?.addEventListener('click', () => {
    setOwnedMapDLCs([]);
    renderSettings();
    invalidateResults();
  });
  settingsEl.querySelector('.dlc-trailer-all')?.addEventListener('click', () => {
    setOwnedTrailerDLCs([...ALL_DLC_IDS]);
    renderSettings();
    invalidateResults();
  });
  settingsEl.querySelector('.dlc-trailer-none')?.addEventListener('click', () => {
    setOwnedTrailerDLCs([]);
    renderSettings();
    invalidateResults();
  });
  settingsEl.querySelector('.dlc-cargo-all')?.addEventListener('click', () => {
    setOwnedCargoDLCs([...ALL_CARGO_DLC_IDS]);
    renderSettings();
    invalidateResults();
  });
  settingsEl.querySelector('.dlc-cargo-none')?.addEventListener('click', () => {
    setOwnedCargoDLCs([]);
    renderSettings();
    invalidateResults();
  });
}

function invalidateResults(): void {
  lastResults = null;
  resultsEl.innerHTML = '';
  progressEl.style.display = 'none';
}

function formatEV(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toString();
}

function renderResults(results: DLCMarginalValue[]): void {
  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="empty-state">All DLCs are owned — nothing to compare.</div>';
    return;
  }

  const garages = getOwnedGarages().filter(g => GARAGE_CITIES.has(g));
  if (garages.length === 0) {
    resultsEl.innerHTML = '<div class="empty-state">Mark some garages on the <a href="index.html" class="link">Rankings</a> page first to see DLC value.</div>';
    return;
  }

  const rows = results.map(r => {
    const deltaClass = r.totalDelta > 0 ? 'positive' : r.totalDelta < 0 ? 'negative' : '';
    const typeLabel = r.dlcType === 'map' ? 'Map' : r.dlcType === 'trailer' ? 'Trailer' : 'Cargo';

    let detail = '';
    if (r.dlcType === 'map') {
      const parts: string[] = [];
      if (r.existingGarageDelta !== 0) {
        parts.push(`Shadow cargo: <span class="${r.existingGarageDelta > 0 ? 'positive' : ''}">${r.existingGarageDelta > 0 ? '+' : ''}${formatEV(r.existingGarageDelta)}</span>`);
      }
      if (r.newGarageCities.length > 0) {
        const cityList = r.newGarageCities.slice(0, 3).map(c => `${c.name} (${formatEV(c.score)})`).join(', ');
        const more = r.newGarageCities.length > 3 ? ` +${r.newGarageCities.length - 3} more` : '';
        parts.push(`${r.newGarageCities.length} new garages: ${cityList}${more}`);
      }
      detail = parts.length ? `<div class="dlc-value-detail">${parts.join(' · ')}</div>` : '';
    }

    return `
      <div class="dlc-value-row">
        <div class="dlc-value-info">
          <span class="dlc-value-name">${r.dlcName}</span>
          <span class="dlc-value-type">${typeLabel}</span>
        </div>
        <div class="dlc-value-delta ${deltaClass}">
          ${r.totalDelta > 0 ? '+' : ''}${formatEV(r.totalDelta)} EV
        </div>
        ${detail}
      </div>
    `;
  }).join('');

  resultsEl.innerHTML = `
    <div class="dlc-value-list">
      <div class="dlc-value-summary">
        Based on ${garages.length} owned garage${garages.length !== 1 ? 's' : ''}.
        Map DLC values include potential new garages.
      </div>
      ${rows}
    </div>
  `;
}

async function runCalculation(): Promise<void> {
  if (!rawData) return;

  // Check prerequisites before heavy computation
  const garages = getOwnedGarages().filter(g => GARAGE_CITIES.has(g));
  if (garages.length === 0) {
    resultsEl.innerHTML = '<div class="empty-state">Mark some garages on the <a href="index.html" class="link">Rankings</a> page first to see DLC value.</div>';
    return;
  }

  calcBtn.disabled = true;
  calcBtn.textContent = 'Calculating...';
  progressEl.style.display = 'block';
  resultsEl.innerHTML = '';

  try {
    const dlcConfig = {
      ownedTrailer: getOwnedTrailerDLCs(),
      ownedCargo: getOwnedCargoDLCs(),
      ownedMap: getOwnedMapDLCs(),
      ownedGarages: getOwnedGarages(),
      allTrailerDLCIds: [...ALL_DLC_IDS],
      allCargoDLCIds: [...ALL_CARGO_DLC_IDS],
      allMapDLCIds: [...ALL_MAP_DLC_IDS],
      cityDlcMap: CITY_DLC_MAP,
      combinedCargoDlcMap: COMBINED_CARGO_DLC_MAP,
      garageCities: [...GARAGE_CITIES],
    };
    const dlcNameMap: Record<string, string> = {
      ...MAP_DLCS,
      ...TRAILER_DLCS,
      ...CARGO_DLCS,
    };
    const results = await computeDLCValuesAsync(rawData, dlcConfig, dlcNameMap, (done, total) => {
      progressEl.textContent = `Evaluating ${done} / ${total} DLCs...`;
    });

    lastResults = results;
    progressEl.style.display = 'none';
    renderResults(results);
  } catch (err) {
    console.error('DLC value calculation failed:', err);
    progressEl.style.display = 'none';
    resultsEl.innerHTML = '<div class="empty-state">Calculation failed. Check console for details.</div>';
  } finally {
    calcBtn.disabled = false;
    calcBtn.textContent = 'Calculate Marginal Value';
  }
}

async function init(): Promise<void> {
  initThemeToggle();
  initGameSelector();
  try {
    rawData = await loadAllData();
    renderSettings();
    valueSection.style.display = '';

    calcBtn.addEventListener('click', runCalculation);
  } catch (err) {
    console.error('Failed to initialize DLC page:', err);
    settingsEl.innerHTML = '<div class="empty-state">Failed to load data.</div>';
  }
}

init();
