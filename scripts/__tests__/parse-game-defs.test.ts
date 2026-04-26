import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildAtsCityDlcMap } from '../parse-game-defs';

describe('buildAtsCityDlcMap', () => {
  it('returns empty object for empty input', () => {
    expect(buildAtsCityDlcMap([])).toEqual({});
  });

  it('omits cities whose country is not in ATS_STATE_TO_DLC (base-game state)', () => {
    // California is the ATS base game (no DLC) — its cities must not appear.
    const result = buildAtsCityDlcMap([
      { id: 'los_angeles', country: 'california' },
      { id: 'sacramento', country: 'california' },
    ]);
    expect(result).toEqual({});
  });

  it('groups cities by their state\'s DLC and sorts each group alphabetically', () => {
    // texas, oklahoma are DLC states; the sorted order verifies the .sort() call.
    const result = buildAtsCityDlcMap([
      { id: 'houston', country: 'texas' },
      { id: 'dallas', country: 'texas' },
      { id: 'tulsa', country: 'oklahoma' },
      { id: 'austin', country: 'texas' },
    ]);
    expect(result).toMatchObject({
      texas: ['austin', 'dallas', 'houston'],
      oklahoma: ['tulsa'],
    });
  });

  it('mixes mapped and unmapped cities — only mapped survive', () => {
    const result = buildAtsCityDlcMap([
      { id: 'los_angeles', country: 'california' }, // base, dropped
      { id: 'phoenix', country: 'arizona' },        // base, dropped
      { id: 'denver', country: 'colorado' },        // DLC
    ]);
    // exactly one DLC key present; california/arizona contribute nothing
    expect(Object.keys(result)).toHaveLength(1);
    expect(Object.values(result)[0]).toEqual(['denver']);
  });
});

describe('public/data/ats/game-defs.json schema invariants', () => {
  const fixturePath = join(process.cwd(), 'public', 'data', 'ats', 'game-defs.json');

  it('has the expected top-level shape', () => {
    const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    expect(data).toMatchObject({
      cargo: expect.any(Object),
      trailers: expect.any(Object),
      companies: expect.any(Object),
      cities: expect.any(Object),
      countries: expect.any(Object),
      economy: expect.any(Object),
      trucks: expect.any(Array),
      dlc: expect.any(Object),
    });
    expect(data.dlc).toMatchObject({
      trailer_dlcs: expect.any(Object),
      map_dlcs: expect.any(Object),
      city_dlc_map: expect.any(Object),
      garage_cities: expect.any(Array),
    });
  });

  it('city_dlc_map keys are a subset of map_dlcs keys (no orphan DLC references)', () => {
    const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    const mapDlcKeys = new Set(Object.keys(data.dlc.map_dlcs));
    const cityDlcKeys = Object.keys(data.dlc.city_dlc_map);
    const orphans = cityDlcKeys.filter(k => !mapDlcKeys.has(k));
    expect(orphans).toEqual([]);
    // Also assert every value is a string[] (shape, per AC-3.15)
    for (const v of Object.values(data.dlc.city_dlc_map)) {
      expect(Array.isArray(v)).toBe(true);
      for (const cityId of v as unknown[]) expect(typeof cityId).toBe('string');
    }
  });

  it('every cities[*].country exists as a key in countries', () => {
    const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    const countryKeys = new Set(Object.keys(data.countries));
    const orphans = Object.values(data.cities as Record<string, { country: string }>)
      .map(c => c.country)
      .filter(c => !countryKeys.has(c));
    expect(orphans).toEqual([]);
  });
});
