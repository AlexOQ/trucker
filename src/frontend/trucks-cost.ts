import type { GameDefs } from './types';

type Truck = GameDefs['trucks'][number];
type Cabin = NonNullable<Truck['cabins']>[number];
type Chassis = Truck['chassis'][number];
type Engine = Truck['engines'][number];
type Transmission = Truck['transmissions'][number];
type Paint = NonNullable<Truck['paints']>[number];

export interface MinCostConfig {
  cabin: Cabin;
  chassis: Chassis;
  engine: Engine;
  transmission: Transmission;
  paint: Paint | null;        // null when truck has no priced paint
  total: number;
  /** Max unlock across selected components — level required to buy this config. */
  levelFloor: number;
}

/**
 * Some chassis are factory/AI-default parts, not player-buyable shop options —
 * e.g. the ATS Kenworth W900 "medium II 6x4" and the Peterbilt 389 "mid"/"mid2".
 * SCS hides these from the customization UI with an astronomical `unlock`
 * sentinel (observed 13,000,000 / 130,000,000) and `price: 0`. Real parts unlock
 * at driver levels (0–30 across the current ETS2+ATS data; the Truck Simulator
 * Wiki's W900 chassis list has no separate buyable "medium II"). A part at or
 * above this floor can't be bought, so it must not win a cheapest-config nor
 * show in the component listings. (#298 — validated against the def files, the
 * Truck Simulator Wiki, and the SCS modding docs for accessory_chassis_data.)
 */
export const UNBUYABLE_UNLOCK_FLOOR = 1_000_000;

/** False for hidden factory/AI-default variants players can't buy (see UNBUYABLE_UNLOCK_FLOOR). */
export function isSelectable(c: { unlock: number }): boolean {
  return c.unlock < UNBUYABLE_UNLOCK_FLOOR;
}

/**
 * Cheapest selectable item by price, ties broken by lowest unlock level so the
 * earliest-available wins when prices match. Disabled sentinels are excluded.
 */
export function cheapest<T extends { price: number; unlock: number }>(items: T[]): T | null {
  const selectable = items.filter(isSelectable);
  if (selectable.length === 0) return null;
  let best = selectable[0];
  for (let i = 1; i < selectable.length; i++) {
    const c = selectable[i];
    if (c.price < best.price || (c.price === best.price && c.unlock < best.unlock)) {
      best = c;
    }
  }
  return best;
}

/**
 * Cheapest cabin/chassis pair respecting `cabin.suitable_for[]`. An empty
 * suitable_for[] means "fits any chassis on this truck".
 */
export function cheapestCabinChassis(truck: Truck): { cabin: Cabin; chassis: Chassis } | null {
  let best: { cabin: Cabin; chassis: Chassis; total: number } | null = null;
  for (const cabin of (truck.cabins ?? []).filter(isSelectable)) {
    const compatible = cabin.suitable_for.length === 0
      ? truck.chassis
      : truck.chassis.filter((c) => cabin.suitable_for.includes(c.id));
    const fits = compatible.filter(isSelectable);
    for (const chassis of fits) {
      const total = cabin.price + chassis.price;
      if (!best || total < best.total) best = { cabin, chassis, total };
    }
  }
  return best ? { cabin: best.cabin, chassis: best.chassis } : null;
}

/** Humanise lowercase brand IDs like "volvo", "renault_t" → "Volvo", "Renault T". */
export function brandLabel(brand: string): string {
  return brand.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Humanise underscore-separated model IDs like "fh_2024" → "Fh 2024". */
export function modelLabel(model: string): string {
  return model.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Strip `@@token@@` locale-string placeholders for display. The parser doesn't
 * resolve locale strings, so cabin/paint names like "@@cabin_aero_sleeper@@"
 * leak through. Return a stripped, title-cased fallback rather than raw tokens;
 * pass non-placeholder strings through unchanged.
 */
export function displayName(raw: string): string {
  const m = raw.match(/^@@(.+)@@$/);
  if (!m) return raw;
  return m[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function computeMinCost(truck: Truck): MinCostConfig | null {
  const cc = cheapestCabinChassis(truck);
  const engine = cheapest(truck.engines);
  const transmission = cheapest(truck.transmissions);
  if (!cc || !engine || !transmission) return null;

  const paint = cheapest(truck.paints ?? []);
  const total = cc.cabin.price + cc.chassis.price + engine.price + transmission.price
    + (paint?.price ?? 0);
  const levelFloor = Math.max(
    cc.cabin.unlock, cc.chassis.unlock, engine.unlock, transmission.unlock,
    paint?.unlock ?? 0,
  );
  return { cabin: cc.cabin, chassis: cc.chassis, engine, transmission, paint, total, levelFloor };
}
