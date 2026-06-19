import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildAtsCityDlcMap,
  roundPriceUpToThousand,
  deriveTrailerIdFromDefName,
  buildCompanyNameMap,
  formatCompanyName,
} from '../parse-game-defs';

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

describe('buildCompanyNameMap', () => {
  it('maps company id to the def name, stripping the unit prefix', () => {
    const map = buildCompanyNameMap([
      { type: 'company_permanent', name: 'company.permanent.ttk_bg', props: { name: 'ТТК' } },
      { type: 'company_permanent', name: 'company.permanent.cont_port_fr', props: { name: 'Port de Conteneur' } },
    ]);
    expect(map.get('ttk_bg')).toBe('ТТК');
    expect(map.get('cont_port_fr')).toBe('Port de Conteneur');
  });

  it('ignores units that are not company_permanent', () => {
    const map = buildCompanyNameMap([
      { type: 'cargo_data', name: 'cargo.acetylene', props: { name: 'Acetylene' } },
    ]);
    expect(map.size).toBe(0);
  });

  it('skips empty names and unresolved @@token@@ refs so the caller falls back', () => {
    const map = buildCompanyNameMap([
      { type: 'company_permanent', name: 'company.permanent.tokened', props: { name: '@@some_token@@' } },
      { type: 'company_permanent', name: 'company.permanent.blank', props: { name: '   ' } },
      { type: 'company_permanent', name: 'company.permanent.missing', props: {} },
    ]);
    expect(map.size).toBe(0);
  });

  it('last definition wins for a duplicate id (base + DLC override)', () => {
    const map = buildCompanyNameMap([
      { type: 'company_permanent', name: 'company.permanent.acc', props: { name: 'ACC base' } },
      { type: 'company_permanent', name: 'company.permanent.acc', props: { name: 'ACC dlc' } },
    ]);
    expect(map.get('acc')).toBe('ACC dlc');
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

    it('every cargo fragile flag matches the fragility >= 0.7 gate (#269)', () => {
      const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
      const cargo = Object.values(data.cargo) as Array<{ fragility: number; fragile: boolean }>;
      expect(cargo.length).toBeGreaterThan(0);
      const mismatches = cargo.filter(c => c.fragile !== (c.fragility >= 0.7));
      expect(mismatches).toEqual([]);
      // The 0.5–0.69 band is the empirically-confirmed non-fragile side of the gate;
      // it must exist and stay non-fragile (guards against a silent revert to >= 0.5).
      const boundary = cargo.filter(c => c.fragility >= 0.5 && c.fragility < 0.7);
      expect(boundary.length).toBeGreaterThan(0);
      expect(boundary.every(c => !c.fragile)).toBe(true);
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
    //
    // Regression guard (ets2 only): canonical source must have at least one
    // truck with non-empty cabins so a silent parser-walk break (directory
    // rename, unit-type change) doesn't ship valid-but-empty arrays.
    if (game === 'ets2') {
      it('at least one truck has populated cabins (canary against silent parser regression)', () => {
        const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
        const hasCabins = (data.trucks as Array<Record<string, unknown>>).some(
          (t) => Array.isArray(t.cabins) && (t.cabins as unknown[]).length > 0,
        );
        expect(hasCabins).toBe(true);
      });
    }

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

    // #267: company names come from the def `name` field, not formatCompanyName(id).
    // ets2-only: the bundled ATS game-defs are donated (no full ATS def dump here),
    // so ATS company names stay title-cased until an ATS reparse with the fixed
    // parser. Only a minority of ets2 companies lack a def name file and fall back
    // to the id, so the localized majority guards against a parser-walk regression
    // silently reverting every name to titlecase(id).
    if (game === 'ets2') {
      it('most company names are def strings, not mechanical title-case of the id (#267)', () => {
        const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
        const companies = Object.entries(data.companies as Record<string, { name: string }>);
        expect(companies.length).toBeGreaterThan(0);
        const localized = companies.filter(([id, c]) => c.name !== formatCompanyName(id));
        expect(localized.length).toBeGreaterThan(companies.length * 0.5);
      });

      it('ttk_bg resolves to a real def name (non-ASCII), not the title-cased id (#267)', () => {
        const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
        const name = (data.companies.ttk_bg as { name: string }).name;
        // Structural, not a pinned literal: a real game name that is non-ASCII
        // (Cyrillic) and differs from formatCompanyName(id) ("Ttk Bg").
        expect(name).not.toBe(formatCompanyName('ttk_bg'));
        expect([...name].some((ch) => ch.charCodeAt(0) > 127)).toBe(true);
      });
    }
  });
}

runSchemaInvariantsForGame('ats');
runSchemaInvariantsForGame('ets2');
