/**
 * City comparison view for ETS2 Trucker Advisor
 *
 * Renders a side-by-side comparison of 2-5 selected cities,
 * highlighting the winner in each category.
 */

import { computeFleetAsync } from './optimizer-client.js';
import type { CityRanking, OptimalFleet } from './optimizer.js';
import { formatNumber, getScoreTier } from './rankings-view.js';
import type { RankingsState } from './rankings-view.js';

// ============================================
// Types
// ============================================

interface CityComparisonData {
  ranking: CityRanking;
  fleet: OptimalFleet | null;
  depotCount: number;
  tierLabel: string;
  tierClass: string;
}

// ============================================
// Rendering
// ============================================

export function bestIndex(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

function winnerClass(index: number, winnerIdx: number): string {
  return index === winnerIdx ? ' compare-winner' : '';
}

export async function renderComparison(
  cityIds: string[],
  state: RankingsState,
  container: HTMLElement,
): Promise<void> {
  if (cityIds.length < 2) {
    container.innerHTML = '<div class="empty-state">Select at least 2 cities to compare.</div>';
    return;
  }

  if (!state.data || !state.lookups) {
    container.innerHTML = '<div class="empty-state">Data not yet loaded.</div>';
    return;
  }

  container.innerHTML = '<div class="empty-state">Loading comparison...</div>';

  const { data, lookups } = state;

  // Gather data for each city — fleet computations run in parallel
  const cities: CityComparisonData[] = (
    await Promise.all(
      cityIds.map(async (cityId) => {
        const ranking = state.cachedRankings?.find(r => r.id === cityId);
        if (!ranking) return null;

        const fleet = await computeFleetAsync(cityId, data, lookups);

        const globalIndex = state.cachedRankings!.findIndex(r => r.id === cityId);
        const tier = getScoreTier(globalIndex >= 0 ? globalIndex : 0, state.cachedRankings!.length);

        return {
          ranking,
          fleet,
          depotCount: ranking.depotCount,
          tierLabel: tier.label ? tier.label.split(' \u2014 ')[0] : '',
          tierClass: tier.className,
        } satisfies CityComparisonData;
      }),
    )
  ).filter((c): c is CityComparisonData => c !== null);

  if (cities.length < 2) {
    container.innerHTML = '<div class="empty-state">Could not load data for selected cities.</div>';
    return;
  }

  // Compute winners for each metric
  const scores = cities.map(c => c.ranking.score);
  const depots = cities.map(c => c.depotCount);
  const cargoTypes = cities.map(c => c.ranking.cargoTypes);
  const scoreWinner = bestIndex(scores);
  const depotWinner = bestIndex(depots);
  const cargoWinner = bestIndex(cargoTypes);

  container.innerHTML = `
    <div class="compare-grid" style="--compare-cols: ${cities.length}">
      ${cities.map((city, i) => `
        <div class="compare-card">
          <div class="compare-card-header">
            <h3>${city.ranking.displayName}${city.ranking.displayName !== city.ranking.name ? ` <span class="native-name">(${city.ranking.name})</span>` : ''}</h3>
            <span class="country">${city.ranking.countryName}</span>
          </div>

          <div class="compare-stats">
            <div class="compare-stat${winnerClass(i, scoreWinner)}">
              <div class="compare-stat-value ${city.tierClass}">${formatNumber(city.ranking.score)}</div>
              <div class="compare-stat-label">Fleet EV${city.tierLabel ? ` \u2014 ${city.tierLabel}` : ''}</div>
            </div>
            <div class="compare-stat${winnerClass(i, depotWinner)}">
              <div class="compare-stat-value">${city.depotCount}</div>
              <div class="compare-stat-label">Depots</div>
            </div>
            <div class="compare-stat${winnerClass(i, cargoWinner)}">
              <div class="compare-stat-value">${city.ranking.cargoTypes}</div>
              <div class="compare-stat-label">Cargo Types</div>
            </div>
          </div>

          <div class="compare-fleet">
            <h4>Top Trailers</h4>
            ${city.fleet ? city.fleet.drivers.map(d => {
              const countLabel = d.count > 1 ? ` \u00d7${d.count}` : '';
              return `
                <div class="compare-fleet-row">
                  <span class="compare-trailer-name">${d.displayName}${countLabel}</span>
                  <span class="compare-trailer-ev">${formatNumber(d.ev)}</span>
                </div>
              `;
            }).join('') : '<div class="compare-no-data">No fleet data</div>'}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
