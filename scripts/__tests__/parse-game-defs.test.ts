import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildAtsCityDlcMap, roundPriceUpToThousand, deriveTrailerIdFromDefName } from '../parse-game-defs';

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

describe('roundPriceUpToThousand', () => {
  it('rounds 0 to 0', () => {
    expect(roundPriceUpToThousand(0)).toBe(0);
  });

  it('rounds non-zero sub-1000 sums up to 1000', () => {
    expect(roundPriceUpToThousand(1)).toBe(1000);
    expect(roundPriceUpToThousand(999)).toBe(1000);
  });

  it('leaves exact multiples of 1000 in place (no spurious round-up)', () => {
    expect(roundPriceUpToThousand(1000)).toBe(1000);
    expect(roundPriceUpToThousand(34000)).toBe(34000);
  });

  it('rounds anything past a thousand boundary up to the next thousand', () => {
    expect(roundPriceUpToThousand(1001)).toBe(2000);
    expect(roundPriceUpToThousand(33500)).toBe(34000);
    expect(roundPriceUpToThousand(1234567)).toBe(1235000);
  });
});

describe('deriveTrailerIdFromDefName', () => {
  it('strips the leading "trailer_def." prefix', () => {
    expect(deriveTrailerIdFromDefName('trailer_def.feldbinder.eut.silo')).toBe('feldbinder.eut.silo');
  });

  it('returns the name unchanged when no prefix is present', () => {
    expect(deriveTrailerIdFromDefName('feldbinder.eut.silo')).toBe('feldbinder.eut.silo');
  });

  it('only strips the leading prefix, never a mid-name occurrence', () => {
    expect(deriveTrailerIdFromDefName('trailer_def.foo.trailer_def.bar')).toBe('foo.trailer_def.bar');
  });
});

function runSchemaInvariantsForGame(game: 'ats' | 'ets2') {
  describe(`public/data/${game}/game-defs.json schema invariants`, () => {
    const fixturePath = join(process.cwd(), 'public', 'data', game, 'game-defs.json');

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

    // Forward-compatible: cabins[] and paints[] arrive with #252 reparse.
    // Snapshots parsed before that don't have them; computeMinCost gracefully
    // falls back to []. Once present, asserts shape so we don't accidentally
    // ship malformed entries.
    it('truck cabin/paint fields, when present, have the documented shape', () => {
      const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
      for (const truck of data.trucks as Array<Record<string, unknown>>) {
        if (Array.isArray(truck.cabins)) {
          for (const cabin of truck.cabins as Array<Record<string, unknown>>) {
            expect(typeof cabin.id).toBe('string');
            expect(typeof cabin.price).toBe('number');
            expect(cabin.price as number).toBeGreaterThanOrEqual(0);
            expect(typeof cabin.unlock).toBe('number');
            expect(Array.isArray(cabin.suitable_for)).toBe(true);
            for (const chassisRef of cabin.suitable_for as unknown[]) {
              expect(typeof chassisRef).toBe('string');
            }
          }
        }
        if (Array.isArray(truck.paints)) {
          for (const paint of truck.paints as Array<Record<string, unknown>>) {
            expect(typeof paint.id).toBe('string');
            expect(typeof paint.price).toBe('number');
            expect(paint.price as number).toBeGreaterThanOrEqual(0);
            expect(typeof paint.unlock).toBe('number');
          }
        }
      }
    });

    it('trailer pricing fields, when present, are non-negative numbers', () => {
      const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
      for (const [, t] of Object.entries(data.trailers as Record<string, { price?: unknown; level_floor?: unknown }>)) {
        if (t.price !== undefined) {
          expect(typeof t.price).toBe('number');
          expect(t.price as number).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(t.price as number)).toBe(true);
        }
        if (t.level_floor !== undefined) {
          expect(typeof t.level_floor).toBe('number');
          expect(t.level_floor as number).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(t.level_floor as number)).toBe(true);
        }
      }
    });
  });
}

runSchemaInvariantsForGame('ats');
runSchemaInvariantsForGame('ets2');
