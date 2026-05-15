/**
 * Trucks page — minimum-cost truck recommender.
 *
 * For each truck (brand, model) computes the cheapest valid config:
 *   cabin + chassis + engine + transmission + paint
 * Cabin↔chassis compatibility enforced via cabin.suitable_for[]. Accessories
 * (mirrors, lights, bumpers) are cosmetic and excluded — AI drivers don't
 * need them.
 */

import { initPageData, initThemeToggle, initGameSelector } from './page-init';
import { normalize, type GameDefs } from './data';
import { escapeHtml } from './utils';
import { computeMinCost, brandLabel, modelLabel, displayName, type MinCostConfig } from './trucks-cost';

type Truck = GameDefs['trucks'][number];

let truckRows: Array<{ truck: Truck; config: MinCostConfig }> = [];

const content = document.getElementById('content') as HTMLElement;
const truckDetail = document.getElementById('truck-detail') as HTMLElement;
const detailContent = document.getElementById('detail-content') as HTMLElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const backLink = document.getElementById('back-link') as HTMLElement;

function renderTruckList(filter = ''): void {
  const filterNorm = normalize(filter);
  const filtered = truckRows.filter(({ truck }) => {
    const label = `${brandLabel(truck.brand)} ${modelLabel(truck.model)}`;
    return normalize(label).includes(filterNorm);
  });

  if (filtered.length === 0) {
    const escaped = escapeHtml(filter);
    content.innerHTML = filter
      ? `<div class="empty-state">No trucks matching "${escaped}".</div>`
      : '<div class="empty-state">No truck data available.</div>';
    return;
  }

  content.innerHTML = `
    <div class="table-section">
      <h2>Cheapest configurations</h2>
      <p class="subtitle">
        Minimum-cost build per truck: cheapest valid cabin + chassis pair,
        cheapest engine / transmission / paint. Cosmetic accessories excluded —
        AI drivers don't need them.
      </p>
      <table>
        <thead>
          <tr>
            <th>Brand</th>
            <th>Model</th>
            <th class="num">Min cost</th>
            <th class="num">Level</th>
            <th class="num">Cabin</th>
            <th class="num">Chassis</th>
            <th class="num">Engine</th>
            <th class="num">Trans</th>
            <th class="num">Paint</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(({ truck, config }) => `
            <tr>
              <td>${escapeHtml(brandLabel(truck.brand))}</td>
              <td><a href="#truck-${escapeHtml(truck.id)}" class="link" data-truck-id="${escapeHtml(truck.id)}">${escapeHtml(modelLabel(truck.model))}</a></td>
              <td class="num"><strong>€${config.total.toLocaleString()}</strong></td>
              <td class="num">${config.levelFloor}</td>
              <td class="num">€${config.cabin.price.toLocaleString()}</td>
              <td class="num">€${config.chassis.price.toLocaleString()}</td>
              <td class="num">€${config.engine.price.toLocaleString()}</td>
              <td class="num">€${config.transmission.price.toLocaleString()}</td>
              <td class="num">${config.paint ? `€${config.paint.price.toLocaleString()}` : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  content.querySelectorAll('[data-truck-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      showTruckDetail((el as HTMLElement).dataset.truckId!);
    });
  });
}

function componentTable<T extends { id: string; name: string; price: number; unlock: number }>(
  title: string, items: T[], selectedId: string | null,
  extraCols: Array<{ header: string; render: (item: T) => string }> = [],
): string {
  if (items.length === 0) return '';
  const sorted = [...items].sort((a, b) => a.price - b.price);
  return `
    <div class="table-section">
      <h2>${escapeHtml(title)} (${items.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th class="num">Price</th>
            <th class="num">Unlock</th>
            ${extraCols.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${sorted.map((item) => `
            <tr${item.id === selectedId ? ' class="highlight"' : ''}>
              <td>${escapeHtml(displayName(item.name))}</td>
              <td class="num">€${item.price.toLocaleString()}</td>
              <td class="num">${item.unlock}</td>
              ${extraCols.map((c) => `<td>${escapeHtml(c.render(item))}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function showTruckDetail(truckId: string): void {
  const row = truckRows.find((r) => r.truck.id === truckId);
  if (!row) return;
  const { truck, config } = row;

  content.style.display = 'none';
  truckDetail.style.display = 'block';
  // Guard the hash write — assigning it fires `hashchange`, which routes back
  // into showTruckDetail and re-renders. Only push when it would actually change.
  const targetHash = `#truck-${truckId}`;
  if (window.location.hash !== targetHash) window.location.hash = targetHash;

  detailContent.innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(brandLabel(truck.brand))} ${escapeHtml(modelLabel(truck.model))}</h2>
      <div class="subtitle">Cheapest configuration: <strong>€${config.total.toLocaleString()}</strong> · unlock level ${config.levelFloor}</div>
    </div>

    <div class="stats">
      <div class="stat"><div class="stat-value">€${config.cabin.price.toLocaleString()}</div><div class="stat-label">Cabin · ${escapeHtml(displayName(config.cabin.name))}</div></div>
      <div class="stat"><div class="stat-value">€${config.chassis.price.toLocaleString()}</div><div class="stat-label">Chassis · ${escapeHtml(config.chassis.axle_config || displayName(config.chassis.name))}</div></div>
      <div class="stat"><div class="stat-value">€${config.engine.price.toLocaleString()}</div><div class="stat-label">Engine</div></div>
      <div class="stat"><div class="stat-value">€${config.transmission.price.toLocaleString()}</div><div class="stat-label">Transmission</div></div>
      <div class="stat"><div class="stat-value">${config.paint ? `€${config.paint.price.toLocaleString()}` : '—'}</div><div class="stat-label">Paint${config.paint ? ` · ${escapeHtml(displayName(config.paint.name))}` : ''}</div></div>
    </div>

    ${componentTable('Cabins', truck.cabins ?? [], config.cabin.id, [
      { header: 'Fits chassis', render: (c) => c.suitable_for.length === 0 ? 'any' : `${c.suitable_for.length}` },
    ])}
    ${componentTable('Chassis', truck.chassis, config.chassis.id, [
      { header: 'Axle', render: (c) => c.axle_config || '?' },
      { header: 'Tank L', render: (c) => `${c.tank_size}` },
    ])}
    ${componentTable('Engines', truck.engines, config.engine.id, [
      { header: 'Torque', render: (e) => `${e.torque}` },
      { header: 'Vol L', render: (e) => `${e.volume}` },
    ])}
    ${componentTable('Transmissions', truck.transmissions, config.transmission.id, [
      { header: 'Gears', render: (t) => `${t.forward_gears}f / ${t.reverse_gears}r` },
      { header: 'Retarder', render: (t) => t.retarder ? 'yes' : '—' },
    ])}
    ${componentTable('Paints', truck.paints ?? [], config.paint?.id ?? null)}
  `;
}

function showTruckList(): void {
  truckDetail.style.display = 'none';
  content.style.display = 'block';
  if (window.location.hash !== '') window.location.hash = '';
  renderTruckList(searchInput.value);
}

function handleHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#truck-')) {
    const id = hash.replace('#truck-', '');
    if (id) showTruckDetail(id);
  } else {
    showTruckList();
  }
}

async function init(): Promise<void> {
  initThemeToggle();
  initGameSelector();
  content.innerHTML = '<div class="loading" role="status">Loading trucks...</div>';

  try {
    const page = await initPageData();
    const trucks = page.data.gameDefs?.trucks ?? [];

    truckRows = trucks
      .map((truck) => {
        const config = computeMinCost(truck);
        return config ? { truck, config } : null;
      })
      .filter((r): r is { truck: Truck; config: MinCostConfig } => r !== null)
      .sort((a, b) => a.config.total - b.config.total);

    renderTruckList();

    searchInput.addEventListener('input', () => renderTruckList(searchInput.value));
    backLink.addEventListener('click', (e) => { e.preventDefault(); showTruckList(); });
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    content.innerHTML = `
      <div class="empty-state" role="alert">
        <p>Failed to load truck data</p>
        <p class="error-detail">${escapeHtml(message)}</p>
      </div>
    `;
  }
}

init();
