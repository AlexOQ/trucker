/**
 * City detail view for ETS2 Trucker Advisor
 *
 * Handles rendering of the city detail panel: fleet recommendations,
 * export buttons (CSV/JSON), copy fleet, garage toggle in detail view.
 */

import { computeFleetAsync, computeRankingsAsync } from './optimizer-client.js';
import type { CityRanking, OptimalFleetEntry } from './optimizer.js';
import {
  getOwnedGarages, toggleOwnedGarage, isOwnedGarage,
  getFilterMode,
  getSelectedCountries,
  getSortColumn, getSortDirection,
} from './storage.js';
import { copyToClipboard } from './clipboard.js';
import { normalize } from './data.js';
import {
  formatNumber, getScoreTier, getCityRank, formatRank, updateGarageCount,
  applyRankingsFilters,
  type RankingsState, type ScoreTier,
} from './rankings-view.js';
import {
  isInComparison, toggleComparison, updateCompareBar, announceStatus,
  COMPARE_FULL_MESSAGE,
} from './comparison-state.js';

// ============================================
// Ensure rankings are cached
// ============================================

async function ensureRankingsCached(
  state: RankingsState,
  citySearch: HTMLInputElement,
): Promise<void> {
  if (state.cachedRankings === null && state.data && state.lookups) {
    state.cachedRankings = await computeRankingsAsync(state.data, state.lookups);
  }
  if (state.displayedRankings === null && state.cachedRankings) {
    // Apply current filters to build displayed rankings
    state.displayedRankings = applyRankingsFilters(
      state.cachedRankings,
      normalize(citySearch.value),
      getSelectedCountries(),
      getFilterMode(),
      getOwnedGarages(),
      getSortColumn(),
      getSortDirection(),
    );
  }
}

// ============================================
// Fleet row rendering
// ============================================

function renderFleetRow(entry: OptimalFleetEntry): string {
  const countLabel = entry.count > 1 ? ` \u00d7${entry.count}` : '';
  const trailerLink = `trailers.html#body-${entry.bodyType}`;
  const priceCell = entry.estimatedPrice > 0 ? formatNumber(entry.estimatedPrice) : '\u2014';
  const xpCell = entry.xpFloor > 0 ? String(entry.xpFloor) : '\u2014';
  return `
    <tr>
      <td>
        <div><a href="${trailerLink}" class="body-type-link">${entry.displayName}${countLabel}</a></div>
        <div class="trailer-spec">${entry.trailerSpec}</div>
      </td>
      <td class="amount">${formatNumber(entry.ev)}</td>
      <td class="amount">${entry.cargoMatched}</td>
      <td class="amount">${priceCell}</td>
      <td class="amount">${xpCell}</td>
    </tr>
  `;
}

// ============================================
// City detail rendering
// ============================================

export async function renderCity(
  cityId: string,
  state: RankingsState,
  cityContent: HTMLElement,
  rankingsContent: HTMLElement,
  citySearch: HTMLInputElement,
): Promise<void> {
  await ensureRankingsCached(state, citySearch);

  if (!state.lookups || !state.data) {
    cityContent.innerHTML = '<div class="empty-state">Data not yet loaded.</div>';
    return;
  }

  const city = state.lookups.citiesById.get(cityId);
  if (!city) {
    cityContent.innerHTML = '<div class="empty-state">City not found.</div>';
    return;
  }

  const optimal = await computeFleetAsync(cityId, state.data, state.lookups);
  if (!optimal) {
    const emptyOwned = isOwnedGarage(cityId);
    cityContent.innerHTML = `
      <div class="city-header">
        <div class="city-header-row">
          <div>
            <h2>${city.displayName}${city.displayName !== city.name ? ` <span class="native-name">(${city.name})</span>` : ''}</h2>
            <span class="country">${city.countryName}</span>
          </div>
          <div class="city-header-actions">
            <button class="btn btn-sm compare-toggle" id="city-compare-toggle"
              aria-pressed="${isInComparison(cityId)}"
              data-city-id="${cityId}">${isInComparison(cityId) ? '\u2713 In Compare' : '+ Compare'}</button>
            <button class="garage-toggle" id="city-garage-toggle"
              aria-pressed="${emptyOwned}" aria-label="${emptyOwned ? 'Remove garage' : 'Mark as garage'}"
              title="${emptyOwned ? 'Remove garage' : 'Mark as garage'}"
              data-city-id="${cityId}">${emptyOwned ? '\u2605' : '\u2606'}</button>
          </div>
        </div>
      </div>
      <div class="empty-state">No cargo data for this city yet.</div>
    `;
    wireGarageToggle(cityId, rankingsContent, state, citySearch);
    wireCompareToggle(cityId);
    return;
  }

  const cityRank = getCityRank(cityId, state.displayedRankings);
  const cityCompanies = state.lookups.cityCompanyMap.get(cityId) || [];
  let depotCount = 0;
  for (const { count } of cityCompanies) depotCount += count;

  const rankingEntry = state.cachedRankings?.find(r => r.id === cityId);
  const cargoTypes = rankingEntry?.cargoTypes ?? 0;
  const score = rankingEntry?.score ?? 0;

  // Compute score tier for city detail
  let cityScoreTier: ScoreTier = { className: '', label: '' };
  if (state.cachedRankings && rankingEntry) {
    const rankIndex = state.cachedRankings.findIndex(r => r.id === cityId);
    if (rankIndex >= 0) {
      cityScoreTier = getScoreTier(rankIndex, state.cachedRankings.length);
    }
  }

  const owned = isOwnedGarage(cityId);

  cityContent.innerHTML = `
    <div class="city-header">
      <div class="city-header-row">
        <div>
          <h2>${city.displayName}${city.displayName !== city.name ? ` <span class="native-name">(${city.name})</span>` : ''}</h2>
          <span class="country">${city.countryName}</span>
        </div>
        <div class="city-header-actions">
          <button class="btn btn-sm compare-toggle" id="city-compare-toggle"
            aria-pressed="${isInComparison(cityId)}"
            data-city-id="${cityId}">${isInComparison(cityId) ? '\u2713 In Compare' : '+ Compare'}</button>
          <button class="garage-toggle" id="city-garage-toggle"
            aria-pressed="${owned}" aria-label="${owned ? 'Remove garage' : 'Mark as garage'}"
            title="${owned ? 'Remove garage' : 'Mark as garage'}"
            data-city-id="${cityId}">${owned ? '\u2605' : '\u2606'}</button>
        </div>
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
        <div class="stat-value ${cityScoreTier.className}" title="${cityScoreTier.label}" aria-label="Score ${formatNumber(score)}, ${cityScoreTier.label || 'unranked'}">${formatNumber(score)}</div>
        <div class="stat-label">Score${cityScoreTier.label ? ` \u2014 ${cityScoreTier.label.split(' \u2014 ')[0]}` : ''}</div>
      </div>
    </div>

    <div class="table-section">
      <div class="section-header">
        <h2>Recommended Fleet \u2014 ${optimal.totalTrailers} trailers${optimal.totalEstimatedPrice > 0 ? ` \u00b7 est. ${formatNumber(optimal.totalEstimatedPrice)} to assemble` : ''}${optimal.fleetXpFloor > 0 ? ` \u00b7 XP ${optimal.fleetXpFloor} to unlock all` : ''}</h2>
        <div class="export-buttons">
          <button class="btn copy-btn" id="copy-fleet-btn" type="button">Copy Fleet</button>
          <button class="btn export-btn" id="export-csv-btn" type="button">Export CSV</button>
          <button class="btn export-btn" id="export-json-btn" type="button">Export JSON</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Trailer Type</th>
            <th class="tooltip" tabindex="0" data-tooltip="Expected value per job cycle" aria-label="EV \u2014 Expected value per job cycle">EV</th>
            <th class="tooltip" tabindex="0" data-tooltip="Cargo types this trailer can haul" aria-label="Cargo \u2014 Cargo types this trailer can haul">Cargo</th>
            <th class="tooltip" tabindex="0" data-tooltip="Estimated purchase price (per trailer, rounded to nearest 1000)" aria-label="Price \u2014 Estimated purchase price per trailer">Price</th>
            <th class="tooltip" tabindex="0" data-tooltip="Minimum XP level at which this trailer becomes available" aria-label="XP \u2014 Minimum XP level to unlock">XP</th>
          </tr>
        </thead>
        <tbody>
          ${optimal.drivers.map(renderFleetRow).join('')}
        </tbody>
      </table>

    </div>
  `;

  wireGarageToggle(cityId, rankingsContent, state, citySearch);
  wireCompareToggle(cityId);
  wireCopyFleetButton(city.displayName, optimal.drivers);
  wireExportButtons(city.displayName, optimal.drivers, depotCount, cargoTypes, score);
}

// ============================================
// Copy fleet button
// ============================================

function wireCopyFleetButton(cityName: string, drivers: OptimalFleetEntry[]) {
  const copyBtn = document.getElementById('copy-fleet-btn') as HTMLButtonElement | null;
  if (!copyBtn) return;

  copyBtn.addEventListener('click', () => {
    const lines = drivers.map(d => {
      const countLabel = d.count > 1 ? ` x${d.count}` : '';
      const priceTag = d.estimatedPrice > 0 ? `, ${formatNumber(d.estimatedPrice)} ea` : '';
      const xpTag = d.xpFloor > 0 ? `, XP ${d.xpFloor}` : '';
      return `${d.displayName}${countLabel} (EV: ${formatNumber(d.ev)}, ${d.cargoMatched} cargo${priceTag}${xpTag})`;
    });
    const totalPrice = drivers.reduce((s, d) => s + d.estimatedPrice * d.count, 0);
    const fleetXp = drivers.reduce((m, d) => Math.max(m, d.xpFloor), 0);
    const totalLine = totalPrice > 0 || fleetXp > 0
      ? `\nTotal: ${totalPrice > 0 ? formatNumber(totalPrice) : '—'} · XP ${fleetXp > 0 ? fleetXp : '—'}`
      : '';
    const text = `${cityName} Fleet:\n${lines.join('\n')}${totalLine}`;
    copyToClipboard(text, copyBtn);
  });
}

// ============================================
// Export functions
// ============================================

/**
 * Create a filesystem-safe filename from a string.
 * Transliterates diacritics to ASCII equivalents (e.g., o\u0308->o, e\u0301->e)
 * and replaces only filesystem-unsafe characters.
 */
export function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritics
    .replace(/[/\\:*?"<>|]/g, '_')    // replace filesystem-unsafe chars
    .replace(/_+/g, '_')              // collapse consecutive underscores
    .replace(/^_|_$/g, '');           // trim leading/trailing underscores
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportToCSV(cityName: string, drivers: OptimalFleetEntry[]): void {
  const headers = ['Trailer Type', 'Count', 'EV', 'Cargo Types', 'Est. Price', 'XP Floor'];
  const rows = drivers.map(d => [
    `"${d.displayName}"`,
    d.count,
    d.ev.toFixed(2),
    d.cargoMatched,
    d.estimatedPrice > 0 ? d.estimatedPrice : '',
    d.xpFloor > 0 ? d.xpFloor : '',
  ]);
  const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  const safeName = sanitizeFilename(cityName);
  downloadFile(csv, `${safeName}_fleet.csv`, 'text/csv;charset=utf-8');
}

function exportToJSON(
  cityName: string,
  drivers: OptimalFleetEntry[],
  depotCount: number,
  cargoTypes: number,
  score: number,
): void {
  const totalEstimatedPrice = drivers.reduce((s, d) => s + d.estimatedPrice * d.count, 0);
  const fleetXpFloor = drivers.reduce((m, d) => Math.max(m, d.xpFloor), 0);
  const exportData = {
    city: cityName,
    exportedAt: new Date().toISOString(),
    summary: {
      depots: depotCount,
      cargoTypes,
      score,
      totalTrailers: drivers.reduce((sum, d) => sum + d.count, 0),
      trailerTypes: drivers.length,
      totalEstimatedPrice,
      fleetXpFloor,
    },
    fleet: drivers.map(d => ({
      trailerType: d.displayName,
      bodyType: d.bodyType,
      count: d.count,
      ev: d.ev,
      cargoMatched: d.cargoMatched,
      estimatedPrice: d.estimatedPrice > 0 ? d.estimatedPrice : null,
      xpFloor: d.xpFloor > 0 ? d.xpFloor : null,
    })),
  };
  const json = JSON.stringify(exportData, null, 2);
  const safeName = sanitizeFilename(cityName);
  downloadFile(json, `${safeName}_fleet.json`, 'application/json');
}

function wireExportButtons(
  cityName: string,
  drivers: OptimalFleetEntry[],
  depotCount: number,
  cargoTypes: number,
  score: number,
): void {
  document.getElementById('export-csv-btn')?.addEventListener('click', () => {
    exportToCSV(cityName, drivers);
  });
  document.getElementById('export-json-btn')?.addEventListener('click', () => {
    exportToJSON(cityName, drivers, depotCount, cargoTypes, score);
  });
}

// ============================================
// Garage toggle in city detail
// ============================================

function wireGarageToggle(
  cityId: string,
  rankingsContent: HTMLElement,
  state: RankingsState,
  citySearch: HTMLInputElement,
) {
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
        const cityName = rankingStar.closest('tr')!.querySelector('td:nth-child(3)')!.textContent!;
        rankingStar.title = `${nowOwned ? 'Remove garage for' : 'Mark as garage for'} ${cityName}`;
        rankingStar.setAttribute('aria-label', `${nowOwned ? 'Remove garage for' : 'Mark as garage for'} ${cityName}`);
        const row = rankingStar.closest('tr')!;
        row.classList.toggle('owned-garage', nowOwned);
      }
      // Update garage count badge using filtered count (consistent with rankings view)
      if (state.data && state.lookups) updateGarageCount(state.data, state.lookups, citySearch);
    });
  }
}

// ============================================
// Compare toggle in city detail
// ============================================

function wireCompareToggle(cityId: string) {
  const btn = document.getElementById('city-compare-toggle') as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener('click', () => {
    const wasInSet = isInComparison(cityId);
    const added = toggleComparison(cityId);
    // If we tried to add but the set was full, give feedback
    if (!added && !wasInSet) {
      announceStatus(COMPARE_FULL_MESSAGE);
      const originalText = btn.textContent;
      btn.textContent = 'Max 5';
      btn.classList.add('copy-fail');
      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('copy-fail');
      }, 2000);
      return;
    }
    btn.textContent = added ? '\u2713 In Compare' : '+ Compare';
    btn.setAttribute('aria-pressed', String(added));
    // Sync the rankings table checkbox if visible
    const checkbox = document.querySelector(`.compare-check[data-city-id="${cityId}"]`) as HTMLInputElement | null;
    if (checkbox) checkbox.checked = added;
    updateCompareBar();
  });
}
