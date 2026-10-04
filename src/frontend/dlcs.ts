/**
 * DLC management page — toggle DLC ownership and see marginal value analysis.
 * No page reload on toggle; changes apply immediately to stored state
 * and update the value calculations live.
 */

import { loadAllData, type AllData } from './data';
import { initGameSelector } from './page-init';
import { getActiveGame } from './game';
import {
  TRAILER_DLCS, ALL_DLC_IDS,
  CARGO_DLCS, ALL_CARGO_DLC_IDS,
  MAP_DLCS, ALL_MAP_DLC_IDS,
  GARAGE_CITIES, CITY_DLC_MAP, COMBINED_CARGO_DLC_MAP,
  getOwnedTrailerDLCs, setOwnedTrailerDLCs, toggleTrailerDLC,
  getOwnedCargoDLCs, setOwnedCargoDLCs, toggleCargoDLC,
  getOwnedMapDLCs, setOwnedMapDLCs, toggleMapDLC,
} from './storage';
import { computeDLCValuesAsync } from './optimizer-client';
import type { DLCMarginalValue } from './dlc-value';

const settingsEl = document.getElementById('dlc-settings') as HTMLElement;
const valueSection = document.getElementById('dlc-value-section') as HTMLElement;
const calcBtn = document.getElementById('calc-value-btn') as HTMLButtonElement;
const progressEl = document.getElementById('dlc-value-progress') as HTMLElement;
const resultsEl = document.getElementById('dlc-value-results') as HTMLElement;

let rawData: AllData | null = null;
/** DLCs in the smallest max-earnings set (best-dlc-set.json); null when the file is missing. */
let bestSet: Set<string> | null = null;
/** Measured Monte Carlo noise (EV): a value inside ±noiseFloor reads "≈ 0". 0 without the file. */
let noiseFloor = 0;

/**
 * The best DLC set and the noise floor depend only on the game data — every purchasable city is
 * scored, whatever the player owns — so they ship precomputed (scripts/gen-best-dlc-set.mts).
 */
async function loadBestSet(): Promise<{ best: Set<string>; floor: number } | null> {
  try {
    const response = await fetch(`data/${getActiveGame()}/best-dlc-set.json`);
    if (!response.ok) return null;
    const file = await response.json() as { best: string[]; noise_floor: number };
    return { best: new Set(file.best), floor: file.noise_floor };
  } catch {
    return null;
  }
}

/** Row class: highlighted when the DLC is in the max-earnings set. */
function rowClass(id: string): string {
  return bestSet?.has(id) ? 'dlc-row dlc-best' : 'dlc-row';
}

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
    return `<label class="${rowClass(id)}"><input type="checkbox" data-map-dlc="${id}" ${checked} ${disabled}> ${name}</label>`;
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
    const best = ids.some(id => bestSet?.has(id)) ? 'dlc-row dlc-best' : 'dlc-row';
    return `<label class="${best}"><input type="checkbox" data-trailer-dlc="${ids.join(',')}" ${checked}> ${name}</label>`;
  }).join('');

  const cargoRows = sortedEntries(CARGO_DLCS).map(([id, name]) => {
    const checked = ownedCargo.includes(id) ? 'checked' : '';
    return `<label class="${rowClass(id)}"><input type="checkbox" data-cargo-dlc="${id}" ${checked}> ${name}</label>`;
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
    ${bestSet ? `<p class="dlc-best-legend">
      <span class="dlc-best-swatch"></span> Highlighted: the smallest set of DLCs that reaches the highest
      max-fleet earnings (354-driver cap), whatever you own. The rest add nothing or cost earnings.
    </p>` : ''}
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
  resultsEl.innerHTML = '';
  progressEl.style.display = 'none';
}

function formatEV(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toString();
}

/** "Lisbon, Almería, Vigo +2 more". */
function cityList(cities: Array<{ name: string }>): string {
  const head = cities.slice(0, 3).map(c => c.name).join(', ');
  return cities.length > 3 ? `${head} +${cities.length - 3} more` : head;
}

function renderResults(results: DLCMarginalValue[]): void {
  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="empty-state">No DLCs to evaluate.</div>';
    return;
  }

  const rows = results.map(r => {
    const noise = Math.abs(r.totalDelta) < noiseFloor;
    const deltaClass = noise ? '' : r.totalDelta > 0 ? 'positive' : 'negative';
    const typeLabel = r.dlcType === 'map' ? 'Map' : r.dlcType === 'trailer' ? 'Trailer' : 'Cargo';
    const action = r.owned ? 'Disable' : 'Buy';
    const value = noise
      ? '≈ 0'
      : `${r.share > 0 ? '+' : ''}${(r.share * 100).toFixed(1)}%<span class="dlc-value-ev">${r.totalDelta > 0 ? '+' : ''}${formatEV(r.totalDelta)} EV</span>`;

    let detail = '';
    if (!noise) {
      const parts: string[] = [];
      if (r.enters.length > 0) parts.push(`Into your best 71: ${cityList(r.enters)}`);
      if (r.leaves.length > 0) parts.push(`Out of it: ${cityList(r.leaves)}`);
      if (parts.length > 0) detail = `<div class="dlc-value-detail">${parts.join(' · ')}</div>`;
      if (r.bodyTypeBreakdown && r.bodyTypeBreakdown.length > 0) {
        const lines = r.bodyTypeBreakdown.map(b => {
          const vs = b.runnerUpTrailerSpec ? `over <code>${b.runnerUpTrailerSpec}</code>` : '(no prior trailer)';
          const where = ` · ${b.countries} ${b.countries === 1 ? 'country' : 'countries'}`;
          return `<li><span class="dlc-bt-name">${b.displayName}</span> wins ${vs} by <span class="positive">+${formatEV(b.marginHV)} HV</span>${where}</li>`;
        }).join('');
        const n = r.bodyTypeBreakdown.length;
        // Structural breakdown: which body types this DLC wins and the haul-value
        // margin over the runner-up. Does not sum to the EV delta above (#257).
        detail += `<details class="dlc-value-detail dlc-breakdown"><summary>Wins ${n} body type${n !== 1 ? 's' : ''} — where the value comes from</summary><ul>${lines}</ul></details>`;
      }
    }

    return `
      <div class="dlc-value-row">
        <div class="dlc-value-info">
          <span class="dlc-value-name">${r.dlcName}</span>
          <span class="dlc-value-type">${typeLabel}</span>
          <span class="dlc-value-action ${r.owned ? 'disable' : 'buy'}">${action}</span>
        </div>
        <div class="dlc-value-delta ${deltaClass}">${value}</div>
        ${detail}
      </div>
    `;
  }).join('');

  resultsEl.innerHTML = `
    <div class="dlc-value-list">
      <div class="dlc-value-summary">
        Each row is one change on its own; both games let you turn owned DLCs off per profile. Scored
        as max-fleet earnings at the 354-driver cap: the best 71 garages over every purchasable city.
        ${noiseFloor > 0 ? `Changes within ±${noiseFloor} EV are noise and read ≈ 0.` : ''}
        The highlight above is the end state; the best next step from where you are can differ.
      </div>
      ${rows}
    </div>
  `;
}

async function runCalculation(): Promise<void> {
  if (!rawData) return;

  calcBtn.disabled = true;
  calcBtn.textContent = 'Calculating...';
  progressEl.style.display = 'block';
  resultsEl.innerHTML = '';

  try {
    const dlcConfig = {
      ownedTrailer: getOwnedTrailerDLCs(),
      ownedCargo: getOwnedCargoDLCs(),
      ownedMap: getOwnedMapDLCs(),
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
      progressEl.textContent = `Evaluating ${done} / ${total} scenarios...`;
    });

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
  initGameSelector();
  try {
    const [data, best] = await Promise.all([loadAllData(), loadBestSet()]);
    rawData = data;
    bestSet = best?.best ?? null;
    noiseFloor = best?.floor ?? 0;
    renderSettings();
    valueSection.style.display = '';

    calcBtn.addEventListener('click', () => void runCalculation());
  } catch (err) {
    console.error('Failed to initialize DLC page:', err);
    settingsEl.innerHTML = '<div class="empty-state">Failed to load data.</div>';
  }
}

init();
