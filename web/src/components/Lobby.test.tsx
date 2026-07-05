import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Lobby } from './Lobby'
import type { GameView } from '../lib/types'

// The mock factory is hoisted above imports, so it must not reference any
// top-level binding — resolve values inline.
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      startGame: vi.fn().mockResolvedValue({ id: 'g1', status: 'in_progress', game: { phase: 'Bidding' } }),
    },
  }
})

// Creator with one other player seated → start is enabled.
const lobbyView = {
  id: 'g1',
  invite_code: 'MJTZ6C',
  status: 'lobby',
  players: [
    { seat: 0, display_name: 'alice', is_you: true, is_creator: true },
    { seat: 1, display_name: 'bob', is_you: false, is_creator: false },
  ],
  game: null,
} as unknown as GameView

function renderWithClient(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

describe('Lobby', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('shows the invite code and lets the creator start with ≥2 players', async () => {
    const { api } = await import('../lib/api')
    renderWithClient(<Lobby view={lobbyView} />)

    expect(screen.getByText('MJTZ6C')).toBeTruthy()
    const start = screen.getByText('Start game')
    fireEvent.click(start)

    await vi.waitFor(() => {
      expect(api.startGame).toHaveBeenCalledWith('g1')
    })
  })
})
