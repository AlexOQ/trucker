/**
 * Shared page initialization for ETS2 Trucker Advisor
 *
 * Centralizes the data loading + DLC filtering + lookup building
 * sequence that every page module needs. When DLC filtering logic
 * changes, only this file needs updating.
 */

import { getActiveGame, setActiveGame, getGameMeta, type GameId } from './game';
import { loadAllData } from './loader';
import { buildLookups } from './lookups';
import { applyDLCFilter, getBlockedCities } from './dlc-filter';
import {
  getOwnedTrailerDLCs, getOwnedCargoDLCs, getOwnedMapDLCs,
  COMBINED_CARGO_DLC_MAP, CITY_DLC_MAP,
  getTheme, toggleTheme,
} from './storage';
import type { AllData, Lookups } from './types';

export interface PageData {
  data: AllData;
  lookups: Lookups;
}

/**
 * Wire up the theme toggle button (present in every page's nav).
 * Safe to call even if the button doesn't exist.
 */
export function initThemeToggle(): void {
  const btn = document.getElementById('theme-toggle') as HTMLButtonElement | null;
  if (!btn) return;

  function updateIcon() {
    const theme = getTheme();
    // Sun icon for dark mode (click to switch to light), moon for light mode
    btn!.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
  }

  updateIcon();

  btn.addEventListener('click', () => {
    toggleTheme();
    updateIcon();
  });
}

/** Nav model — single source of truth for every page's nav (#247). */
const NAV_DATA_DETAILS = [
  { href: 'cities.html', label: 'Cities' },
  { href: 'companies.html', label: 'Companies' },
  { href: 'cargo.html', label: 'Cargo' },
  { href: 'trailers.html', label: 'Trailers' },
  { href: 'trucks.html', label: 'Trucks' },
];

/**
 * Render the shared nav into <header><nav>. Replaces the per-page copy that was
 * duplicated across all 7 HTML files. The data-detail browsers live under a
 * "Data Details" dropdown; Rankings + DLCs stay top-level (#247).
 */
export function renderNav(): void {
  const nav = document.querySelector('header nav');
  if (!nav) return;

  const current = location.pathname.split('/').pop() || 'index.html';
  const cls = (href: string) => (href === current ? ' class="active"' : '');
  const dataActive = NAV_DATA_DETAILS.some((l) => l.href === current);

  nav.innerHTML = `
    <div class="game-selector" id="game-selector">
      <button class="game-btn" data-game="ets2">ETS2</button>
      <button class="game-btn" data-game="ats">ATS</button>
    </div>
    <a href="index.html"${cls('index.html')}>Rankings</a>
    <div class="nav-dropdown">
      <button class="nav-dropdown-toggle${dataActive ? ' active' : ''}" id="data-details-toggle"
        aria-expanded="false" aria-haspopup="true">Data Details <span class="caret">▾</span></button>
      <div class="nav-dropdown-menu" id="data-details-menu" role="menu">
        ${NAV_DATA_DETAILS.map((l) => `<a role="menuitem" href="${l.href}"${cls(l.href)}>${l.label}</a>`).join('')}
      </div>
    </div>
    <a href="dlcs.html"${cls('dlcs.html')}>DLCs</a>
    <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark/light theme" title="Toggle theme"></button>
  `;

  const toggle = nav.querySelector('#data-details-toggle') as HTMLButtonElement | null;
  const dropdown = toggle?.parentElement;
  if (toggle && dropdown) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dropdown.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target as Node)) {
        dropdown.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

/**
 * Wire up the game selector (ETS2 / ATS toggle in every page's nav).
 * Renders the shared nav first, then wires the selector + theme toggle.
 * Title is a stable brand; the active game is shown only by the selector and subtitle.
 */
export function initGameSelector(): void {
  renderNav();
  const meta = getGameMeta();
  const activeGame = getActiveGame();

  // Stable brand title — does not change with ETS2/ATS selection (#247).
  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = 'Trucker Advisor';
  if (subtitleEl) subtitleEl.textContent = meta.subtitle;
  document.title = 'Trucker Advisor';

  // Highlight active game button
  const selector = document.getElementById('game-selector');
  if (!selector) return;

  selector.querySelectorAll('.game-btn').forEach((btn) => {
    const gameId = (btn as HTMLElement).dataset.game as GameId;
    if (gameId === activeGame) btn.classList.add('active');

    btn.addEventListener('click', () => {
      if (gameId !== activeGame) setActiveGame(gameId);
    });
  });

  // Theme toggle is rendered by renderNav() above, so wire it here.
  initThemeToggle();
}

/**
 * Load game data, apply DLC ownership filters, and build lookup maps.
 *
 * Every browser page calls this once at startup. The sequence is:
 * 1. loadAllData()       — fetch game-defs.json + observations.json
 * 2. applyDLCFilter()    — remove content from unowned DLCs
 * 3. buildLookups()      — build efficient access maps
 */
export async function initPageData(): Promise<PageData> {
  // loadAllData() must run first — it calls initDlcData() which overrides
  // the DLC registries (ALL_MAP_DLC_IDS, CITY_DLC_MAP, etc.) with the
  // active game's data. DLC ownership reads must come AFTER this.
  const rawData = await loadAllData();

  const ownedCargoAndMap = new Set([...getOwnedCargoDLCs(), ...getOwnedMapDLCs()]);
  const blocked = getBlockedCities(getOwnedMapDLCs(), CITY_DLC_MAP);
  const data = applyDLCFilter(
    rawData,
    getOwnedTrailerDLCs(),
    ownedCargoAndMap,
    COMBINED_CARGO_DLC_MAP,
    blocked,
  );
  const lookups = buildLookups(data);
  return { data, lookups };
}
