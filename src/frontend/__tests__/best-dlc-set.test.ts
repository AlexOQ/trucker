import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The DLC page highlights a precomputed best set (scripts/gen-best-dlc-set.mts). It goes stale when
// game-defs.json is reparsed, so it must name the same game version as data-version.json.
describe.each(['ets2', 'ats'])('best-dlc-set.json (%s)', (game) => {
  const dir = path.join(__dirname, '../../../public/data', game);
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));

  it('was generated for the current data version — rerun `npm run gen:best-dlc-set`', () => {
    expect(read('best-dlc-set.json').game_version).toBe(read('data-version.json').game_version);
  });

  it('names only map and cargo DLCs the game data knows', () => {
    const { best } = read('best-dlc-set.json') as { best: string[] };
    const { map_dlcs, cargo_dlcs } = read('game-defs.json').dlc as Record<string, Record<string, string>>;
    const known = new Set([...Object.keys(map_dlcs), ...Object.keys(cargo_dlcs)]);
    expect(best.length).toBeGreaterThan(0);
    for (const id of best) expect(known).toContain(id);
  });
});
