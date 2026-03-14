/**
 * Tests for theme management functions in storage.ts:
 * - getTheme() — 3-way priority: localStorage > prefers-color-scheme > 'dark'
 * - setTheme() — persists + applies to document
 * - toggleTheme() — cycles between dark and light
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Set up localStorage mock BEFORE importing storage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

// Mock document.documentElement.setAttribute (used by setTheme)
const setAttributeMock = vi.fn();
vi.stubGlobal('document', {
  documentElement: { setAttribute: setAttributeMock },
});

// Dynamic import after stubbing globals
const storage = await import('../storage.ts');

const THEME_KEY = 'ets2-theme';

describe('getTheme', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    storage._resetStateCache();
  });

  it('returns stored "dark" when set in localStorage (priority 1)', () => {
    localStorageMock.setItem(THEME_KEY, 'dark');
    expect(storage.getTheme()).toBe('dark');
  });

  it('returns stored "light" when set in localStorage (priority 1)', () => {
    localStorageMock.setItem(THEME_KEY, 'light');
    expect(storage.getTheme()).toBe('light');
  });

  it('ignores invalid localStorage value and falls through to system preference', () => {
    localStorageMock.setItem(THEME_KEY, 'solarized');
    // invalid stored value → system pref check → no match → default dark
    const matchMediaMock = vi.fn(() => ({ matches: false }));
    vi.stubGlobal('window', { matchMedia: matchMediaMock });
    expect(storage.getTheme()).toBe('dark');
  });

  it('returns "light" from prefers-color-scheme when no localStorage entry (priority 2)', () => {
    const matchMediaMock = vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: light)',
    }));
    vi.stubGlobal('window', { matchMedia: matchMediaMock });
    expect(storage.getTheme()).toBe('light');
  });

  it('returns "dark" default when no localStorage and no system light preference (priority 3)', () => {
    const matchMediaMock = vi.fn(() => ({ matches: false }));
    vi.stubGlobal('window', { matchMedia: matchMediaMock });
    expect(storage.getTheme()).toBe('dark');
  });

  it('localStorage takes priority over prefers-color-scheme: light', () => {
    localStorageMock.setItem(THEME_KEY, 'dark');
    // System says light, but localStorage says dark → dark wins
    const matchMediaMock = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('window', { matchMedia: matchMediaMock });
    expect(storage.getTheme()).toBe('dark');
  });

  it('localStorage "light" takes priority over no system preference (default dark)', () => {
    localStorageMock.setItem(THEME_KEY, 'light');
    const matchMediaMock = vi.fn(() => ({ matches: false }));
    vi.stubGlobal('window', { matchMedia: matchMediaMock });
    expect(storage.getTheme()).toBe('light');
  });
});

describe('setTheme', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    storage._resetStateCache();
  });

  it('persists "light" to localStorage', () => {
    storage.setTheme('light');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(THEME_KEY, 'light');
  });

  it('persists "dark" to localStorage', () => {
    storage.setTheme('dark');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(THEME_KEY, 'dark');
  });

  it('applies theme to document root via setAttribute', () => {
    storage.setTheme('dark');
    expect(setAttributeMock).toHaveBeenCalledWith('data-theme', 'dark');
  });

  it('applies "light" theme to document root', () => {
    storage.setTheme('light');
    expect(setAttributeMock).toHaveBeenCalledWith('data-theme', 'light');
  });

  it('after setTheme, getTheme returns the set value', () => {
    storage.setTheme('light');
    expect(storage.getTheme()).toBe('light');
    storage.setTheme('dark');
    expect(storage.getTheme()).toBe('dark');
  });
});

describe('toggleTheme', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    storage._resetStateCache();
  });

  it('toggles from dark to light', () => {
    localStorageMock.setItem(THEME_KEY, 'dark');
    const next = storage.toggleTheme();
    expect(next).toBe('light');
  });

  it('toggles from light to dark', () => {
    localStorageMock.setItem(THEME_KEY, 'light');
    const next = storage.toggleTheme();
    expect(next).toBe('dark');
  });

  it('returns the new theme value', () => {
    localStorageMock.setItem(THEME_KEY, 'dark');
    expect(storage.toggleTheme()).toBe('light');
  });

  it('persists the toggled value to localStorage', () => {
    localStorageMock.setItem(THEME_KEY, 'dark');
    storage.toggleTheme();
    expect(localStorageMock.setItem).toHaveBeenCalledWith(THEME_KEY, 'light');
  });

  it('cycles correctly: dark → light → dark → light', () => {
    localStorageMock.setItem(THEME_KEY, 'dark');

    expect(storage.toggleTheme()).toBe('light');
    expect(storage.toggleTheme()).toBe('dark');
    expect(storage.toggleTheme()).toBe('light');
  });

  it('default state (no stored theme, no system pref) starts dark and toggles to light', () => {
    const matchMediaMock = vi.fn(() => ({ matches: false }));
    vi.stubGlobal('window', { matchMedia: matchMediaMock });
    // No stored theme → dark → toggle → light
    expect(storage.toggleTheme()).toBe('light');
  });
});
