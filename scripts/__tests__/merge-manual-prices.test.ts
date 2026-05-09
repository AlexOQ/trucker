import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mergeManualPrices } from '../merge-manual-prices';

interface T { id: string; price: number; }

let dir: string;
const manualPath = () => join(dir, 'manual-prices.json');

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'manual-prices-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writeManual(prices: Record<string, { price: number }>, overrides: Partial<{ game: string; schema_version: number }> = {}) {
  writeFileSync(manualPath(), JSON.stringify({
    game: overrides.game ?? 'ets2',
    schema_version: overrides.schema_version ?? 1,
    prices: Object.fromEntries(Object.entries(prices).map(([id, p]) => [id, {
      price: p.price, source_pack: 'test', last_verified_game_version: '1.59',
    }])),
  }));
}

describe('mergeManualPrices', () => {
  it('returns input unchanged when manual file is absent', () => {
    const trailers: T[] = [{ id: 'a', price: 0 }];
    const r = mergeManualPrices(trailers, '/no/such/file.json', 'ets2');
    expect(r.applied).toBe(0);
    expect(r.trailers).toEqual(trailers);
  });

  it('applies a manual price to a price=0 trailer', () => {
    writeManual({ a: { price: 142000 } });
    const r = mergeManualPrices([{ id: 'a', price: 0 }, { id: 'b', price: 50000 }], manualPath(), 'ets2');
    expect(r.applied).toBe(1);
    expect(r.trailers.find(t => t.id === 'a')!.price).toBe(142000);
    expect(r.trailers.find(t => t.id === 'b')!.price).toBe(50000);
  });

  it('does not mutate the input array', () => {
    writeManual({ a: { price: 142000 } });
    const trailers: T[] = [{ id: 'a', price: 0 }];
    mergeManualPrices(trailers, manualPath(), 'ets2');
    expect(trailers[0].price).toBe(0);
  });

  it('records unknownIds for manual entries with no matching trailer', () => {
    writeManual({ ghost: { price: 99000 } });
    const r = mergeManualPrices([{ id: 'a', price: 0 }], manualPath(), 'ets2');
    expect(r.applied).toBe(0);
    expect(r.unknownIds).toEqual(['ghost']);
  });

  it('overrides parser-priced trailers and records the original in overrides', () => {
    writeManual({ a: { price: 100 } });
    const r = mergeManualPrices([{ id: 'a', price: 50000 }], manualPath(), 'ets2');
    expect(r.applied).toBe(0);
    expect(r.overrides).toEqual([{ id: 'a', parserPrice: 50000, manualPrice: 100 }]);
    expect(r.trailers[0].price).toBe(100);
  });

  it('throws when game tag mismatches expected game', () => {
    writeManual({ a: { price: 1 } }, { game: 'ats' });
    expect(() => mergeManualPrices([{ id: 'a', price: 0 }], manualPath(), 'ets2'))
      .toThrow(/game=ats but parser running with --game ets2/);
  });

  it('throws on unknown schema_version', () => {
    writeManual({ a: { price: 1 } }, { schema_version: 2 });
    expect(() => mergeManualPrices([{ id: 'a', price: 0 }], manualPath(), 'ets2'))
      .toThrow(/schema_version=2/);
  });

  it('handles missing or empty `prices` field gracefully', () => {
    writeFileSync(manualPath(), JSON.stringify({ game: 'ets2', schema_version: 1 }));
    const r = mergeManualPrices([{ id: 'a', price: 0 }], manualPath(), 'ets2');
    expect(r.applied).toBe(0);
    expect(r.unknownIds).toEqual([]);
    expect(r.overrides).toEqual([]);
  });
});
