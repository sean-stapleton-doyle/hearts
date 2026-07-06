import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TricksPanel } from './TricksPanel'
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

describe('TricksPanel', () => {
  afterEach(cleanup)

  it('renders nothing before the first trick resolves', () => {
    const { container } = render(<TricksPanel tricks={[]} nameBySeat={nameBySeat} />)
    expect(container.firstChild).toBeNull()
  })

  it('collapsed, shows only the last trick with its winner', () => {
    render(<TricksPanel tricks={[trickOne, trickTwo]} nameBySeat={nameBySeat} />)
    expect(screen.getByText('Last trick')).toBeTruthy()
    const chips = screen.getAllByTestId('trick-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['2♣', 'A♥'])
    expect(screen.getByText('alice took it')).toBeTruthy()
    expect(screen.queryByText('bob took it')).toBeNull()
  })

  it('expands on click to the whole round, oldest first, and collapses back', () => {
    render(<TricksPanel tricks={[trickOne, trickTwo]} nameBySeat={nameBySeat} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Tricks this round')).toBeTruthy()
    const chips = screen.getAllByTestId('trick-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['10♠', 'K♠', '2♣', 'A♥'])
    expect(screen.getByText('bob took it')).toBeTruthy()
    expect(screen.getByText('alice took it')).toBeTruthy()

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Last trick')).toBeTruthy()
    expect(screen.getAllByTestId('trick-chip')).toHaveLength(2)
  })

  it('has nothing to expand with a single trick', () => {
    render(<TricksPanel tricks={[trickOne]} nameBySeat={nameBySeat} />)
    fireEvent.click(screen.getByRole('button'))
    // Still collapsed: one trick is already the whole history.
    expect(screen.getByText('Last trick')).toBeTruthy()
    expect(screen.getAllByTestId('trick-chip')).toHaveLength(2)
  })
})
