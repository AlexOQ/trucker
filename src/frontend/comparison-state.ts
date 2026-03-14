/**
 * Comparison selection state for ETS2 Trucker Advisor
 *
 * Manages the set of cities selected for side-by-side comparison,
 * the floating compare bar DOM element, URL hash encoding,
 * and aria-live status announcements.
 */

// ============================================
// Comparison selection state
// ============================================

export const MAX_COMPARE = 5;
export const COMPARE_FULL_MESSAGE = 'Maximum 5 cities for comparison';
const comparisonSet = new Set<string>();

export function getComparisonCityIds(): string[] {
  return Array.from(comparisonSet);
}

export function isInComparison(cityId: string): boolean {
  return comparisonSet.has(cityId);
}

export function isComparisonFull(): boolean {
  return comparisonSet.size >= MAX_COMPARE;
}

export function toggleComparison(cityId: string): boolean {
  if (comparisonSet.has(cityId)) {
    comparisonSet.delete(cityId);
    return false;
  }
  if (comparisonSet.size >= MAX_COMPARE) return false;
  comparisonSet.add(cityId);
  return true;
}

/**
 * Restore comparison set from city IDs (e.g., parsed from URL hash).
 * Validates each ID against a set of known city IDs. Skips invalid ones.
 */
export function setComparisonCities(ids: string[], validCityIds?: Set<string>): void {
  comparisonSet.clear();
  for (const id of ids.slice(0, MAX_COMPARE)) {
    if (!validCityIds || validCityIds.has(id)) {
      comparisonSet.add(id);
    }
  }
}

/**
 * Build the hash string for the current comparison state.
 * Returns `#compare=id1,id2,...` if cities are selected, or `#compare` if empty.
 */
export function buildCompareHash(): string {
  const ids = getComparisonCityIds();
  if (ids.length === 0) return '#compare';
  return `#compare=${ids.join(',')}`;
}

/**
 * Parse city IDs from a hash string like `#compare=id1,id2,id3`.
 * Returns empty array if hash doesn't match the compare format.
 */
export function parseCompareHash(hash: string): string[] {
  if (!hash.startsWith('#compare=')) return [];
  const idsStr = hash.slice('#compare='.length);
  if (!idsStr) return [];
  return idsStr.split(',').filter(id => id.length > 0);
}

export function updateCompareBar() {
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
    <button class="compare-bar-clear" id="compare-bar-clear" type="button" aria-label="Clear comparison">&times;</button>
  `;

  document.getElementById('compare-bar-go')!.addEventListener('click', () => {
    window.location.hash = buildCompareHash();
  });

  document.getElementById('compare-bar-clear')!.addEventListener('click', () => {
    comparisonSet.clear();
    updateCompareBar();
    document.querySelectorAll('.compare-check').forEach(cb => {
      (cb as HTMLInputElement).checked = false;
    });
  });
}

// ============================================
// Status announcements (aria-live)
// ============================================

export function announceStatus(message: string): void {
  let region = document.getElementById('status-announce');
  if (!region) {
    region = document.createElement('span');
    region.id = 'status-announce';
    region.className = 'sr-only';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  region.textContent = message;
  setTimeout(() => { region!.textContent = ''; }, 3000);
}
