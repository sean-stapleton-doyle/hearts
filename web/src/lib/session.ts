// Session token + display-name persistence. The token is the player's
// identity (mirroring hearts-cli/src/config.rs: "token is the identity, keep
// it safe"). Kept in localStorage — no cookies means no CORS credential
// dance. The token can be read synchronously and often (every request), so
// it's mirrored in memory after first read.

const TOKEN_KEY = 'hearts.token'
const NAME_KEY = 'hearts.display_name'

let tokenCache: string | null | undefined

function readToken(): string | null {
  if (tokenCache === undefined) {
    tokenCache = localStorage.getItem(TOKEN_KEY)
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
