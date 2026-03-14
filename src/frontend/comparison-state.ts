/**
 * Comparison selection state for ETS2 Trucker Advisor
 *
 * Manages the session-only set of cities selected for side-by-side comparison,
 * the floating compare bar DOM element, and aria-live status announcements.
 */

// ============================================
// Comparison selection state (session only)
// ============================================

export const MAX_COMPARE = 5;
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
  if (comparisonSet.size >= MAX_COMPARE) return false; // reject — caller handles feedback
  comparisonSet.add(cityId);
  return true;
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
// Status announcements (aria-live + visual)
// ============================================

/**
 * Announces a transient status message to screen readers via an aria-live region,
 * and briefly shows it as visible text. Clears after 3 seconds.
 */
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
