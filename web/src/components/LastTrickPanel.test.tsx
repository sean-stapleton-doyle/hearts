import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LastTrickPanel } from './LastTrickPanel'
import type { CompletedTrickView } from '../lib/types'

const names: Record<number, string> = { 0: 'alice', 1: 'bob' }
const nameBySeat = (seat: number) => names[seat] ?? `seat ${seat}`

const trick: CompletedTrickView = {
  leader: 0,
  winner: 1,
  plays: [
    { seat: 0, card: { suit: 'Spades', rank: 'Ten' } },
    { seat: 1, card: { suit: 'Spades', rank: 'King' } },
  ],
}

describe('LastTrickPanel', () => {
  afterEach(cleanup)

  it('renders nothing before the first trick resolves', () => {
    const { container } = render(<LastTrickPanel trick={null} nameBySeat={nameBySeat} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows every play in order and names the winner', () => {
    render(<LastTrickPanel trick={trick} nameBySeat={nameBySeat} />)
    const chips = screen.getAllByTestId('last-trick-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['10♠', 'K♠'])
    expect(screen.getByText('bob took it')).toBeTruthy()
  })
})
