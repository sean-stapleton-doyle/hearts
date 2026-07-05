import { beforeEach, describe, expect, it } from 'vitest'
import { clearToken, getDisplayName, getToken, setDisplayName, setToken } from './session'

describe('session storage', () => {
  beforeEach(() => clearToken())

  it('round-trips the token through the in-memory cache', () => {
    expect(getToken()).toBeNull()
    setToken('abc123')
    expect(getToken()).toBe('abc123')
    expect(localStorage.getItem('hearts.token')).toBe('abc123')
    clearToken()
    expect(getToken()).toBeNull()
    expect(localStorage.getItem('hearts.token')).toBeNull()
  })

  it('persists and clears the display name', () => {
    expect(getDisplayName()).toBe('')
    setDisplayName('alice')
    expect(getDisplayName()).toBe('alice')
    setDisplayName('')
    expect(getDisplayName()).toBe('')
  })
})
