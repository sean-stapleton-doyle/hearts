import { describe, expect, it } from 'vitest'

import { accumulateTrick, emptyTrickAccumulator, type TrickAccumulator } from './sse'
import type { Card, GameEvent } from './types'

const card = (rank: Card['rank'], suit: Card['suit'] = 'Hearts'): Card => ({ rank, suit })

const played = (seat: number, c: Card): GameEvent => ({
  type: 'card_played',
  seat,
  card: c,
  auto: false,
  next: null,
})
const completed = (winner: number): GameEvent => ({ type: 'trick_completed', winner, next: null })

const fold = (events: GameEvent[]): TrickAccumulator =>
  events.reduce(accumulateTrick, emptyTrickAccumulator())

describe('accumulateTrick', () => {
  it('snapshots a completed trick with the leader as the first player', () => {
    const acc = fold([
      played(2, card('Ace')),
      played(3, card('King')),
      played(0, card('Two')),
      played(1, card('Five')),
      completed(0),
    ])
    expect(acc.last).toEqual({
      leader: 2,
      winner: 0,
      plays: [
        { seat: 2, card: card('Ace') },
        { seat: 3, card: card('King') },
        { seat: 0, card: card('Two') },
        { seat: 1, card: card('Five') },
      ],
    })
    // Reset after the completion, ready for the next trick.
    expect(acc.plays).toEqual([])
  })

  it('keeps only the most recent completed trick as the final one', () => {
    const acc = fold([
      played(0, card('Three')),
      played(1, card('Four')),
      completed(1),
      // Final trick — its winner and cards should win out.
      played(1, card('Queen')),
      played(0, card('Ace')),
      completed(0),
    ])
    expect(acc.last?.winner).toBe(0)
    expect(acc.last?.leader).toBe(1)
    expect(acc.last?.plays.map((p) => p.card.rank)).toEqual(['Queen', 'Ace'])
  })

  it('is idempotent under replay (folding the same log twice)', () => {
    const log: GameEvent[] = [
      played(0, card('Ace')),
      played(1, card('King')),
      completed(1),
    ]
    expect(fold([...log, ...log]).last).toEqual(fold(log).last)
  })

  it('ignores unrelated events and a completion with no plays', () => {
    const acc = fold([
      { type: 'trick_completed', winner: 3, next: null },
      { type: 'bid_placed', seat: 0, bid: 2, auto: false, next: null },
    ])
    expect(acc.last).toBeNull()
    expect(acc.plays).toEqual([])
  })
})
