import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AllData } from '../types';

// The bundled ATS data turns the #340 mass cap on through its `overweight` permits (1.62.1.1, #358).
// A reparse that loses them switches the cap off for every ATS score while every synthetic test still passes.
const PUBLIC = path.join(__dirname, '../../../public');

let data: AllData;
let buildLookups: typeof import('../lookups').buildLookups;
let buildCityDepotProfiles: typeof import('../optimizer').buildCityDepotProfiles;

beforeAll(async () => {
  const realFetch = globalThis.fetch;
  localStorage.setItem('trucker-game', 'ats');
  vi.resetModules();
  globalThis.fetch = (async (p: string) => {
    const f = path.join(PUBLIC, p);
    if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf-8')) };
  }) as unknown as typeof fetch;
  try {
    data = await (await import('../loader')).loadAllData();
    ({ buildLookups } = await import('../lookups'));
    ({ buildCityDepotProfiles } = await import('../optimizer'));
  } finally {
    globalThis.fetch = realFetch;
    localStorage.removeItem('trucker-game');
  }
});

/** Every (cargo, body type) haul value at a city's first depot of each company. */
function hauls(d: AllData, cityId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const depot of buildCityDepotProfiles(cityId, buildLookups(d)) ?? []) {
    for (const item of depot.cargo) {
      for (const [body, hv] of Object.entries(item.bodyHV)) out.set(`${item.cargoId}|${body}`, hv);
    }
  }
  return out;
}

describe('ATS bundled data: mass cap (#340, #358)', () => {
  it('carries overweight permits, so the cap is active', () => {
    expect(data.cargo.some((c) => c.overweight === true)).toBe(true);
    expect(buildLookups(data).massLimitsActive).toBe(true);
  });

  it('caps an unpermitted haul in Oklahoma and leaves permitted cargo alone', () => {
    const inert: AllData = { ...data, cargo: data.cargo.map((c) => ({ ...c, overweight: false })) };
    const capped = hauls(data, 'oklahoma_cit');
    const free = hauls(inert, 'oklahoma_cit');
    const permitted = new Set(data.cargo.filter((c) => c.overweight).map((c) => c.id));

    const lowered = [...capped].filter(([k, hv]) => hv < (free.get(k) ?? 0));
    expect(lowered.length).toBeGreaterThan(0);
    for (const [k] of lowered) expect(permitted.has(k.split('|')[0])).toBe(false);
  });
});
