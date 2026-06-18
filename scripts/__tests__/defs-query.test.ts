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
