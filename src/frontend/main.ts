/**
 * Main orchestrator for ETS2 Trucker Advisor rankings page
 *
 * Handles initialization, routing (hash navigation), and wires together
 * the rankings view and city detail view modules.
 */

import { initPageData } from './page-init.js';
import {
  getFilterMode,
  isFirstVisit, isBannerDismissed, dismissBanner,
  isOnboardingCollapsed, setOnboardingCollapsed,
} from './storage.js';
import type { MainState } from './rankings-view.js';
import {
  renderRankings as doRenderRankings,
  renderCountryCheckboxes,
  updateCountryButtonText,
  updateGarageCount,
  showLoading,
  showError,
  wireFilterToggle,
  wireCountryFilter,
} from './rankings-view.js';
import { renderCity } from './city-detail-view.js';

// ============================================
// Shared state
// ============================================

const state: MainState = {
  data: null,
  lookups: null,
  cachedRankings: null,
  displayedRankings: null,
};

let currentCityId: string | null = null;

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
// DOM elements
// ============================================

const rankingsView = document.getElementById('rankings-view')!;
const rankingsContent = document.getElementById('rankings-content')!;
const cityView = document.getElementById('city-view')!;
const cityContent = document.getElementById('city-content')!;
const backLink = document.getElementById('back-link')!;
const filterToggle = document.getElementById('filter-toggle')!;
const citySearch = document.getElementById('city-search') as HTMLInputElement;
const howItWorksToggle = document.getElementById('how-it-works-toggle');
const onboardingToggle = document.getElementById('onboarding-toggle');
const onboardingSection = document.getElementById('onboarding');

// ============================================
// View delegates
// ============================================

function renderRankings() {
  doRenderRankings(state, rankingsContent, citySearch, showCity);
}

// ============================================
// Navigation
// ============================================

async function showCity(cityId: string) {
  currentCityId = cityId;
  rankingsView.style.display = 'none';
  cityView.style.display = 'block';
  if (window.location.hash !== `#city-${cityId}`) {
    window.location.hash = `city-${cityId}`;
  }
  await renderCity(cityId, state, cityContent, rankingsContent, citySearch);
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

    renderCountryCheckboxes(state.data, renderRankings);
    updateCountryButtonText();

    const savedFilterMode = getFilterMode();
    filterToggle.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === savedFilterMode);
    });
    updateGarageCount(state, citySearch);

    wireFilterToggle(filterToggle, renderRankings);

    if (!handleHashNavigation()) {
      renderRankings();
    }

    citySearch.addEventListener('input', debounce(renderRankings, 150));
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

    // Country filter dropdown
    wireCountryFilter();
  } catch (err) {
    console.error('Failed to initialize:', err);
    showError(rankingsContent, (err as Error).message || 'Unknown error occurred');
  }
}

init();
