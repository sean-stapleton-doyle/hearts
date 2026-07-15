// Typed client for the hearts-server REST API (server/docs/api.md), ported
// from hearts-cli/src/api.rs. One `ApiError` union; callers branch on `code`
// (stable/machine-readable), never on `message`. Every mutating call returns
// the server's response — the caller always re-renders from it rather than
// optimistically patching local state (same discipline as the CLI's
// `App::submit` → `refresh()`).
//
// Every response body is validated against its zod schema (types.ts) before
// it reaches the Query cache — a drifted wire shape surfaces as a `decode`
// error at the boundary, never as corrupted UI state.
//
// Deliberately module-scoped (no client factory/DI): the token cache and
// bootstrap promise are process-wide singletons by design, and the tests
// exercise this module by stubbing `globalThis.fetch` (api.test.ts) — at
// this app's size a `createApiClient` layer would add indirection for zero
// testability gain.
import { z } from 'zod'

import {
  AccountInfoSchema,
  ActionAckSchema,
  CreatedSessionSchema,
  GameJoinStatusSchema,
  GameViewSchema,
  MeInfoSchema,
  MyGamesSchema,
  MyStatsSchema,
  SessionInfoSchema,
  EventsTicketSchema,
  type AccountInfo,
  type ActionAck,
  type Card,
  type EventsTicket,
  type GameJoinStatus,
  type GameView,
  type MeInfo,
  type MyGames,
  type MyStats,
} from './types'
import { clearToken, getToken, setToken } from './session'

const envBase = import.meta.env.VITE_API_BASE as string | undefined
if (import.meta.env.PROD && !envBase) {
  // A prod bundle without an API base would silently send bearer tokens to
  // http://127.0.0.1 — fail the app loudly instead.
  throw new Error('VITE_API_BASE must be set for production builds')
}
export const API_BASE = envBase ?? 'http://127.0.0.1:8080'

export type ApiError =
  | { kind: 'server'; status: number; code: string; message: string }
  | { kind: 'transport'; message: string }
  /** The response arrived but its body didn't match the endpoint's schema —
   *  a client/server contract drift, not a network problem. Never retried. */
  | { kind: 'decode'; message: string }

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ['server', 'transport', 'decode'].includes((value as { kind: string }).kind)
  )
}

function raise(error: ApiError): never {
  throw error
}

// ── Bootstrap ───────────────────────────────────────────────────────────

let bootstrapPromise: Promise<string> | null = null

/**
 * Guarantee a session token exists, creating one with `POST /session` if
 * none is stored. Idempotent and re-entrancy-guarded so concurrent callers
 * share a single bootstrap. The router's root `beforeLoad` awaits this so
 * every loader/ fetch can assume a token.
 */
export async function ensureSession(): Promise<string> {
  const existing = getToken()
  if (existing) return existing
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    const { token } = await request('POST', '/session', CreatedSessionSchema)
    setToken(token)
    bootstrapPromise = null
    return token
  })().catch((error) => {
    bootstrapPromise = null
    throw error
  })
  return bootstrapPromise
}

// ── Fetch core ──────────────────────────────────────────────────────────

async function request<S extends z.ZodType>(
  method: string,
  path: string,
  schema: S,
  body?: unknown,
  token?: string,
): Promise<z.output<S>> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = {}
  const bearer = token ?? getToken()
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    raise({
      kind: 'transport',
      message: error instanceof Error ? error.message : 'network request failed',
    })
  }

  const text = response.status === 204 ? '' : await response.text()
  if (!response.ok) {
    let code = 'unknown'
    let message = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } }
      if (parsed.error?.code) code = parsed.error.code
      if (parsed.error?.message) message = parsed.error.message
    } catch {
      /* non-JSON error body — keep the HTTP fallbacks */
    }
    raise({ kind: 'server', status: response.status, code, message })
  }

  const parsed = schema.safeParse(text ? JSON.parse(text) : undefined)
  if (!parsed.success) {
    raise({ kind: 'decode', message: `${method} ${path}: ${z.prettifyError(parsed.error)}` })
  }
  return parsed.data
}

/**
 * Authed request with one-shot 401 recovery: a stored token can go stale
 * (expiry, server data reset) independent of user action, so on the first
 * 401 we drop it, mint a fresh session, and retry exactly once. A second 401
 * (e.g. the new session isn't a member of the game) surfaces to the caller.
 */
async function authedRequest<S extends z.ZodType>(
  method: string,
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.output<S>> {
  try {
    return await request(method, path, schema, body)
  } catch (error) {
    if (isApiError(error) && error.kind === 'server' && error.status === 401) {
      clearToken()
      await ensureSession()
      return request(method, path, schema, body)
    }
    throw error
  }
}

// ── Endpoints ───────────────────────────────────────────────────────────

export const api = {
  createGame(displayName: string): Promise<GameView> {
    return authedRequest('POST', '/games', GameViewSchema, { display_name: displayName })
  },

  joinGame(code: string, displayName: string): Promise<GameView> {
    return authedRequest('POST', `/games/${encodeURIComponent(code)}/join`, GameViewSchema, {
      display_name: displayName,
    })
  },

  /** Probe a game's joinability by invite code, so the join page can render
   *  the right state on load. Throws `game_not_found` for a bad code. */
  getJoinStatus(code: string): Promise<GameJoinStatus> {
    return authedRequest(
      'GET',
      `/invite/${encodeURIComponent(code)}`,
      GameJoinStatusSchema,
    )
  },

  startGame(id: string): Promise<GameView> {
    return authedRequest('POST', `/games/${id}/start`, GameViewSchema)
  },

  getGame(id: string): Promise<GameView> {
    return authedRequest('GET', `/games/${id}`, GameViewSchema)
  },

  bid(id: string, bid: number): Promise<ActionAck> {
    return authedRequest('POST', `/games/${id}/bid`, ActionAckSchema, { bid })
  },

  play(id: string, card: Card): Promise<ActionAck> {
    return authedRequest('POST', `/games/${id}/play`, ActionAckSchema, { card })
  },

  /** Acknowledge a held-open round recap (host only); clears the gate for
   *  every connected client via the subsequent `round_acknowledged` SSE
   *  event. Returns 403 `not_creator` for non-hosts, 409 `not_pending_ack`
   *  when no round is held. */
  continueGame(id: string): Promise<ActionAck> {
    return authedRequest('POST', `/games/${id}/continue`, ActionAckSchema)
  },

  /** End a running game early (host only); the terminal `game_abandoned`
   *  SSE event carries it to every connected client. Returns 403
   *  `not_creator` for non-hosts. */
  endGame(id: string): Promise<ActionAck> {
    return authedRequest('POST', `/games/${id}/end`, ActionAckSchema)
  },

  /** A single-use, short-lived ticket for opening the game's SSE stream —
   *  the stream URL carries this instead of the session token. */
  createEventsTicket(id: string): Promise<EventsTicket> {
    return authedRequest('POST', `/games/${id}/events-ticket`, EventsTicketSchema)
  },

  // ── Accounts (optional; login binds the current token, no new token) ──

  register(username: string, password: string): Promise<AccountInfo> {
    return authedRequest('POST', '/account/register', AccountInfoSchema, { username, password })
  },

  login(username: string, password: string): Promise<AccountInfo> {
    return authedRequest('POST', '/account/login', AccountInfoSchema, { username, password })
  },

  logout(): Promise<void> {
    return authedRequest('POST', '/account/logout', z.undefined())
  },

  /**
   * The logged-in account, or null for an anonymous session. Probes
   * `GET /session` first: hitting `/me` while anonymous would 401, and
   * `authedRequest`'s 401 recovery would then discard a perfectly valid
   * token (and with it the session's game seats).
   */
  async currentUser(): Promise<MeInfo | null> {
    const session = await authedRequest('GET', '/session', SessionInfoSchema)
    if (!session.user_id) return null
    return authedRequest('GET', '/me', MeInfoSchema)
  },

  getMyGames(): Promise<MyGames> {
    return authedRequest('GET', '/me/games', MyGamesSchema)
  },

  getMyStats(): Promise<MyStats> {
    return authedRequest('GET', '/me/stats', MyStatsSchema)
  },
}
