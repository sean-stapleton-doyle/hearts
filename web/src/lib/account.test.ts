import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { api } from './api'
import { clearToken, getToken, setToken } from './session'
import { joinErrorMessage } from './useDefaultDisplayName'

function res(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { status, ok: status >= 200 && status < 300, text: async () => text } as Response
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): Mock {
  const fn = vi.fn(impl)
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

describe('api.currentUser', () => {
  beforeEach(() => clearToken())

  it('returns null for an anonymous session without touching /me', async () => {
    setToken('T1')
    const fetchMock = mockFetch(async (url) => {
      if (url.endsWith('/session')) return res({ user_id: null, expires_at: 'x' })
      throw new Error(`unexpected ${url}`)
    })

    expect(await api.currentUser()).toBeNull()
    // Critical: /me 401s for anonymous sessions, and authedRequest's 401
    // recovery would discard the (valid) token — so /me must never be hit.
    expect(fetchMock.mock.calls.every(([url]) => !(url as string).endsWith('/me'))).toBe(true)
    expect(getToken()).toBe('T1')
  })

  it('returns the profile once the session is bound to an account', async () => {
    setToken('T1')
    mockFetch(async (url) => {
      if (url.endsWith('/session')) return res({ user_id: 'u1', expires_at: 'x' })
      if (url.endsWith('/me')) {
        return res({ user_id: 'u1', username: 'sean', created_at: '2026-07-04T00:00:00Z' })
      }
      throw new Error(`unexpected ${url}`)
    })

    expect(await api.currentUser()).toMatchObject({ user_id: 'u1', username: 'sean' })
  })
})

describe('joinErrorMessage', () => {
  it('maps name_taken to a friendly instruction', () => {
    const error = { kind: 'server', status: 409, code: 'name_taken', message: 'raw server text' }
    expect(joinErrorMessage(error, 'fallback')).toBe(
      'That name is already taken in this game — pick another.',
    )
  })

  it('maps the stale-game join codes to friendly reasons', () => {
    const started = { kind: 'server', status: 409, code: 'not_joinable', message: 'raw' }
    const full = { kind: 'server', status: 409, code: 'game_full', message: 'raw' }
    const missing = { kind: 'server', status: 404, code: 'game_not_found', message: 'raw' }
    expect(joinErrorMessage(started, 'fallback')).toBe('This game has already started.')
    expect(joinErrorMessage(full, 'fallback')).toBe('This game is full (7 players).')
    expect(joinErrorMessage(missing, 'fallback')).toBe('No game with that code.')
  })

  it('passes through other server messages and falls back otherwise', () => {
    const other = { kind: 'server', status: 409, code: 'some_other_code', message: 'raw server text' }
    expect(joinErrorMessage(other, 'fallback')).toBe('raw server text')
    expect(joinErrorMessage(new Error('boom'), 'fallback')).toBe('fallback')
  })
})
