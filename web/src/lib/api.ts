// Typed client for the hearts-server REST API (server/docs/api.md), ported
// from hearts-cli/src/api.rs. One `ApiError` union; callers branch on `code`
// (stable/machine-readable), never on `message`. Every mutating call returns
// the server's response — the caller always re-renders from it rather than
// optimistically patching local state (same discipline as the CLI's
// `App::submit` → `refresh()`).
import type {
  AccountInfo,
  ActionAck,
  Card,
  CreatedSession,
  GameView,
  MeInfo,
  MyGames,
  MyStats,
  SessionInfo,
} from './types'
import { clearToken, getToken, setToken } from './session'

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://127.0.0.1:8080'

export type ApiError =
  | { kind: 'server'; status: number; code: string; message: string }
  | { kind: 'transport'; message: string }

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ((value as { kind: string }).kind === 'server' ||
      (value as { kind: string }).kind === 'transport')
  )
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
    const { token } = await request<CreatedSession>('POST', '/session')
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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
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
    throw {
      kind: 'transport',
      message: error instanceof Error ? error.message : 'network request failed',
    } satisfies ApiError as ApiError
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
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
    throw { kind: 'server', status: response.status, code, message } satisfies ApiError as ApiError
  }
  return (text ? (JSON.parse(text) as T) : (undefined as T))
}

/**
 * Authed request with one-shot 401 recovery: a stored token can go stale
 * (expiry, server data reset) independent of user action, so on the first
 * 401 we drop it, mint a fresh session, and retry exactly once. A second 401
 * (e.g. the new session isn't a member of the game) surfaces to the caller.
 */
async function authedRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await request<T>(method, path, body)
  } catch (error) {
    if (isApiError(error) && error.kind === 'server' && error.status === 401) {
      clearToken()
      await ensureSession()
      return request<T>(method, path, body)
    }
    throw error
  }
}

// ── Endpoints ───────────────────────────────────────────────────────────

export const api = {
  createGame(displayName: string): Promise<GameView> {
    return authedRequest<GameView>('POST', '/games', { display_name: displayName })
  },

  joinGame(code: string, displayName: string): Promise<GameView> {
    return authedRequest<GameView>('POST', `/games/${encodeURIComponent(code)}/join`, {
      display_name: displayName,
    })
  },

  startGame(id: string): Promise<GameView> {
    return authedRequest<GameView>('POST', `/games/${id}/start`)
  },

  getGame(id: string): Promise<GameView> {
    return authedRequest<GameView>('GET', `/games/${id}`)
  },

  bid(id: string, bid: number): Promise<ActionAck> {
    return authedRequest<ActionAck>('POST', `/games/${id}/bid`, { bid })
  },

  play(id: string, card: Card): Promise<ActionAck> {
    return authedRequest<ActionAck>('POST', `/games/${id}/play`, { card })
  },

  /** Acknowledge a held-open round recap (host only); clears the gate for
   *  every connected client via the subsequent `round_acknowledged` SSE
   *  event. Returns 403 `not_creator` for non-hosts, 409 `not_pending_ack`
   *  when no round is held. */
  continueGame(id: string): Promise<ActionAck> {
    return authedRequest<ActionAck>('POST', `/games/${id}/continue`)
  },

  /** End a running game early (host only); the terminal `game_abandoned`
   *  SSE event carries it to every connected client. Returns 403
   *  `not_creator` for non-hosts. */
  endGame(id: string): Promise<ActionAck> {
    return authedRequest<ActionAck>('POST', `/games/${id}/end`)
  },

  // ── Accounts (optional; login binds the current token, no new token) ──

  register(username: string, password: string): Promise<AccountInfo> {
    return authedRequest<AccountInfo>('POST', '/account/register', { username, password })
  },

  login(username: string, password: string): Promise<AccountInfo> {
    return authedRequest<AccountInfo>('POST', '/account/login', { username, password })
  },

  logout(): Promise<void> {
    return authedRequest<void>('POST', '/account/logout')
  },

  /**
   * The logged-in account, or null for an anonymous session. Probes
   * `GET /session` first: hitting `/me` while anonymous would 401, and
   * `authedRequest`'s 401 recovery would then discard a perfectly valid
   * token (and with it the session's game seats).
   */
  async currentUser(): Promise<MeInfo | null> {
    const session = await authedRequest<SessionInfo>('GET', '/session')
    if (!session.user_id) return null
    return authedRequest<MeInfo>('GET', '/me')
  },

  getMyGames(): Promise<MyGames> {
    return authedRequest<MyGames>('GET', '/me/games')
  },

  getMyStats(): Promise<MyStats> {
    return authedRequest<MyStats>('GET', '/me/stats')
  },
}
