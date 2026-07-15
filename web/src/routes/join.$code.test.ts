import { describe, expect, it } from 'vitest'

import { resolveJoinState } from './join.$code'
import type { GameJoinStatus } from '../lib/types'

const status = (over: Partial<GameJoinStatus>): GameJoinStatus => ({
  status: 'lobby',
  seated: false,
  full: false,
  ...over,
})

describe('resolveJoinState', () => {
  it('offers Join for an open lobby with room', () => {
    expect(resolveJoinState(status({}), null)).toEqual({ action: 'join', message: null })
  })

  it('lets a seated member enter, whatever the phase', () => {
    expect(resolveJoinState(status({ seated: true, status: 'in_progress' }), null)).toEqual({
      action: 'enter',
      message: null,
    })
  })

  it('blocks a full lobby, a started game, a finished game, and an abandoned game', () => {
    expect(resolveJoinState(status({ full: true }), null).action).toBeNull()
    expect(resolveJoinState(status({ status: 'in_progress' }), null).message).toMatch(/already started/i)
    expect(resolveJoinState(status({ status: 'finished' }), null).message).toMatch(/over/i)
    expect(resolveJoinState(status({ status: 'abandoned' }), null).message).toMatch(/abandoned/i)
  })

  it('reports a missing code from the probe error', () => {
    const err = { kind: 'server' as const, status: 404, code: 'game_not_found', message: 'raw' }
    expect(resolveJoinState(undefined, err)).toEqual({
      action: null,
      message: 'No game with that code.',
    })
  })

  it('shows nothing actionable while the probe is still loading', () => {
    expect(resolveJoinState(undefined, null)).toEqual({ action: null, message: null })
  })
})
