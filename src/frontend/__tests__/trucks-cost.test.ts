import { describe, it, expect } from 'vitest';
import { cheapest, cheapestCabinChassis, computeMinCost } from '../trucks-cost';
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
});
