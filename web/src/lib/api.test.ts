import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { api, ensureSession, isApiError } from './api'
import { clearToken, getToken, setToken } from './session'

// Minimal Response stand-in: api.ts only reads .status, .ok, and .text().
function res(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { status, ok: status >= 200 && status < 300, text: async () => text } as Response
}

function auth(init?: RequestInit): string {
  return (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
}

/** Install a typed mock fetch and return it for assertions. */
function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): Mock {
  const fn = vi.fn(impl)
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

describe('ensureSession', () => {
  beforeEach(() => clearToken())

  it('mints a session when none is stored, and is idempotent', async () => {
    const fetchMock = mockFetch(async () => res({ token: 'T1', expires_at: 'x' }))
    const token = await ensureSession()
    expect(token).toBe('T1')
    expect(getToken()).toBe('T1')
    // Second call short-circuits on the cached token: no second POST.
    await ensureSession()
    expect(fetchMock.mock.calls).toHaveLength(1)
  })
})

describe('api error handling', () => {
  beforeEach(() => clearToken())

  it('on 401, drops the stale token, mints a fresh session, and retries once', async () => {
    setToken('T1-stale')
    const fetchMock = mockFetch(async (url, init) => {
      if (url.endsWith('/session')) return res({ token: 'T2-fresh', expires_at: 'x' })
      if (url.includes('/games/g1')) {
        return auth(init) === 'Bearer T2-fresh'
          ? res({ id: 'g1', invite_code: 'C', status: 'in_progress', players: [], game: null })
          : res({ error: { code: 'invalid_token', message: 'expired' } }, 401)
      }
      throw new Error(`unexpected ${url}`)
    })

    const view = await api.getGame('g1')
    expect(view.id).toBe('g1')
    expect(getToken()).toBe('T2-fresh')
    // GET(401) → POST /session → GET(200)
    const trace = fetchMock.mock.calls.map(([url, init]) => [
      url.endsWith('/session') ? 'session' : 'game',
      init?.method ?? 'GET',
    ])
    expect(trace).toEqual([
      ['game', 'GET'],
      ['session', 'POST'],
      ['game', 'GET'],
    ])
  })

  it('surfaces a structured 409 without retrying', async () => {
    setToken('T1')
    const fetchMock = mockFetch(async (url) =>
      url.endsWith('/games/g1/bid')
        ? res({ error: { code: 'forbidden_bid', message: 'nope' } }, 409)
        : res({ token: 'T2', expires_at: 'x' }),
    )

    await expect(api.bid('g1', 1)).rejects.toMatchObject({
      kind: 'server',
      status: 409,
      code: 'forbidden_bid',
    })
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  it('wraps a network failure as a transport error', async () => {
    setToken('T1')
    mockFetch(async () => {
      throw new Error('boom')
    })

    await expect(api.getGame('g1')).rejects.toMatchObject({ kind: 'transport', message: 'boom' })
  })
})

describe('isApiError', () => {
  it('narrows server and transport errors only', () => {
    expect(isApiError({ kind: 'server', status: 404, code: 'x', message: 'y' })).toBe(true)
    expect(isApiError({ kind: 'transport', message: 'y' })).toBe(true)
    expect(isApiError(new Error('nope'))).toBe(false)
    expect(isApiError(null)).toBe(false)
    expect(isApiError({ status: 500 })).toBe(false)
  })
})
