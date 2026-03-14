/**
 * Main orchestrator for ETS2 Trucker Advisor
 *
 * Handles initialization, routing between rankings and city detail views,
 * DLC banner, onboarding section, and How It Works toggle.
 * All rendering is delegated to rankings-view.ts and city-detail-view.ts.
 */

import { initPageData, initThemeToggle } from './page-init.js';
import {
  isFirstVisit, isBannerDismissed, dismissBanner,
  isOnboardingCollapsed, setOnboardingCollapsed,
} from './storage.js';
import {
  renderRankings, initRankingsView,
  showLoading, showError,
  getComparisonCityIds,
  type RankingsState,
} from './rankings-view.js';
import { renderCity } from './city-detail-view.js';
import { renderComparison } from './comparison-view.js';

// ============================================
// Shared state
// ============================================

const state: RankingsState = {
  data: null,
  lookups: null,
  cachedRankings: null,
  displayedRankings: null,
};

let currentCityId: string | null = null;

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
const resultsCount = document.getElementById('results-count')!;
const howItWorksToggle = document.getElementById('how-it-works-toggle');
const onboardingToggle = document.getElementById('onboarding-toggle');
const onboardingSection = document.getElementById('onboarding');

// ============================================
// Utilities
// ============================================

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// ============================================
// Navigation
// ============================================

// ============================================
// Comparison view container (created lazily)
// ============================================

let compareView: HTMLElement | null = null;
let compareContent: HTMLElement | null = null;
let compareBackLink: HTMLElement | null = null;

function ensureCompareView() {
  if (compareView) return;
  compareView = document.createElement('div');
  compareView.id = 'compare-view';
  compareView.style.display = 'none';

  compareBackLink = document.createElement('button');
  compareBackLink.className = 'back-link';
  compareBackLink.id = 'compare-back-link';
  (compareBackLink as HTMLButtonElement).type = 'button';
  compareBackLink.textContent = '\u2190 Back to rankings';
  compareBackLink.addEventListener('click', showRankings);

  compareContent = document.createElement('div');
  compareContent.id = 'compare-content';
  compareContent.setAttribute('aria-live', 'polite');

  compareView.appendChild(compareBackLink);
  compareView.appendChild(compareContent);

  // Insert alongside the other views
  cityView.parentNode!.insertBefore(compareView, cityView.nextSibling);
}

let lastViewedCityId: string | null = null;

async function showCity(cityId: string) {
  lastViewedCityId = cityId;
  currentCityId = cityId;
  rankingsView.style.display = 'none';
  cityView.style.display = 'block';
  if (compareView) compareView.style.display = 'none';
  if (window.location.hash !== `#city-${cityId}`) {
    window.location.hash = `city-${cityId}`;
  }
  await renderCity(cityId, state, cityContent, rankingsContent, citySearch);
  window.scrollTo(0, 0);
}

async function showComparison() {
  ensureCompareView();
  currentCityId = null;
  rankingsView.style.display = 'none';
  cityView.style.display = 'none';
  compareView!.style.display = 'block';
  if (window.location.hash !== '#compare') {
    window.location.hash = 'compare';
  }
  await renderComparison(getComparisonCityIds(), state, compareContent!);
  window.scrollTo(0, 0);
}

async function showRankings() {
  const restoreCityId = lastViewedCityId;
  currentCityId = null;
  cityView.style.display = 'none';
  if (compareView) compareView.style.display = 'none';
  rankingsView.style.display = 'block';
  window.location.hash = '';
  await renderRankings(state, rankingsContent, citySearch, resultsCount, showCity);
  if (restoreCityId) {
    const row = rankingsContent.querySelector(`tr[data-city-id="${restoreCityId}"]`) as HTMLElement | null;
    if (row) row.focus();
  }
}

function handleHashNavigation(): boolean {
  const hash = window.location.hash;
  if (hash === '#compare') {
    const ids = getComparisonCityIds();
    if (ids.length >= 2) {
      showComparison();
      return true;
    }
    return false;
  }
  if (hash.startsWith('#city-')) {
    const cityId = hash.replace('#city-', '');
    if (cityId && state.lookups?.citiesById.has(cityId)) {
      showCity(cityId);
      return true;
    }
  }
  return false;
}

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
  initThemeToggle();
  showDLCBanner();

  // Initialize onboarding section collapsed state
  if (onboardingSection && onboardingToggle) {
    const collapsed = isOnboardingCollapsed();
    if (collapsed) {
      onboardingSection.classList.add('collapsed');
      onboardingToggle.setAttribute('aria-expanded', 'false');
      onboardingToggle.querySelector('.toggle-icon')!.textContent = '\u25b6';
    }
    onboardingToggle.addEventListener('click', () => {
      const isCollapsed = onboardingSection.classList.contains('collapsed');
      if (isCollapsed) {
        onboardingSection.classList.remove('collapsed');
        onboardingToggle.setAttribute('aria-expanded', 'true');
        onboardingToggle.querySelector('.toggle-icon')!.textContent = '\u25bc';
        setOnboardingCollapsed(false);
      } else {
        onboardingSection.classList.add('collapsed');
        onboardingToggle.setAttribute('aria-expanded', 'false');
        onboardingToggle.querySelector('.toggle-icon')!.textContent = '\u25b6';
        setOnboardingCollapsed(true);
      }
    });
  }

  showLoading(rankingsContent);

  try {
    const page = await initPageData();
    state.data = page.data;
    state.lookups = page.lookups;

    // Initialize rankings view (filters, country dropdown, etc.)
    initRankingsView(state, rankingsContent, citySearch, resultsCount, filterToggle, showCity);

    if (!handleHashNavigation()) {
      renderRankings(state, rankingsContent, citySearch, resultsCount, showCity);
    }

    citySearch.addEventListener('input', debounce(
      () => renderRankings(state, rankingsContent, citySearch, resultsCount, showCity),
      150,
    ));
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
          howItWorksToggle.querySelector('.toggle-icon')!.textContent = '\u25bc';
        } else {
          section.classList.add('collapsed');
          howItWorksToggle.setAttribute('aria-expanded', 'false');
          howItWorksToggle.querySelector('.toggle-icon')!.textContent = '\u25b6';
        }
      });
    }
  } catch (err) {
    console.error('Failed to initialize:', err);
    showError(rankingsContent, (err as Error).message || 'Unknown error occurred');
  }
}

init();
