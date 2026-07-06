import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LastTrickPanel } from './TricksPanel'
import type { CompletedTrickView } from '../lib/types'

const names: Record<number, string> = { 0: 'alice', 1: 'bob' }
const nameBySeat = (seat: number) => names[seat] ?? `seat ${seat}`

const trickOne: CompletedTrickView = {
  leader: 0,
  winner: 1,
  plays: [
    { seat: 0, card: { suit: 'Spades', rank: 'Ten' } },
    { seat: 1, card: { suit: 'Spades', rank: 'King' } },
  ],
}

const trickTwo: CompletedTrickView = {
  leader: 1,
  winner: 0,
  plays: [
    { seat: 1, card: { suit: 'Clubs', rank: 'Two' } },
    { seat: 0, card: { suit: 'Hearts', rank: 'Ace' } },
  ],
}

describe('LastTrickPanel', () => {
  afterEach(cleanup)

  it('renders nothing before the first trick resolves', () => {
    const { container } = render(<LastTrickPanel tricks={[]} nameBySeat={nameBySeat} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows only the last trick, never the earlier ones', () => {
    render(<LastTrickPanel tricks={[trickOne, trickTwo]} nameBySeat={nameBySeat} />)
    expect(screen.getByText('Last trick')).toBeTruthy()
    const chips = screen.getAllByTestId('trick-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['2♣', 'A♥'])
    expect(screen.getByText('alice took it')).toBeTruthy()
    // Trick one stays hidden — remembering it is part of the game.
    expect(screen.queryByText('bob took it')).toBeNull()
    expect(screen.queryByText('10♠')).toBeNull()
  })

  it('is not interactive — no expansion to the round history', () => {
    render(<LastTrickPanel tricks={[trickOne, trickTwo]} nameBySeat={nameBySeat} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
