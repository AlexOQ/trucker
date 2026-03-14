import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseCompareHash,
  buildCompareHash,
  setComparisonCities,
  getComparisonCityIds,
  toggleComparison,
  isInComparison,
  MAX_COMPARE,
} from '../comparison-state.js';

describe('parseCompareHash', () => {
  it('parses valid hash with multiple IDs', () => {
    expect(parseCompareHash('#compare=berlin,paris,lyon')).toEqual(['berlin', 'paris', 'lyon']);
  });

  it('returns empty array for bare #compare', () => {
    expect(parseCompareHash('#compare')).toEqual([]);
  });

  it('returns empty array for #compare= with no IDs', () => {
    expect(parseCompareHash('#compare=')).toEqual([]);
  });

  it('returns empty array for unrelated hash', () => {
    expect(parseCompareHash('#city-berlin')).toEqual([]);
    expect(parseCompareHash('')).toEqual([]);
  });

  it('filters empty segments from trailing comma', () => {
    expect(parseCompareHash('#compare=berlin,paris,')).toEqual(['berlin', 'paris']);
  });

  it('handles single city ID', () => {
    expect(parseCompareHash('#compare=berlin')).toEqual(['berlin']);
  });
});

describe('setComparisonCities', () => {
  beforeEach(() => {
    // Clear by setting empty
    setComparisonCities([]);
  });

  it('populates comparison set from IDs', () => {
    setComparisonCities(['berlin', 'paris', 'lyon']);
    expect(getComparisonCityIds()).toEqual(['berlin', 'paris', 'lyon']);
  });

  it('limits to MAX_COMPARE cities', () => {
    setComparisonCities(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(getComparisonCityIds()).toHaveLength(MAX_COMPARE);
  });

  it('filters invalid IDs when validCityIds provided', () => {
    const valid = new Set(['berlin', 'paris']);
    setComparisonCities(['berlin', 'fake', 'paris', 'invalid'], valid);
    expect(getComparisonCityIds()).toEqual(['berlin', 'paris']);
  });

  it('accepts all IDs when no validCityIds provided', () => {
    setComparisonCities(['anything', 'goes']);
    expect(getComparisonCityIds()).toEqual(['anything', 'goes']);
  });

  it('clears previous state', () => {
    setComparisonCities(['berlin']);
    setComparisonCities(['paris']);
    expect(getComparisonCityIds()).toEqual(['paris']);
  });

  it('deduplicates via Set', () => {
    setComparisonCities(['berlin', 'berlin', 'paris']);
    expect(getComparisonCityIds()).toEqual(['berlin', 'paris']);
  });
});

describe('buildCompareHash', () => {
  beforeEach(() => {
    setComparisonCities([]);
  });

  it('returns #compare for empty set', () => {
    expect(buildCompareHash()).toBe('#compare');
  });

  it('returns #compare=id1,id2 for populated set', () => {
    setComparisonCities(['berlin', 'paris']);
    expect(buildCompareHash()).toBe('#compare=berlin,paris');
  });
});

describe('toggleComparison', () => {
  beforeEach(() => {
    setComparisonCities([]);
  });

  it('adds a city and returns true', () => {
    expect(toggleComparison('berlin')).toBe(true);
    expect(isInComparison('berlin')).toBe(true);
  });

  it('removes a city and returns false', () => {
    toggleComparison('berlin');
    expect(toggleComparison('berlin')).toBe(false);
    expect(isInComparison('berlin')).toBe(false);
  });

  it('rejects when at MAX_COMPARE', () => {
    for (let i = 0; i < MAX_COMPARE; i++) {
      toggleComparison(`city${i}`);
    }
    expect(toggleComparison('overflow')).toBe(false);
    expect(isInComparison('overflow')).toBe(false);
  });
});
