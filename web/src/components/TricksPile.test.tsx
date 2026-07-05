import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TricksPile } from './TricksPile'

describe('TricksPile', () => {
  afterEach(cleanup)

  it('renders a placeholder for an empty pile', () => {
    render(<TricksPile count={0} />)
    expect(screen.getByRole('img', { name: '0 tricks won' })).toBeTruthy()
    expect(screen.getByTestId('tricks-empty')).toBeTruthy()
    expect(screen.queryAllByTestId('tricks-card')).toHaveLength(0)
  })

  it('stacks one card per trick with an exact count chip', () => {
    render(<TricksPile count={4} />)
    expect(screen.getByRole('img', { name: '4 tricks won' })).toBeTruthy()
    expect(screen.getAllByTestId('tricks-card')).toHaveLength(4)
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('renders every trick even in a dense pile, fan compressed to fit', () => {
    render(<TricksPile count={9} />)
    expect(screen.getAllByTestId('tricks-card')).toHaveLength(9)
    expect(screen.getByText('9')).toBeTruthy()
  })
})
