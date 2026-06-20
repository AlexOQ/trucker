import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cheapest, cheapestCabinChassis, computeMinCost, isSelectable, UNBUYABLE_UNLOCK_FLOOR,
  brandLabel, modelLabel, displayName,
} from '../trucks-cost';
import type { GameDefs } from '../types';

type Truck = GameDefs['trucks'][number];

function mkTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'volvo.fh_2024', brand: 'volvo', model: 'fh_2024',
    engines: [], transmissions: [], chassis: [], cabins: [], paints: [],
    ...overrides,
  };
}

describe('cheapest', () => {
  it('returns null on empty array', () => {
    expect(cheapest([])).toBeNull();
  });

  it('picks lowest price', () => {
    const items = [{ price: 50, unlock: 0 }, { price: 20, unlock: 0 }, { price: 30, unlock: 0 }];
    expect(cheapest(items)?.price).toBe(20);
  });

  it('breaks price ties by lowest unlock — earlier-available wins', () => {
    const items = [{ price: 10, unlock: 5 }, { price: 10, unlock: 2 }, { price: 10, unlock: 8 }];
    expect(cheapest(items)?.unlock).toBe(2);
  });

  it('excludes hidden factory/AI variants with a sentinel unlock (#298)', () => {
    // The $0 part would win on price if not filtered; it's a hidden, unbuyable chassis.
    const items = [{ price: 0, unlock: 13_000_000 }, { price: 30, unlock: 0 }];
    expect(cheapest(items)?.price).toBe(30);
  });

  it('returns null when every item is an unbuyable sentinel (#298)', () => {
    expect(cheapest([{ price: 0, unlock: 13_000_000 }])).toBeNull();
  });
});

describe('isSelectable', () => {
  it('accepts real driver-level unlocks, rejects sentinel floors (#298)', () => {
    expect(isSelectable({ unlock: 0 })).toBe(true);
    expect(isSelectable({ unlock: 30 })).toBe(true);
    expect(isSelectable({ unlock: UNBUYABLE_UNLOCK_FLOOR })).toBe(false);
    expect(isSelectable({ unlock: 13_000_000 })).toBe(false);
  });
});

describe('cheapestCabinChassis', () => {
  it('returns null when truck has no cabin or no chassis', () => {
    expect(cheapestCabinChassis(mkTruck())).toBeNull();
    expect(cheapestCabinChassis(mkTruck({
      cabins: [{ id: 'c', name: '', price: 1, unlock: 0, suitable_for: [] }],
    }))).toBeNull();
  });

  it('returns null when no cabin/chassis pair is compatible', () => {
    const truck = mkTruck({
      cabins: [{ id: 'cab1', name: '', price: 1, unlock: 0, suitable_for: ['chs.other'] }],
      chassis: [{ id: 'chs.mine', name: '', axle_config: '4x2', tank_size: 0, price: 1, unlock: 0 }],
    });
    expect(cheapestCabinChassis(truck)).toBeNull();
  });

  it('empty suitable_for[] fits any chassis', () => {
    const truck = mkTruck({
      cabins: [{ id: 'cab', name: '', price: 10, unlock: 0, suitable_for: [] }],
      chassis: [
        { id: 'a', name: '', axle_config: '4x2', tank_size: 0, price: 30, unlock: 0 },
        { id: 'b', name: '', axle_config: '6x4', tank_size: 0, price: 20, unlock: 0 },
      ],
    });
    expect(cheapestCabinChassis(truck)?.chassis.id).toBe('b');
  });

  it('skips a hidden factory chassis (sentinel unlock), picking the buyable one (#298)', () => {
    // Mirrors the real ATS W900/389: a $0 chassis hidden via a sentinel unlock
    // sits alongside the real buyable chassis. Price-first would grab the $0 one.
    const truck = mkTruck({
      cabins: [{ id: 'cab', name: '', price: 10, unlock: 0, suitable_for: [] }],
      chassis: [
        { id: 'hidden', name: '', axle_config: '6x4', tank_size: 0, price: 0, unlock: 13_000_000 },
        { id: 'real', name: '', axle_config: '6x4', tank_size: 0, price: 19100, unlock: 0 },
      ],
    });
    expect(cheapestCabinChassis(truck)?.chassis.id).toBe('real');
  });

  it('respects suitable_for[] and finds globally cheapest valid pair, not greedy per-cabin', () => {
    // Trap: cheapest cabin (5) only fits expensive chassis (100). Pricier cabin (10) fits
    // cheap chassis (20). Greedy "cheapest cabin first" picks 5+100=105; correct min is 10+20=30.
    const truck = mkTruck({
      cabins: [
        { id: 'cheap_cabin', name: '', price: 5, unlock: 0, suitable_for: ['expensive'] },
        { id: 'mid_cabin', name: '', price: 10, unlock: 0, suitable_for: ['cheap'] },
      ],
      chassis: [
        { id: 'cheap', name: '', axle_config: '4x2', tank_size: 0, price: 20, unlock: 0 },
        { id: 'expensive', name: '', axle_config: '6x4', tank_size: 0, price: 100, unlock: 0 },
      ],
    });
    const result = cheapestCabinChassis(truck)!;
    expect(result.cabin.id).toBe('mid_cabin');
    expect(result.chassis.id).toBe('cheap');
  });
});

describe('brandLabel', () => {
  it('title-cases simple lowercase brand ids', () => {
    expect(brandLabel('volvo')).toBe('Volvo');
    expect(brandLabel('scania')).toBe('Scania');
  });
  it('humanises underscore-separated multi-word brands', () => {
    expect(brandLabel('renault_t')).toBe('Renault T');
    expect(brandLabel('mercedes_benz')).toBe('Mercedes Benz');
  });
});

describe('modelLabel', () => {
  it('replaces underscores with spaces and capitalises each word', () => {
    expect(modelLabel('fh_2024')).toBe('Fh 2024');
    expect(modelLabel('actros2014')).toBe('Actros2014');
    expect(modelLabel('r_2024_new_gen')).toBe('R 2024 New Gen');
  });
});

describe('displayName', () => {
  it('strips @@token@@ wrappers and humanises the content', () => {
    expect(displayName('@@cabin_aero_sleeper@@')).toBe('Cabin Aero Sleeper');
    expect(displayName('@@pj_black_knight@@')).toBe('Pj Black Knight');
  });
  it('passes plain strings through unchanged', () => {
    expect(displayName('Plain Label')).toBe('Plain Label');
    expect(displayName('')).toBe('');
  });
  it('only strips outer @@…@@ — does not touch mid-string occurrences', () => {
    expect(displayName('prefix @@token@@ suffix')).toBe('prefix @@token@@ suffix');
  });
});

describe('computeMinCost', () => {
  const baseTruck = mkTruck({
    cabins: [{ id: 'cab', name: '', price: 15000, unlock: 0, suitable_for: ['chs'] }],
    chassis: [{ id: 'chs', name: '', axle_config: '4x2', tank_size: 0, price: 25000, unlock: 0 }],
    engines: [
      { id: 'eng_a', name: '', torque: 0, volume: 0, rpm_limit: 0, price: 8000, unlock: 0 },
      { id: 'eng_b', name: '', torque: 0, volume: 0, rpm_limit: 0, price: 5000, unlock: 3 },
    ],
    transmissions: [
      { id: 'tr', name: '', differential_ratio: 0, forward_gears: 12, reverse_gears: 2, retarder: 0, price: 4000, unlock: 0 },
    ],
    paints: [
      { id: 'p_a', name: '', price: 5200, unlock: 0 },
      { id: 'p_b', name: '', price: 2600, unlock: 0 },
    ],
  });

  it('sums the cheapest valid combination', () => {
    const r = computeMinCost(baseTruck)!;
    // 15000 + 25000 + 5000 + 4000 + 2600 = 51600
    expect(r.total).toBe(51600);
    expect(r.engine.id).toBe('eng_b');
    expect(r.paint?.id).toBe('p_b');
  });

  it('returns max unlock across chosen components as levelFloor', () => {
    const r = computeMinCost(baseTruck)!;
    expect(r.levelFloor).toBe(3); // eng_b unlock is 3, all others 0
  });

  it('returns null when any required category is empty', () => {
    expect(computeMinCost(mkTruck({ ...baseTruck, engines: [] }))).toBeNull();
    expect(computeMinCost(mkTruck({ ...baseTruck, transmissions: [] }))).toBeNull();
    expect(computeMinCost(mkTruck({ ...baseTruck, cabins: [] }))).toBeNull();
  });

  it('treats missing paints as cost 0 (paint folder optional)', () => {
    const noPaint = mkTruck({ ...baseTruck, paints: [] });
    const r = computeMinCost(noPaint)!;
    expect(r.paint).toBeNull();
    expect(r.total).toBe(15000 + 25000 + 5000 + 4000);
  });

  it('ignores a hidden factory chassis — no impossible levelFloor (#298)', () => {
    const truck = mkTruck({
      ...baseTruck,
      cabins: [{ id: 'cab', name: '', price: 15000, unlock: 0, suitable_for: [] }],
      chassis: [
        { id: 'hidden', name: '', axle_config: '6x4', tank_size: 0, price: 0, unlock: 13_000_000 },
        { id: 'real', name: '', axle_config: '4x2', tank_size: 0, price: 25000, unlock: 0 },
      ],
    });
    const r = computeMinCost(truck)!;
    expect(r.chassis.id).toBe('real');
    expect(r.levelFloor).toBeLessThan(UNBUYABLE_UNLOCK_FLOOR);
  });
});

// #298: the bundled data must not surface unbuyable builds. A truck whose
// cheapest config requires a sentinel-unlock (hidden factory/AI) part would show
// an impossible "min cost … unlock 13,000,000" row. This guards both games'
// committed game-defs.json against that regression.
describe('committed data has no unbuyable cheapest config (#298)', () => {
  for (const game of ['ats', 'ets2'] as const) {
    it(`${game}: every rendered truck's cheapest config is actually buyable`, () => {
      const data = JSON.parse(
        readFileSync(join(process.cwd(), 'public', 'data', game, 'game-defs.json'), 'utf-8'),
      ) as { trucks: Truck[] };
      expect(data.trucks.length).toBeGreaterThan(0);
      for (const truck of data.trucks) {
        const config = computeMinCost(truck);
        if (!config) continue; // no buyable config → truck doesn't render; fine
        expect(config.levelFloor, `${truck.id} levelFloor`).toBeLessThan(UNBUYABLE_UNLOCK_FLOOR);
      }
    });
  }
});
