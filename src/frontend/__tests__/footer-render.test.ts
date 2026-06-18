// @vitest-environment jsdom
/**
 * Footer + data-coverage surface (#255).
 *
 * The footer is no longer static HTML — renderFooter() injects it at runtime
 * (mirroring the nav refactor), and renderDataCoverage() fills the version +
 * DLC-coverage line once game data has loaded. Pure-function tests and lint
 * can't see the DOM wiring, so without these a regression here ships green.
 *
 * Covered seams:
 *   1. dlcCoverageCounts() — the one canonical count shared by UI + README.
 *   2. renderFooter() injects the footer (and reuses an existing one rather
 *      than stacking duplicates).
 *   3. renderDataCoverage() composes version + counts + notes from the loaded
 *      data, and degrades cleanly when a source or the footer slot is missing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderFooter, renderDataCoverage } from '../page-init';
import { dlcCoverageCounts, type DlcSection } from '../dlc-data';
import type { AllData, DataVersion, GameDefs } from '../types';

/** Build a DlcSection with only the count-bearing maps populated. */
function dlcSection(trailer: string[], cargo: string[], map: string[]): DlcSection {
  const asMap = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id]));
  return {
    trailer_dlcs: asMap(trailer),
    cargo_dlcs: asMap(cargo),
    map_dlcs: asMap(map),
    city_dlc_map: {},
    cargo_dlc_map: {},
    map_dlc_cargo: {},
    garage_cities: [],
  };
}

/** Minimal AllData carrying only what renderDataCoverage() reads. */
function makeData(opts: { dlc?: DlcSection; dataVersion?: DataVersion | null }): AllData {
  return {
    gameDefs: opts.dlc ? ({ dlc: opts.dlc } as unknown as GameDefs) : null,
    observations: null,
    cities: [],
    companies: [],
    cargo: [],
    trailers: [],
    dataVersion: opts.dataVersion,
  };
}

const DV: DataVersion = { game_version: '1.59', refreshed_at: '2026-06-15', coverage_notes: '' };

beforeEach(() => {
  // No localStorage touch: getActiveGame() is try/catch-guarded and defaults to
  // ETS2, so these tests don't depend on the jsdom localStorage that flakes on
  // macOS (see nav-render.test.ts). The shortName under test is ETS2's.
  document.body.innerHTML = `<div class="container"><header></header><main id="main-content"></main></div>`;
});

describe('dlcCoverageCounts()', () => {
  it('counts each DLC category and totals them', () => {
    const c = dlcCoverageCounts(dlcSection(['a', 'b'], ['c'], ['d', 'e', 'f']));
    expect(c).toEqual({ trailer: 2, cargo: 1, map: 3, total: 6 });
  });

  it('returns zeros for an empty registry', () => {
    expect(dlcCoverageCounts(dlcSection([], [], []))).toEqual({ trailer: 0, cargo: 0, map: 0, total: 0 });
  });
});

describe('renderFooter()', () => {
  it('injects a footer with the GitHub link and an empty coverage slot', () => {
    renderFooter();
    const footer = document.querySelector('footer.site-footer');
    expect(footer).not.toBeNull();
    expect(document.getElementById('footer-coverage')).not.toBeNull();
    const link = footer!.querySelector('a');
    expect(link!.getAttribute('href')).toBe('https://github.com/AlexOQ/trucker/issues');
  });

  it('reuses an existing footer instead of stacking duplicates', () => {
    const existing = document.createElement('footer');
    existing.className = 'site-footer';
    document.querySelector('.container')!.appendChild(existing);

    renderFooter();
    renderFooter();
    expect(document.querySelectorAll('footer.site-footer').length).toBe(1);
  });
});

describe('renderDataCoverage()', () => {
  it('composes version, refresh date, and DLC counts for the active game', () => {
    renderFooter();
    renderDataCoverage(makeData({ dlc: dlcSection(['a', 'b'], ['c'], ['d']), dataVersion: DV }));

    const text = document.getElementById('footer-coverage')!.textContent ?? '';
    expect(text).toContain('ETS2 data v1.59');
    expect(text).toContain('refreshed 2026-06-15');
    expect(text).toContain('4 DLCs covered (2 trailer · 1 cargo · 1 map)');
  });

  it('surfaces coverage notes as a muted note with a tooltip', () => {
    renderFooter();
    const notes = 'Truck catalog not yet populated for ATS.';
    renderDataCoverage(makeData({ dlc: dlcSection(['a'], [], []), dataVersion: { ...DV, coverage_notes: notes } }));

    const el = document.getElementById('footer-coverage')!;
    expect(el.title).toBe(notes);
    const note = el.querySelector('.footer-coverage-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe(notes);
  });

  it('omits the note span and tooltip when there are no coverage notes', () => {
    renderFooter();
    renderDataCoverage(makeData({ dlc: dlcSection(['a'], [], []), dataVersion: DV }));

    const el = document.getElementById('footer-coverage')!;
    expect(el.querySelector('.footer-coverage-note')).toBeNull();
    expect(el.getAttribute('title')).toBeNull();
  });

  it('shows DLC counts even when the data-version file is absent', () => {
    renderFooter();
    renderDataCoverage(makeData({ dlc: dlcSection(['a', 'b'], [], []), dataVersion: null }));

    const text = document.getElementById('footer-coverage')!.textContent ?? '';
    expect(text).toContain('ETS2 data');
    expect(text).not.toContain('v1.59'); // no version segment
    expect(text).toContain('2 DLCs covered');
  });

  it('clears the coverage line when neither data-version nor DLC registry is present', () => {
    renderFooter();
    document.getElementById('footer-coverage')!.textContent = 'stale';
    renderDataCoverage(makeData({}));
    expect(document.getElementById('footer-coverage')!.textContent).toBe('');
  });

  it('no-ops without throwing when the footer slot is absent', () => {
    expect(() => renderDataCoverage(makeData({ dlc: dlcSection(['a'], [], []), dataVersion: DV }))).not.toThrow();
  });
});
