import { describe, it, expect } from 'vitest';
import { normalize, titleCase, trailerTotalHV, formatTrailerSpec } from '../utils';
import type { Trailer, Lookups, Cargo } from '../types';

describe('normalize', () => {
  it('converts to lowercase', () => {
    expect(normalize('Berlin')).toBe('berlin');
    expect(normalize('PARIS')).toBe('paris');
  });

  it('removes diacritics from accented characters', () => {
    expect(normalize('Córdoba')).toBe('cordoba');
    expect(normalize('Zürich')).toBe('zurich');
    expect(normalize('Malmö')).toBe('malmo');
    expect(normalize('Kraków')).toBe('krakow');
  });

  it('handles combined diacritics', () => {
    expect(normalize('Kögel')).toBe('kogel');
    expect(normalize('Schwarzmüller')).toBe('schwarzmuller');
  });

  it('handles strings with no diacritics', () => {
    expect(normalize('london')).toBe('london');
    expect(normalize('Berlin')).toBe('berlin');
  });

  it('handles empty string', () => {
    expect(normalize('')).toBe('');
  });

  it('preserves non-letter characters', () => {
    expect(normalize('A Coruña')).toBe('a coruna');
    expect(normalize('Cluj-Napoca')).toBe('cluj-napoca');
  });

  it('handles Unicode characters beyond basic Latin', () => {
    // Turkish İ (capital I with dot above) -> NFD strips the dot -> 'istanbul'
    expect(normalize('İstanbul')).toBe('istanbul');
    expect(normalize('Šiauliai')).toBe('siauliai');
  });
});

describe('titleCase', () => {
  it('converts simple game ID to title case', () => {
    expect(titleCase('electronics')).toBe('Electronics');
  });

  it('handles underscore-separated words', () => {
    expect(titleCase('high_value_cargo')).toBe('High Value Cargo');
    expect(titleCase('excluded_cargo')).toBe('Excluded Cargo');
  });

  it('handles single character words', () => {
    expect(titleCase('apples_c')).toBe('Apples C');
  });

  it('handles already capitalized input', () => {
    expect(titleCase('Berlin')).toBe('Berlin');
  });

  it('handles single word', () => {
    expect(titleCase('machinery')).toBe('Machinery');
  });

  it('handles empty string', () => {
    expect(titleCase('')).toBe('');
  });
});

describe('trailerTotalHV', () => {
  function makeTrailer(overrides: Partial<Trailer> = {}): Trailer {
    return {
      id: 'scs.curtainside.single_3',
      name: 'Curtainside',
      body_type: 'curtainside',
      volume: 90,
      chassis_mass: 5000,
      body_mass: 3000,
      gross_weight_limit: 40000,
      length: 13.6,
      chain_type: 'single',
      ownable: true,
      ...overrides,
    };
  }

  function makeCargo(overrides: Partial<Cargo> = {}): Cargo {
    return {
      id: 'electronics',
      name: 'Electronics',
      value: 2.5,
      volume: 1,
      mass: 500,
      fragility: 0,
      fragile: false,
      high_value: false,
      adr_class: 0,
      prob_coef: 1,
      body_types: ['curtainside'],
      groups: [],
      excluded: false,
      ...overrides,
    };
  }

  function makeLookups(
    trailerCargo: [string, Set<string>][],
    cargoEntries: Cargo[],
    units: [string, number][] = [],
  ): Lookups {
    return {
      citiesById: new Map(),
      companiesById: new Map(),
      cargoById: new Map(cargoEntries.map((c) => [c.id, c])),
      trailersById: new Map(),
      cityCompanyMap: new Map(),
      companyCargoMap: new Map(),
      trailerCargoMap: new Map(trailerCargo),
      cargoTrailerMap: new Map(),
      cargoTrailerUnits: new Map(units),
    };
  }

  it('returns 0 for trailer with no compatible cargo', () => {
    const trailer = makeTrailer();
    const lookups = makeLookups([], []);
    expect(trailerTotalHV(trailer, lookups)).toBe(0);
  });

  it('calculates total haul value for single cargo', () => {
    const trailer = makeTrailer();
    const cargo = makeCargo({ value: 2.5 });
    const lookups = makeLookups(
      [['scs.curtainside.single_3', new Set(['electronics'])]],
      [cargo],
      [['electronics:scs.curtainside.single_3', 90]],
    );

    // value * bonus * units = 2.5 * 1.0 * 90 = 225
    expect(trailerTotalHV(trailer, lookups)).toBe(225);
  });

  it('applies fragile bonus (+30%)', () => {
    const trailer = makeTrailer();
    const cargo = makeCargo({ value: 2.0, fragile: true });
    const lookups = makeLookups(
      [['scs.curtainside.single_3', new Set(['electronics'])]],
      [cargo],
      [['electronics:scs.curtainside.single_3', 10]],
    );

    // value * bonus * units = 2.0 * 1.3 * 10 = 26
    expect(trailerTotalHV(trailer, lookups)).toBeCloseTo(26);
  });

  it('applies high_value bonus (+30%)', () => {
    const trailer = makeTrailer();
    const cargo = makeCargo({ value: 5.0, high_value: true });
    const lookups = makeLookups(
      [['scs.curtainside.single_3', new Set(['electronics'])]],
      [cargo],
      [['electronics:scs.curtainside.single_3', 10]],
    );

    // value * bonus * units = 5.0 * 1.3 * 10 = 65
    expect(trailerTotalHV(trailer, lookups)).toBeCloseTo(65);
  });

  it('stacks fragile + high_value bonuses (+60%)', () => {
    const trailer = makeTrailer();
    const cargo = makeCargo({ value: 4.0, fragile: true, high_value: true });
    const lookups = makeLookups(
      [['scs.curtainside.single_3', new Set(['electronics'])]],
      [cargo],
      [['electronics:scs.curtainside.single_3', 10]],
    );

    // value * bonus * units = 4.0 * 1.6 * 10 = 64
    expect(trailerTotalHV(trailer, lookups)).toBeCloseTo(64);
  });

  it('sums across multiple compatible cargoes', () => {
    const trailer = makeTrailer();
    const cargo1 = makeCargo({ id: 'electronics', value: 2.5 });
    const cargo2 = makeCargo({ id: 'glass', name: 'Glass', value: 1.0 });
    const lookups = makeLookups(
      [['scs.curtainside.single_3', new Set(['electronics', 'glass'])]],
      [cargo1, cargo2],
      [
        ['electronics:scs.curtainside.single_3', 90],
        ['glass:scs.curtainside.single_3', 45],
      ],
    );

    // (2.5 * 1 * 90) + (1.0 * 1 * 45) = 225 + 45 = 270
    expect(trailerTotalHV(trailer, lookups)).toBe(270);
  });

  it('skips excluded cargo', () => {
    const trailer = makeTrailer();
    const cargo1 = makeCargo({ id: 'electronics', value: 2.5 });
    const cargo2 = makeCargo({ id: 'excluded_thing', name: 'Excluded', value: 100.0, excluded: true });
    const lookups = makeLookups(
      [['scs.curtainside.single_3', new Set(['electronics', 'excluded_thing'])]],
      [cargo1, cargo2],
      [
        ['electronics:scs.curtainside.single_3', 90],
        ['excluded_thing:scs.curtainside.single_3', 90],
      ],
    );

    // Only electronics counts: 2.5 * 1 * 90 = 225
    expect(trailerTotalHV(trailer, lookups)).toBe(225);
  });

  it('defaults to 1 unit when no cargo_trailer_units entry', () => {
    const trailer = makeTrailer();
    const cargo = makeCargo({ value: 3.0 });
    const lookups = makeLookups(
      [['scs.curtainside.single_3', new Set(['electronics'])]],
      [cargo],
      [], // no units entries
    );

    // value * bonus * units = 3.0 * 1.0 * 1 = 3
    expect(trailerTotalHV(trailer, lookups)).toBe(3);
  });
});

describe('formatTrailerSpec', () => {
  function makeTrailer(overrides: Partial<Trailer> = {}): Trailer {
    return {
      id: 'scs.curtainside.single_3',
      name: 'SCS Curtainside',
      body_type: 'curtainside',
      volume: 90,
      chassis_mass: 5000,
      body_mass: 3000,
      gross_weight_limit: 40000,
      length: 13.6,
      chain_type: 'single',
      ownable: true,
      ...overrides,
    };
  }

  it('formats basic SCS single trailer', () => {
    const spec = formatTrailerSpec(makeTrailer());
    // Brand "Scs", 3-axle, 40t, 13.6m
    expect(spec).toBe('Scs 3-axle 40t 13.6m');
  });

  it('capitalizes brand from trailer ID prefix', () => {
    const spec = formatTrailerSpec(makeTrailer({ id: 'krone.box.single_3' }));
    expect(spec).toContain('Krone');
  });

  it('includes chain type label for doubles', () => {
    const spec = formatTrailerSpec(makeTrailer({
      id: 'scs.curtainside.double_3_2',
      chain_type: 'double',
    }));
    expect(spec).toContain('Double');
    expect(spec).toContain('3+2-axle');
  });

  it('includes HCT label', () => {
    const spec = formatTrailerSpec(makeTrailer({
      id: 'scs.curtainside.hct_3_2_3',
      chain_type: 'hct',
    }));
    expect(spec).toContain('HCT');
    expect(spec).toContain('3+2+3-axle');
  });

  it('includes B-double label', () => {
    const spec = formatTrailerSpec(makeTrailer({
      id: 'scs.curtainside.bdouble_2_2',
      chain_type: 'b_double',
    }));
    expect(spec).toContain('B-double');
    expect(spec).toContain('2+2-axle');
  });

  it('formats weight in tonnes', () => {
    const spec = formatTrailerSpec(makeTrailer({ gross_weight_limit: 60000 }));
    expect(spec).toContain('60t');
  });

  it('includes length in meters', () => {
    const spec = formatTrailerSpec(makeTrailer({ length: 15.0 }));
    expect(spec).toContain('15m');
  });
});
