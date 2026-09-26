/**
 * Vitest global setup.
 *
 * Node 26 ships its own experimental `localStorage` global that is `undefined` unless the
 * process is started with `--localstorage-file`. In vitest's jsdom environment `window` IS
 * `globalThis`, so that undefined native property shadows jsdom's own Storage and every
 * `localStorage.…` call in the code under test throws. CI runs Node 20 and never sees it;
 * a local `npm run test` on Node 26 fails 5 nav-render tests with
 * "Cannot read properties of undefined (reading 'clear')".
 *
 * Fix: install an in-memory Storage when there isn't one. Tests that want to assert on the
 * calls (storage.test.ts) stub their own mock at module scope, which runs after this and wins.
 */
import { vi } from 'vitest';

if (typeof localStorage === 'undefined') {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  });
}
