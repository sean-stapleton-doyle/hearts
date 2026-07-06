import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GameTable } from './GameTable'
import type { GameView, PendingRecap, RoundSummary } from '../lib/types'

vi.mock('../lib/sse', () => ({ useGameEvents: () => {} }))
vi.mock('../lib/anim', async () => {
  const actual = await vi.importActual<typeof import('../lib/anim')>('../lib/anim')
  return { ...actual, runDealAnimation: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      play: vi.fn().mockResolvedValue({ seq: 5 }),
      bid: vi.fn().mockResolvedValue({ seq: 5 }),
      continueGame: vi.fn().mockResolvedValue({ seq: 11 }),
    },
  }
})

// My turn to play a single Heart; the only legal card is the 2♥.
const myTurnView = {
  id: 'g1',
  invite_code: 'C',
  status: 'in_progress',
  players: [
    { seat: 0, display_name: 'alice', is_you: false, is_creator: true },
    { seat: 1, display_name: 'bob', is_you: true, is_creator: false },
  ],
  game: {
    phase: 'Playing',
    round_index: 1,
    scores: [0, 0],
    next: { action: 'play', seat: 1 },
    away: [false, false],
    turn_deadline_in_secs: 300,
    pending_ack: null,
    round: {
      cards_dealt: 1,
      dealer: 0,
      bids: [0, 0],
      tricks_won: [0, 0],
      current_trick: {
        leader: 0,
        plays: [{ seat: 0, card: { suit: 'Spades', rank: 'Ten' } }],
      },
      tricks: [],
    },
    you: {
      seat: 1,
      hand: [{ suit: 'Hearts', rank: 'Two' }],
      legal_bids: null,
      legal_plays: [{ suit: 'Hearts', rank: 'Two' }],
    },
  },
} as unknown as GameView

// A brand-new round: nothing bid or played yet, so the deal gate is open.
const freshRoundView = {
  ...myTurnView,
  id: 'g2',
  game: {
    phase: 'Bidding',
    round_index: 2,
    scores: [3, 1],
    next: { action: 'bid', seat: 1 },
    away: [false, false],
    turn_deadline_in_secs: 300,
    pending_ack: null,
    round: {
      cards_dealt: 2,
      dealer: 1,
      bids: [null, null],
      tricks_won: [0, 0],
      current_trick: null,
      tricks: [],
    },
    you: {
      seat: 1,
      hand: [
        { suit: 'Hearts', rank: 'Two' },
        { suit: 'Clubs', rank: 'Ace' },
      ],
      legal_bids: [0, 1, 2],
      legal_plays: null,
    },
  },
} as unknown as GameView

const roundSummary: RoundSummary = {
  type: 'round_completed',
  seq: 9,
  round_index: 1,
  bids: [0, 1],
  tricks_won: [1, 0],
  deltas: [-1, -1],
  scores: [2, 3],
  next_round_index: 2,
  next_dealer: 1,
  next: { action: 'bid', seat: 0 },
}

// The recap as it rides in the engine view (`pending_recap`) — same data
// as `roundSummary`, minus the SSE-envelope-only `type`/`seq`/`next` fields.
const pendingRecap: PendingRecap = {
  round_index: roundSummary.round_index,
  bids: roundSummary.bids,
  tricks_won: roundSummary.tricks_won,
  deltas: roundSummary.deltas,
  scores: roundSummary.scores,
  next_round_index: roundSummary.next_round_index,
  next_dealer: roundSummary.next_dealer,
  tricks: [
    {
      leader: 0,
      winner: 0,
      plays: [
        { seat: 0, card: { suit: 'Diamonds', rank: 'Queen' } },
        { seat: 1, card: { suit: 'Diamonds', rank: 'Three' } },
      ],
    },
  ],
}

// Round 1 just completed and is held open on the gate; the engine has
// already advanced to round 2's bidding (`pending_ack: 1`). Viewer is bob
// (seat 1). In the host variant he is the creator (Continue button); in the
// guest variant alice is the creator (waiting message).
const heldGateHostView = {
  ...myTurnView,
  id: 'g-gate',
  players: [
    { seat: 0, display_name: 'alice', is_you: false, is_creator: false },
    { seat: 1, display_name: 'bob', is_you: true, is_creator: true },
  ],
  game: {
    ...myTurnView.game!,
    pending_ack: 1,
    pending_recap: pendingRecap,
  },
} as unknown as GameView

// Same hold, but alice (seat 0) is the creator — bob is a non-host guest.
const heldGateGuestView = (() => {
  const v = structuredClone(heldGateHostView) as GameView & {
    game: NonNullable<GameView['game']>
  }
  v.id = 'g-gate2'
  v.players = [
    { seat: 0, display_name: 'alice', is_you: false, is_creator: true },
    { seat: 1, display_name: 'bob', is_you: true, is_creator: false },
  ]
  return v
})()

// Between tricks: the previous trick just resolved, nobody has led yet.
const lingerView = (() => {
  const v = structuredClone(myTurnView) as GameView & {
    game: NonNullable<GameView['game']>
  }
  v.id = 'g-linger'
  v.game.round!.current_trick = { leader: 1, plays: [] }
  v.game.round!.tricks = [
    {
      leader: 0,
      winner: 1,
      plays: [
        { seat: 0, card: { suit: 'Spades', rank: 'Ten' } },
        { seat: 1, card: { suit: 'Spades', rank: 'King' } },
      ],
    },
  ]
  v.game.round!.tricks_won = [0, 1]
  return v
})()

function renderWithClient(node: React.ReactNode, queryClient?: QueryClient) {
  const client =
    queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>), client }
}

describe('GameTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  it('selects a legal card and submits it via confirm', async () => {
    const { api } = await import('../lib/api')
    renderWithClient(<GameTable view={myTurnView} />)

    // Confirm is inert until a card is chosen.
    const confirm = screen.getByText('Play card') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Two of Hearts' }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    await vi.waitFor(() => {
      expect(api.play).toHaveBeenCalledWith('g1', { suit: 'Hearts', rank: 'Two' })
    })
  })

  it('does not let you submit until a legal card is chosen', () => {
    renderWithClient(<GameTable view={myTurnView} />)
    const confirm = screen.getByText('Play card') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    const card = screen.getByRole('button', { name: 'Two of Hearts' }) as HTMLButtonElement
    expect(card.disabled).toBe(false)
  })

  it('gates a pristine round behind the Deal button and reveals on press', async () => {
    renderWithClient(<GameTable view={freshRoundView} />)

    // Hand and bid picker stay hidden until dealt.
    expect(screen.queryByRole('button', { name: 'Two of Hearts' })).toBeNull()
    expect(screen.queryByText('Place bid')).toBeNull()
    expect(screen.getByText('You’re dealing')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Deal' }))
    await vi.waitFor(() => {
      expect(screen.getByText('Place bid')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Two of Hearts' })).toBeTruthy()
    expect(sessionStorage.getItem('hearts:dealt:g2')).toBe('2')
  })

  it('shows no deal gate for a round already in progress', () => {
    renderWithClient(<GameTable view={myTurnView} />)
    expect(screen.queryByRole('button', { name: 'Deal' })).toBeNull()
  })

  it('gives the Deal button to the dealer only', () => {
    // Same pristine round, but seat 0 (alice) deals — the viewer just watches.
    const watching = structuredClone(freshRoundView) as GameView & { game: NonNullable<GameView['game']> }
    watching.id = 'g3'
    watching.game.round!.dealer = 0
    renderWithClient(<GameTable view={watching} />)
    expect(screen.queryByRole('button', { name: 'Deal' })).toBeNull()
    expect(screen.getByText('alice is dealing…')).toBeTruthy()
  })

  it('marks the dealer with a chip', () => {
    // freshRoundView: seat 1 (you) deals.
    renderWithClient(<GameTable view={freshRoundView} />)
    expect(screen.getByTitle('Dealer')).toBeTruthy()
  })

  it('renders exactly one dealer chip and one active seat', () => {
    const { container } = renderWithClient(<GameTable view={myTurnView} />)
    expect(screen.getAllByTitle('Dealer')).toHaveLength(1)
    // The active (to-act) seat is exposed semantically, not via class names.
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  })

  it('renders the round gate embedded and lets the host continue', async () => {
    const { api } = await import('../lib/api')
    renderWithClient(<GameTable view={heldGateHostView} />)

    // Recap is embedded on the felt (aria-label, not a modal dialog role).
    expect(screen.getByLabelText('Round 1 complete')).toBeTruthy()
    expect(screen.getByText('You deal round 2')).toBeTruthy()

    // The completed round's tricks show what was played.
    const chips = screen.getAllByTestId('trick-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['Q♦', '3♦'])
    expect(screen.getByText('alice took it')).toBeTruthy()

    // Host sees and clicks Continue; the mutation fires.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => {
      expect(api.continueGame).toHaveBeenCalledWith('g-gate')
    })
  })

  it('lingers the completed trick until the next lead', () => {
    renderWithClient(<GameTable view={lingerView} />)

    // The showdown stays on the felt: both cards plus the winner caption.
    expect(screen.getByRole('button', { name: 'Ten of Spades' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'King of Spades' })).toBeTruthy()
    expect(screen.getByText('bob takes the trick')).toBeTruthy()
    expect(screen.queryByText('waiting for the lead…')).toBeNull()

    // The corner reference panel carries the same trick.
    expect(screen.getByText('Last trick')).toBeTruthy()
    expect(screen.getByText('bob took it')).toBeTruthy()
  })

  it('shows no winner caption while a trick is in progress', () => {
    // myTurnView: one card played, trick still open, no last_trick yet.
    renderWithClient(<GameTable view={myTurnView} />)
    expect(screen.queryByText(/takes the trick/)).toBeNull()
    expect(screen.queryByText('Last trick')).toBeNull()
  })

  it('tells non-hosts to wait for the host at the round gate', () => {
    renderWithClient(<GameTable view={heldGateGuestView} />)

    expect(screen.getByText(/Waiting for alice to continue/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })
})
