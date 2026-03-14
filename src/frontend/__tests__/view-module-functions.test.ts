/**
 * Tests for pure functions in view modules:
 * - getScoreTier / formatNumber (rankings-view.ts)
 * - sanitizeFilename (city-detail-view.ts)
 * - bestIndex (comparison-view.ts)
 * - getTheme / setTheme / toggleTheme (storage.ts)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================
// Mock heavy dependencies before any imports
// ============================================

// Mock optimizer-client so rankings-view / city-detail-view / comparison-view can load
vi.mock('../optimizer-client', () => ({
  computeRankingsAsync: vi.fn().mockResolvedValue([]),
  computeFleetAsync: vi.fn().mockResolvedValue(null),
}));

// Mock storage for rankings-view (it uses storage functions)
vi.mock('../storage', () => ({
  getOwnedGarages: vi.fn(() => []),
  toggleOwnedGarage: vi.fn(),
  getFilterMode: vi.fn(() => 'all'),
  setFilterMode: vi.fn(),
  getSelectedCountries: vi.fn(() => []),
  setSelectedCountries: vi.fn(),
  getSortColumn: vi.fn(() => 'score'),
  getSortDirection: vi.fn(() => 'desc'),
  setSortPreference: vi.fn(),
  getTheme: vi.fn(() => 'dark'),
  setTheme: vi.fn(),
  toggleTheme: vi.fn(() => 'light'),
  _resetStateCache: vi.fn(),
  // DLC re-exports
  TRAILER_DLCS: {},
  ALL_DLC_IDS: [],
  CARGO_DLCS: {},
  ALL_CARGO_DLC_IDS: [],
  MAP_DLCS: {},
  ALL_MAP_DLC_IDS: [],
  GARAGE_CITIES: new Set(),
  CITY_DLC_MAP: {},
  CARGO_DLC_MAP: {},
  MAP_DLC_CARGO: {},
  COMBINED_CARGO_DLC_MAP: {},
}));

// Mock data module (normalize is used in rankings-view)
vi.mock('../data', () => ({
  normalize: vi.fn((s: string) => s.toLowerCase()),
}));

// Mock clipboard (city-detail-view imports it)
vi.mock('../clipboard', () => ({
  copyToClipboard: vi.fn(),
}));

// Mock utils (escapeHtml is imported by both views)
vi.mock('../utils', () => ({
  escapeHtml: vi.fn((s: string) => s),
  normalize: vi.fn((s: string) => s.toLowerCase()),
  titleCase: vi.fn((s: string) => s),
  trailerTotalHV: vi.fn(() => 0),
  formatTrailerSpec: vi.fn(() => ''),
}));

// ============================================
// rankings-view: getScoreTier, formatNumber
// ============================================

import { getScoreTier, formatNumber } from '../rankings-view';

describe('getScoreTier', () => {
  it('returns empty tier when total is 0', () => {
    const tier = getScoreTier(0, 0);
    expect(tier.className).toBe('');
    expect(tier.label).toBe('');
  });

  it('returns excellent for index 0 of 1 (top 0%)', () => {
    const tier = getScoreTier(0, 1);
    expect(tier.className).toBe('score-tier-excellent');
    expect(tier.label).toContain('top 10%');
  });

  it('returns excellent for top 10% — percentile < 10', () => {
    // index 0, total 100 → percentile 0% → excellent
    expect(getScoreTier(0, 100).className).toBe('score-tier-excellent');
    // index 9, total 100 → percentile 9% → excellent
    expect(getScoreTier(9, 100).className).toBe('score-tier-excellent');
  });

  it('returns good for top 10%–25% range (percentile 10–24)', () => {
    // index 10, total 100 → percentile 10% → good
    expect(getScoreTier(10, 100).className).toBe('score-tier-good');
    // index 24, total 100 → percentile 24% → good
    expect(getScoreTier(24, 100).className).toBe('score-tier-good');
  });

  it('returns good tier label', () => {
    const tier = getScoreTier(10, 100);
    expect(tier.label).toContain('top 25%');
  });

  it('returns average for 25%–50% range (percentile 25–49)', () => {
    // index 25, total 100 → percentile 25% → average
    expect(getScoreTier(25, 100).className).toBe('score-tier-average');
    // index 49, total 100 → percentile 49% → average
    expect(getScoreTier(49, 100).className).toBe('score-tier-average');
  });

  it('returns average tier label', () => {
    const tier = getScoreTier(25, 100);
    expect(tier.label).toContain('top 50%');
  });

  it('returns below-average for bottom 50% (percentile >= 50)', () => {
    // index 50, total 100 → percentile 50% → below
    expect(getScoreTier(50, 100).className).toBe('score-tier-below');
    // index 99, total 100 → percentile 99% → below
    expect(getScoreTier(99, 100).className).toBe('score-tier-below');
  });

  it('returns below-average tier label', () => {
    const tier = getScoreTier(50, 100);
    expect(tier.label).toContain('bottom 50%');
  });

  it('boundary: percentile exactly 10% is good, not excellent', () => {
    // 10/100 = 10.0%, not < 10, so good
    expect(getScoreTier(10, 100).className).toBe('score-tier-good');
  });

  it('boundary: percentile exactly 25% is average, not good', () => {
    // 25/100 = 25.0%, not < 25, so average
    expect(getScoreTier(25, 100).className).toBe('score-tier-average');
  });

  it('boundary: percentile exactly 50% is below, not average', () => {
    // 50/100 = 50.0%, not < 50, so below
    expect(getScoreTier(50, 100).className).toBe('score-tier-below');
  });
});

describe('formatNumber', () => {
  it('formats integer zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats positive integer', () => {
    expect(formatNumber(42)).toBe('42');
  });

  it('rounds decimals to nearest integer (down)', () => {
    expect(formatNumber(3.4)).toBe('3');
  });

  it('rounds decimals to nearest integer (up at .5)', () => {
    expect(formatNumber(3.5)).toBe('4');
  });

  it('rounds decimals to nearest integer (up)', () => {
    expect(formatNumber(3.9)).toBe('4');
  });

  it('formats large numbers with locale separators', () => {
    const result = formatNumber(1234567);
    // Strip locale-specific separators — just check digits are correct
    expect(result.replace(/[,.\s\u00a0]/g, '')).toBe('1234567');
  });

  it('formats negative numbers', () => {
    const result = formatNumber(-100);
    expect(result).toContain('100');
    expect(result).toContain('-');
  });

  it('rounds negative decimals', () => {
    const result = formatNumber(-3.6);
    expect(result).toContain('-');
    expect(result).toContain('4');
  });
});

// ============================================
// city-detail-view: sanitizeFilename
// ============================================

import { sanitizeFilename } from '../city-detail-view';

describe('sanitizeFilename', () => {
  it('returns plain ASCII unchanged', () => {
    expect(sanitizeFilename('Berlin')).toBe('Berlin');
    expect(sanitizeFilename('London')).toBe('London');
  });

  it('strips diacritics — Zürich', () => {
    expect(sanitizeFilename('Zürich')).toBe('Zurich');
  });

  it('strips diacritics — Córdoba', () => {
    expect(sanitizeFilename('Córdoba')).toBe('Cordoba');
  });

  it('strips diacritics — Malmö', () => {
    expect(sanitizeFilename('Malmö')).toBe('Malmo');
  });

  it('strips diacritics — Kraków', () => {
    expect(sanitizeFilename('Kraków')).toBe('Krakow');
  });

  it('replaces forward slash with underscore', () => {
    expect(sanitizeFilename('path/file')).toBe('path_file');
  });

  it('replaces backslash with underscore', () => {
    expect(sanitizeFilename('path\\file')).toBe('path_file');
  });

  it('replaces colon', () => {
    expect(sanitizeFilename('file:name')).toBe('file_name');
  });

  it('replaces asterisk', () => {
    expect(sanitizeFilename('file*name')).toBe('file_name');
  });

  it('replaces question mark', () => {
    expect(sanitizeFilename('file?name')).toBe('file_name');
  });

  it('replaces double quote', () => {
    expect(sanitizeFilename('file"name')).toBe('file_name');
  });

  it('replaces less-than bracket', () => {
    expect(sanitizeFilename('file<name')).toBe('file_name');
  });

  it('replaces greater-than bracket', () => {
    expect(sanitizeFilename('file>name')).toBe('file_name');
  });

  it('replaces pipe character', () => {
    expect(sanitizeFilename('file|name')).toBe('file_name');
  });

  it('collapses consecutive unsafe chars into single underscore', () => {
    expect(sanitizeFilename('file///name')).toBe('file_name');
    expect(sanitizeFilename('file**name')).toBe('file_name');
  });

  it('trims leading underscore', () => {
    expect(sanitizeFilename('/leading')).toBe('leading');
  });

  it('trims trailing underscore', () => {
    expect(sanitizeFilename('trailing/')).toBe('trailing');
  });

  it('trims both leading and trailing underscores', () => {
    expect(sanitizeFilename('/both/')).toBe('both');
  });

  it('handles empty string', () => {
    expect(sanitizeFilename('')).toBe('');
  });

  it('handles string that is entirely unsafe chars — returns empty', () => {
    expect(sanitizeFilename('///')).toBe('');
  });
});

// ============================================
// comparison-view: bestIndex
// ============================================

import { bestIndex } from '../comparison-view';

describe('bestIndex', () => {
  it('returns 0 for a single-element array', () => {
    expect(bestIndex([42])).toBe(0);
  });

  it('returns index of the largest value — middle', () => {
    expect(bestIndex([1, 5, 3])).toBe(1);
  });

  it('returns index of the largest value — first', () => {
    expect(bestIndex([10, 2, 8])).toBe(0);
  });

  it('returns index of the largest value — last', () => {
    expect(bestIndex([1, 2, 10])).toBe(2);
  });

  it('returns first index on ties (> not >=, so first wins)', () => {
    expect(bestIndex([5, 5, 5])).toBe(0);
  });

  it('returns first occurrence when multiple tie for max', () => {
    expect(bestIndex([1, 5, 5])).toBe(1);
  });

  it('handles all same values — returns 0', () => {
    expect(bestIndex([3, 3, 3, 3])).toBe(0);
  });

  it('handles two-element array — second wins', () => {
    expect(bestIndex([2, 7])).toBe(1);
  });

  it('handles two-element array — first wins', () => {
    expect(bestIndex([7, 2])).toBe(0);
  });

  it('handles negative values', () => {
    expect(bestIndex([-1, -5, -2])).toBe(0);
  });

  it('handles zero and positive values', () => {
    expect(bestIndex([0, 0, 1])).toBe(2);
  });
});

// Theme functions (getTheme / setTheme / toggleTheme) are tested in
// theme-functions.test.ts, which uses the real storage module without
// the vi.mock('../storage') override applied in this file.
