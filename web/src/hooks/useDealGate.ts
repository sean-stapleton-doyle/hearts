import { useEffect, useEffectEvent, useState } from 'react'

import type { GameView } from '../lib/types'

/** How long the dealer's Deal button may sit unpressed before the table
 *  deals itself, so an AFK dealer still sees the board well before the
 *  server auto-bids. */
const AUTO_DEAL_MS = 15000

/** Non-dealers don't get a button — the deal is the dealer's move. Their
 *  animation starts on its own after a beat (client-side only: the server
 *  has already dealt, so there is nothing to wait for). */
const WATCH_DEAL_MS = 1200

const dealtKey = (id: string) => `hearts:dealt:${id}`

// sessionStorage can throw (private mode, storage disabled); the gate
// degrades to the pristine-round heuristic when it does.
function readDealtRound(id: string): number | null {
  try {
    const raw = sessionStorage.getItem(dealtKey(id))
    return raw == null ? null : Number(raw)
  } catch {
    return null
  }
}
function writeDealtRound(id: string, round: number): void {
  try {
    sessionStorage.setItem(dealtKey(id), String(round))
  } catch {
    /* unavailable — the pristine heuristic covers a refresh */
  }
}

/**
 * Where to start the client-side deal gate when the table mounts. The server
 * has always already dealt; the gate only decides whether to stage the reveal.
 * Returns the round to treat as "already dealt" (gate closed), or null to
 * leave the gate open for the current round.
 */
function initialDealtRound(view: GameView): number | null {
  const engine = view.game
  const round = engine?.round
  if (!engine || !round) return null
  // Dealt this round before a refresh — never re-gate.
  if (readDealtRound(view.id) === engine.round_index) return engine.round_index
  const pristine =
    round.bids.every((b) => b == null) &&
    round.tricks_won.every((t) => t === 0) &&
    round.current_trick == null
  // A pristine round (nothing bid or played) gets the deal reveal — this
  // covers the very first round. Anything in progress renders as-is.
  return pristine ? null : engine.round_index
}

/**
 * The client-side deal gate: hides a fresh round's hand and bids behind a
 * Deal button, runs the caller-supplied deal animation, and remembers the
 * dealt round across refreshes (sessionStorage). Initialized once —
 * refetches of the same round can't re-open it; a new round opens it
 * automatically because `dealtRound` lags behind.
 */
export function useDealGate(
  view: GameView,
  opts: {
    /** The recap gate suppresses auto-dealing while it holds the table. */
    gateOpen: boolean
    /** Plays the fly-out animation; the gate opens the hand when it settles. */
    runDeal: () => Promise<void>
  },
): {
  needsDeal: boolean
  dealing: boolean
  iAmDealer: boolean
  deal: () => Promise<void>
  /** The round whose hand is currently revealed — a Flip-layout dep so the
   *  reveal animates as an enter, not a layout shift (see GameTable). */
  dealtRound: number | null
} {
  const [dealtRound, setDealtRound] = useState<number | null>(() => initialDealtRound(view))
  const [dealing, setDealing] = useState(false)

  const engine = view.game
  const round = engine?.round ?? null
  const needsDeal = engine != null && round != null && dealtRound !== engine.round_index
  const mySeat = view.players.find((p) => p.is_you)?.seat
  const iAmDealer = round != null && round.dealer === mySeat

  async function deal(): Promise<void> {
    if (dealing || !engine || !round) return
    setDealing(true)
    try {
      await opts.runDeal()
    } finally {
      writeDealtRound(view.id, engine.round_index)
      setDealtRound(engine.round_index)
      setDealing(false)
    }
  }

  // Starts once the summary is out of the way: non-dealers watch the deal
  // happen on its own; a dealer who ignores the button gets dealt for.
  // (`useEffectEvent` reads the latest `deal` without making the timer
  // re-arm on every render.)
  const fireDeal = useEffectEvent(() => void deal())
  useEffect(() => {
    if (!needsDeal || dealing || opts.gateOpen) return
    const t = setTimeout(fireDeal, iAmDealer ? AUTO_DEAL_MS : WATCH_DEAL_MS)
    return () => clearTimeout(t)
  }, [needsDeal, dealing, opts.gateOpen, iAmDealer])

  return { needsDeal, dealing, iAmDealer, deal, dealtRound }
}
