import { afterEach, vi } from 'vitest'

// jsdom doesn't reliably expose `localStorage` as a global across versions,
// but src/lib/session.ts uses it directly. Provide a small in-memory
// implementation so storage-backed code is testable without fighting jsdom.
const store = new Map<string, string>()

if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value))
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size
      },
    },
  })
}

// jsdom has no matchMedia, but GSAP's ScrollTrigger calls it at plugin
// registration time (import of lib/scroll-anim.ts), before any test can
// mock anything. A minimal always-false stub keeps that import inert —
// tests exercise the reduced-motion/static path explicitly instead.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// Reset storage + any spied globals between every test.
afterEach(() => {
  globalThis.localStorage.clear()
  vi.restoreAllMocks()
})
