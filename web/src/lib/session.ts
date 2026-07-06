// Session token + display-name persistence. The token is the player's
// identity (mirroring hearts-cli/src/config.rs: "token is the identity, keep
// it safe"). Kept in localStorage — no cookies means no CORS credential
// dance. The token can be read synchronously and often (every request), so
// it's mirrored in memory after first read.

const TOKEN_KEY = 'hearts.token'
const NAME_KEY = 'hearts.display_name'

/** Server session tokens are 32 bytes hex-encoded. localStorage is an
 *  external boundary like any other: a garbled value (manual edit, another
 *  app's collision) would otherwise 401-loop through the bootstrap, so
 *  anything off-shape is treated as absent and cleared. */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/

let tokenCache: string | null | undefined

function readToken(): string | null {
  if (tokenCache === undefined) {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (raw !== null && !TOKEN_SHAPE.test(raw)) {
      localStorage.removeItem(TOKEN_KEY)
      tokenCache = null
    } else {
      tokenCache = raw
    }
  }
  return tokenCache
}

export function getToken(): string | null {
  return readToken()
}

export function setToken(token: string): void {
  tokenCache = token
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  tokenCache = null
  localStorage.removeItem(TOKEN_KEY)
}

export function getDisplayName(): string {
  return localStorage.getItem(NAME_KEY) ?? ''
}

export function setDisplayName(name: string): void {
  if (name) {
    localStorage.setItem(NAME_KEY, name)
  } else {
    localStorage.removeItem(NAME_KEY)
  }
}
