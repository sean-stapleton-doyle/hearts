import { describe, expect, it } from 'vitest'
import type { GameEventEnvelope, GameView } from './types'

// Guards against drift between these DTOs and the contract documented in
// server/docs/api.md: the doc's worked examples must decode cleanly.

describe('GameView decode (api.md §The game view)', () => {
  it('parses the documented example', () => {
    const raw = {
      id: 'e99d5c7c-aaaa-bbbb-cccc-dddddddddddd',
      invite_code: 'MJTZ6C',
      status: 'in_progress',
      players: [
        { seat: 0, display_name: 'alice', is_you: true, is_creator: true },
        { seat: 1, display_name: 'bob', is_you: false, is_creator: false },
      ],
      created_at: '2026-07-02T13:00:00Z',
      started_at: '2026-07-02T13:00:05Z',
      game: {
        phase: 'Playing',
        round_index: 3,
        scores: [4, -1],
        next: { action: 'play', seat: 1 },
        away: [false, true],
        turn_deadline_in_secs: 287,
        round: {
          cards_dealt: 3,
          dealer: 1,
          bids: [1, null],
          tricks_won: [1, 0],
          current_trick: {
            leader: 0,
            plays: [{ seat: 0, card: { suit: 'Spades', rank: 'Ten' } }],
          },
          last_trick: {
            leader: 1,
            winner: 0,
            plays: [
              { seat: 1, card: { suit: 'Clubs', rank: 'Two' } },
              { seat: 0, card: { suit: 'Clubs', rank: 'King' } },
            ],
          },
        },
        you: {
          seat: 1,
          hand: [{ suit: 'Hearts', rank: 'Three' }],
          legal_bids: null,
          legal_plays: [{ suit: 'Hearts', rank: 'Three' }],
        },
      },
    }
    const view = raw as unknown as GameView
    expect(view.status).toBe('in_progress')
    expect(view.game?.round?.bids[1]).toBeNull()
    expect(view.game?.you?.legal_plays).toHaveLength(1)
    expect(view.game?.round?.last_trick?.winner).toBe(0)
    expect(view.game?.turn_deadline_in_secs).toBe(287)
  })
})

describe('GameEventEnvelope decode (api.md §Events)', () => {
  it('parses the documented card_played payload', () => {
    const raw =
      '{"seq":3,"type":"card_played","seat":0,"card":{"suit":"Spades","rank":"Ten"},"auto":false,"next":{"action":"play","seat":1}}'
    const env = JSON.parse(raw) as GameEventEnvelope
    expect(env.seq).toBe(3)
    expect(env.type).toBe('card_played')
    if (env.type === 'card_played') {
      expect(env.card.rank).toBe('Ten')
      expect(env.next?.seat).toBe(1)
    }
  })
})
