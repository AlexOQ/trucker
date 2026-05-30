// @vitest-environment jsdom
/**
 * DOM wiring tests for the shared nav (#247).
 *
 * These cover the seam the nav refactor opened: the nav is no longer static
 * HTML — renderNav() injects it at runtime, and the theme toggle is wired by
 * initGameSelector() rather than a standalone call. Pure-function tests (and
 * lint) can't see DOM event binding, so without these a regression here ships
 * green. Two things are asserted:
 *   1. renderNav() injects every element the old static nav carried.
 *   2. the theme toggle ends up bound exactly once (a double-bind would flip
 *      the theme twice per click → silent no-op).
 *
 * This is the repo's first jsdom test; it opts in via the pragma above so the
 * existing node-environment tests are unaffected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderNav, initGameSelector } from '../page-init';
import { getTheme, setTheme } from '../storage';

/** Minimal page skeleton: a header with the empty nav, as every HTML entry ships it. */
function mountSkeleton(): void {
  document.body.innerHTML = `
    <header>
      <h1 id="page-title"></h1>
      <p id="page-subtitle"></p>
      <nav id="main-nav" aria-label="Main navigation"></nav>
    </header>
    <main id="main-content"></main>
  `;
}

beforeEach(() => {
  localStorage.clear();
  mountSkeleton();
});

describe('renderNav()', () => {
  it('injects everything the old static nav carried', () => {
    renderNav();

    // Game selector with both game buttons
    const selector = document.getElementById('game-selector');
    expect(selector).not.toBeNull();
    const gameButtons = selector!.querySelectorAll<HTMLElement>('.game-btn');
    expect([...gameButtons].map((b) => b.dataset.game)).toEqual(['ets2', 'ats']);

    // Theme toggle
    expect(document.getElementById('theme-toggle')).not.toBeNull();

    // All seven destinations: Rankings + 5 Data Details items + DLCs
    const hrefs = [...document.querySelectorAll<HTMLAnchorElement>('header nav a')]
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'index.html',
      'cities.html', 'companies.html', 'cargo.html', 'trailers.html', 'trucks.html',
      'dlcs.html',
    ]);

    // Data Details dropdown toggle present and collapsed by default
    const ddToggle = document.getElementById('data-details-toggle');
    expect(ddToggle).not.toBeNull();
    expect(ddToggle!.getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the active page based on the current path', () => {
    // jsdom default location.pathname is "/", so pop() || 'index.html' → index.html
    renderNav();
    const rankings = document.querySelector<HTMLAnchorElement>('header nav a[href="index.html"]');
    expect(rankings!.classList.contains('active')).toBe(true);
  });

  it('Data Details toggle opens and closes the dropdown', () => {
    renderNav();
    const toggle = document.getElementById('data-details-toggle')!;
    const dropdown = toggle.parentElement!;

    expect(dropdown.classList.contains('open')).toBe(false);
    toggle.click();
    expect(dropdown.classList.contains('open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // Click outside closes it
    document.body.click();
    expect(dropdown.classList.contains('open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('theme toggle binding via initGameSelector()', () => {
  it('binds the toggle exactly once — a single click flips the theme once', () => {
    setTheme('dark');
    initGameSelector();

    const toggle = document.getElementById('theme-toggle')!;
    toggle.click();

    // One listener → dark → light. A double-bind would flip dark → light → dark.
    expect(getTheme()).toBe('light');
  });

  it('replays cleanly on a fresh render (no listener accumulation across renders)', () => {
    setTheme('dark');
    initGameSelector();
    // Re-render the nav and re-wire, as a game switch would on a fresh page load.
    initGameSelector();

    const toggle = document.getElementById('theme-toggle')!;
    toggle.click();

    // The latest render's button has one listener; a single click flips once.
    expect(getTheme()).toBe('light');
  });
});
