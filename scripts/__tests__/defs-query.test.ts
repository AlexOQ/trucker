import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

// vitest runs from the repo root, so resolve the CLI and data from cwd.
const CLI = join(process.cwd(), 'scripts', 'defs-query.cjs');
const dataFile = (game: string) => join(process.cwd(), 'public', 'data', game, 'game-defs.json');
const defs = (game: string) => JSON.parse(readFileSync(dataFile(game), 'utf8'));

function run(args: string[]) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const GAMES = ['ets2', 'ats'] as const;
// Object.prototype member names — must NOT be mistaken for valid ids (#279 contract).
const PROTO_KEYS = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'];
const SUBCOMMANDS = ['cargo', 'companies-for-cargo', 'city', 'city-companies'];

describe.each(GAMES)('defs-query — happy path (%s)', (game) => {
  const d = defs(game);
  const firstKey = (section: string) => Object.keys(d[section])[0];

  it('cargo <id> returns the record', () => {
    const id = firstKey('cargo');
    const r = run(['cargo', id, '--game', game]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ id, name: d.cargo[id].name });
  });

  it('companies-for-cargo <id> reverse-walks cargo_out', () => {
    const id = firstKey('cargo');
    const r = run(['companies-for-cargo', id, '--game', game]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    const expected = Object.values(d.companies).filter(
      (c: any) => Array.isArray(c.cargo_out) && c.cargo_out.includes(id),
    ).length;
    expect(out.count).toBe(expected);
    expect(out.companies).toHaveLength(expected);
  });

  it('city <id> returns the record', () => {
    const id = firstKey('cities');
    const r = run(['city', id, '--game', game]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ id, name: d.cities[id].name });
  });

  it('city-companies <id> resolves the {companyId:count} map', () => {
    const id = firstKey('city_companies');
    const r = run(['city-companies', id, '--game', game]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.count).toBe(Object.keys(d.city_companies[id]).length);
  });
});

describe('defs-query — unknown-id / arg contract (exit non-zero, no stack trace)', () => {
  it.each(SUBCOMMANDS)('%s: a genuinely unknown id exits non-zero with a message', (sub) => {
    const r = run([sub, 'definitely_not_a_real_id']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/defs-query: unknown/);
    expect(r.stderr).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack frame
  });

  // The regression this test exists for: prototype-name ids must be treated as
  // unknown, not silently resolved to an inherited Object.prototype member.
  for (const sub of SUBCOMMANDS) {
    it.each(PROTO_KEYS)(`${sub}: prototype-name id "%s" exits non-zero`, (key) => {
      const r = run([sub, key]);
      expect(r.code).not.toBe(0);
    });
  }

  it('unknown --game exits non-zero', () => {
    expect(run(['cargo', 'x', '--game', 'switch']).code).not.toBe(0);
  });

  it('missing subcommand exits non-zero', () => {
    expect(run([]).code).not.toBe(0);
  });

  it('subcommand without an id exits non-zero', () => {
    expect(run(['cargo']).code).not.toBe(0);
  });

  it('unknown subcommand exits non-zero', () => {
    expect(run(['bogus', 'x']).code).not.toBe(0);
  });

  it('-h prints usage and exits zero', () => {
    const r = run(['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });
});

describe.each(GAMES)('defs-query — cargo-search (%s)', (game) => {
  const d = defs(game);
  const firstCargoId = Object.keys(d.cargo)[0];

  it('substring matches the record whose id contains the needle', () => {
    const needle = firstCargoId.slice(0, 3);
    const r = run(['cargo-search', needle, '--game', game]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.matches.some((m: any) => m.id === firstCargoId)).toBe(true);
    // every hit really contains the needle in its id or name (no false positives)
    const re = needle.toLowerCase();
    expect(
      out.matches.every(
        (m: any) =>
          m.id.toLowerCase().includes(re) || (m.name || '').toLowerCase().includes(re),
      ),
    ).toBe(true);
  });

  it('substring search is case-insensitive', () => {
    const needle = firstCargoId.slice(0, 3);
    const lo = JSON.parse(run(['cargo-search', needle.toLowerCase(), '--game', game]).stdout);
    const hi = JSON.parse(run(['cargo-search', needle.toUpperCase(), '--game', game]).stdout);
    expect(hi.count).toBe(lo.count);
  });

  it('/regex/ form matches by anchored pattern', () => {
    const r = run(['cargo-search', `/^${firstCargoId}$/`, '--game', game]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.count).toBeGreaterThanOrEqual(1);
    expect(out.matches.some((m: any) => m.id === firstCargoId)).toBe(true);
  });

  it('a miss returns an empty result (count 0, exit 0) — a search, not an error', () => {
    const r = run(['cargo-search', 'zzz_no_such_cargo_zzz', '--game', game]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ count: 0, matches: [] });
  });
});

describe('defs-query — cargo-search / dlc arg contract', () => {
  it('cargo-search without a query exits non-zero', () => {
    expect(run(['cargo-search']).code).not.toBe(0);
  });

  it('cargo-search with an invalid regex exits non-zero, no stack trace', () => {
    const r = run(['cargo-search', '/[/']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/defs-query: invalid regex/);
    expect(r.stderr).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });

  it('dlc with no section dumps the whole registry', () => {
    const r = run(['dlc']);
    expect(r.code).toBe(0);
    expect(Object.keys(JSON.parse(r.stdout))).toContain('garage_cities');
  });

  it('dlc <section> narrows to one section', () => {
    const r = run(['dlc', 'garage_cities']);
    expect(r.code).toBe(0);
    expect(Array.isArray(JSON.parse(r.stdout))).toBe(true);
  });

  it('dlc <unknown section> exits non-zero with a message', () => {
    const r = run(['dlc', 'not_a_section']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/unknown dlc section/);
  });
});
