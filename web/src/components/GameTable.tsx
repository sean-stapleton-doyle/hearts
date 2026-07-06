import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'
import { runDealAnimation, useFlipLayout } from '../lib/anim'
import { gameKeys } from '../lib/query'
import { seatLayout, type SeatLayoutMode } from '../lib/seatLayout'
import { useGameEvents } from '../lib/sse'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { ActionDock } from './ActionDock'
import { LastTrickPanel } from './TricksPanel'
import { RoundSummary } from './RoundSummary'
import { Scoreboard } from './Scoreboard'
import { TableMenu } from './TableMenu'
import { TableSeat } from './TableSeat'
import { TrickArea } from './TrickArea'
import type { GameView } from '../lib/types'

/** How long the dealer's Deal button may sit unpressed before the table
 *  deals itself, so an AFK dealer still sees the board well before the
 *  server auto-bids. */
const AUTO_DEAL_MS = 15000

/** Non-dealers don't get a button — the deal is the dealer's move. Their
 *  animation starts on its own after a beat (client-side only: the server
 *  has already dealt, so there is nothing to wait for). */
const WATCH_DEAL_MS = 1200

/** How long the round's final showdown holds the felt before the recap
 *  replaces it — without this beat the recap lands the instant the last
 *  card does, and nobody sees who took the final trick. Client-side only:
 *  the server gate is already up; we're just staging what it shows. */
const FINAL_TRICK_LINGER_MS = 4000

const dealtKey = (id: string) => `hearts:dealt:${id}`

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
  try {
    // Dealt this round before a refresh — never re-gate.
    if (sessionStorage.getItem(dealtKey(view.id)) === String(engine.round_index)) {
      return engine.round_index
    }
  } catch {
    /* storage unavailable — fall through to the pristine heuristic */
  }
  const pristine =
    round.bids.every((b) => b == null) &&
    round.tricks_won.every((t) => t === 0) &&
    round.current_trick == null
  // A pristine round (nothing bid or played) gets the deal reveal — this
  // covers the very first round. Anything in progress renders as-is.
  return pristine ? null : engine.round_index
}

export function GameTable({ view }: { view: GameView }) {
  // SSE is live only mid-game; the hook leaves the stream closed otherwise.
  useGameEvents(view.status === 'in_progress' ? view.id : undefined)

  const scope = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [scoresOpen, setScoresOpen] = useState(false)

  // Client-side deal gate: hide the new round's hand and bids behind a Deal
  // button. Initialized once — refetches of the same round can't re-open it;
  // a new round opens it automatically because `dealtRound` lags behind.
  const [dealtRound, setDealtRound] = useState<number | null>(() => initialDealtRound(view))
  const [dealing, setDealing] = useState(false)

  const engine = view.game
  const round = engine?.round ?? null
  const needsDeal = engine != null && round != null && dealtRound !== engine.round_index
  const me = view.players.find((p) => p.is_you)
  const mySeat = me?.seat
  const iAmDealer = round != null && round.dealer === mySeat

  // ≥768px: everyone (you included) rings the felt. Below that, opponents
  // arc across the top and your seat lives in the action dock — exactly one
  // [data-seat] anchor per seat either way, which the deal animation needs.
  const isWide = useMediaQuery('(min-width: 768px)')
  const mode: SeatLayoutMode = isWide ? 'ring' : 'arc'
  const placements =
    mySeat != null ? seatLayout(view.players.map((p) => p.seat), mySeat, mode) : []

  // Bridge every view change into GSAP Flip transitions for any card
  // (shared `data-flip-id` follows a card from hand → trick → winner; the
  // dealer button glides between seats the same way).
  // `dealtRound` is a dep so Flip re-snapshots when the dealt hand mounts:
  // its onEnter animates the reveal instead of the next view change
  // mistaking the whole hand for freshly entering cards.
  useFlipLayout(scope, [view, dealtRound, mode])

  // Round-end gate: server-authoritative via `pending_ack` (survives
  // reloads). The recap content rides in the same view as `pending_recap`,
  // so the gate renders the instant the refetch lands — no dependency on
  // the `round_completed` SSE event arriving first.
  const pendingAck = engine?.pending_ack ?? null
  const recap = engine?.pending_recap ?? null
  const gateOpen = pendingAck != null
  const isHost = me?.is_creator === true

  // The round-end beat: let the final trick's showdown linger before the
  // recap takes the felt. A reload mid-gate restarts the beat — harmless.
  const finale = recap?.tricks?.at(-1) ?? null
  const [finaleDone, setFinaleDone] = useState(false)
  useEffect(() => {
    if (!gateOpen) {
      setFinaleDone(false)
      return
    }
    if (finale == null) {
      setFinaleDone(true)
      return
    }
    const t = setTimeout(() => setFinaleDone(true), FINAL_TRICK_LINGER_MS)
    return () => clearTimeout(t)
    // Keyed on the gate, not the recap object: refetches of the same held
    // round must not restart the beat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateOpen, pendingAck])

  const continueMutation = useMutation({
    mutationFn: (id: string) => api.continueGame(id),
    // SSE drives the actual cache update (round_acknowledged clears the
    // recap, the refetch flips pending_ack to null). The mutation's job is
    // just to fire the request; a 409 not_pending_ack means someone (the
    // sweeper or a double-click) already advanced — refetch and move on.
    onError: () => queryClient.invalidateQueries({ queryKey: gameKeys.detail(view.id) }),
  })

  async function handleDeal() {
    if (dealing || !engine || !round) return
    setDealing(true)
    try {
      if (scope.current) {
        await runDealAnimation({
          scope: scope.current,
          dealerSeat: round.dealer,
          seats: view.players.map((p) => p.seat),
          cardsPerPlayer: round.cards_dealt,
        })
      }
    } finally {
      try {
        sessionStorage.setItem(dealtKey(view.id), String(engine.round_index))
      } catch {
        /* storage unavailable — the pristine heuristic covers a refresh */
      }
      setDealtRound(engine.round_index)
      setDealing(false)
    }
  }
  const handleDealRef = useRef(handleDeal)
  handleDealRef.current = handleDeal

  // Starts once the summary is out of the way: non-dealers watch the deal
  // happen on its own; a dealer who ignores the button gets dealt for.
  useEffect(() => {
    if (!needsDeal || dealing || gateOpen) return
    const t = setTimeout(() => handleDealRef.current(), iAmDealer ? AUTO_DEAL_MS : WATCH_DEAL_MS)
    return () => clearTimeout(t)
  }, [needsDeal, dealing, gateOpen, iAmDealer])

  if (!engine) return null

  const you = engine.you
  const legalBids = you?.legal_bids ?? null
  const legalPlays = you?.legal_plays ?? null
  const myTurn = legalBids != null || legalPlays != null
  const nameBySeat = (seat: number) =>
    view.players.find((p) => p.seat === seat)?.display_name ?? `seat ${seat}`
  const activeSeat = engine.next?.seat

  // Crowded phone tables get the tighter seat treatment.
  const compactSeats = !isWide && view.players.length > 4

  const seatFor = (seat: number, variant: 'ring' | 'dock') => {
    const player = view.players.find((p) => p.seat === seat)
    if (!player) return null
    return (
      <TableSeat
        variant={variant}
        compact={variant === 'ring' && compactSeats}
        name={player.display_name}
        seat={player.seat}
        bid={needsDeal ? null : (round?.bids[player.seat] ?? null)}
        tricks={round?.tricks_won[player.seat] ?? 0}
        isAway={engine.away[player.seat]}
        isActive={activeSeat === player.seat}
        isDealer={round?.dealer === player.seat}
        isYou={player.is_you}
        deadlineInSecs={engine.turn_deadline_in_secs}
      />
    )
  }

  return (
    <div className="table" ref={scope}>
      {/* Wide screens: the score history lives here; the sheet is mobile-only. */}
      <aside className="table__scores-panel">
        <Scoreboard view={view} />
      </aside>

      <div className="table__main">
        <header className="table__bar">
          <div className="flex items-center gap-1">
            <span className="font-display text-base font-extrabold uppercase tracking-wide">
              Round {engine.round_index}
              <span className="ml-2 text-xs font-bold tracking-widest text-mute">
                {engine.phase === 'Bidding' ? 'bidding' : 'playing'}
              </span>
            </span>
            <TableMenu gameId={view.id} players={view.players} away={engine.away} isHost={isHost} />
          </div>
          <button
            type="button"
            className="ghost table__scores-toggle"
            onClick={() => setScoresOpen(true)}
          >
            Scores
          </button>
        </header>

        {/* The felt. Position-only transforms live on seat/play wrappers —
            never on this surface — so GSAP Flip's coordinate math holds. */}
        <section className="table__felt relative min-h-0 flex-1 rounded-[2.5rem] border-4 border-ink bg-felt shadow-[inset_0_0_0_8px_var(--color-felt-deep),6px_6px_0_0_var(--color-ink)]">
          {placements.map((pl) => (
            <div
              key={pl.seat}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pl.xPct}%`, top: `${pl.yPct}%` }}
            >
              {seatFor(pl.seat, 'ring')}
            </div>
          ))}

          {gateOpen && recap && !finaleDone ? (
            // The final showdown gets its beat on the felt before the
            // recap covers it.
            <TrickArea view={view} nameBySeat={nameBySeat} finale={finale} />
          ) : gateOpen && recap ? (
            // Round-end recap gate: the table parks here for everyone until
            // the host acknowledges it. Takes precedence over the deal gate
            // (the next round is already dealt server-side; we just hold the
            // reveal). Centered like the deal gate so Flip's math holds.
            <div className="absolute left-1/2 top-1/2 z-20 flex max-h-[94%] w-[min(92%,24rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto">
              <RoundSummary
                summary={recap}
                players={view.players}
                canContinue={isHost}
                myTurnToBid={legalBids != null}
                onContinue={() => continueMutation.mutate(view.id)}
              />
            </div>
          ) : needsDeal && round ? (
            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
              {iAmDealer ? (
                <>
                  <p className="m-0 font-semibold text-paper/85">You’re dealing</p>
                  <button
                    type="button"
                    className="primary min-w-36"
                    onClick={handleDeal}
                    disabled={dealing}
                  >
                    {dealing ? 'Dealing…' : 'Deal'}
                  </button>
                </>
              ) : (
                <p className="m-0 font-semibold text-paper/85">
                  {nameBySeat(round.dealer)} is dealing…
                </p>
              )}
            </div>
          ) : (
            <TrickArea view={view} nameBySeat={nameBySeat} />
          )}

          {!gateOpen && !needsDeal && engine.phase === 'Playing' && (
            <LastTrickPanel tricks={round?.tricks ?? []} nameBySeat={nameBySeat} />
          )}
        </section>

        {/* Fixed footprint, sized for the tallest state (turn banner + hand +
            confirm button). The felt above is a plain flex-1 sibling, so it
            keeps one constant height across deal/bid/play instead of
            growing or shrinking as this content comes and goes. */}
        <div className="table__dock flex min-h-64 shrink-0 flex-col items-center justify-center gap-2">
          {!needsDeal && !myTurn && activeSeat != null && (
            <p className="m-0 text-center text-sm font-semibold text-mute">
              {nameBySeat(activeSeat)} to {engine.next?.action}
            </p>
          )}

          <ActionDock
            id={view.id}
            hand={you?.hand ?? []}
            legalPlays={legalPlays}
            legalBids={legalBids}
            myTurn={myTurn}
            action={engine.next?.action ?? null}
            showActions={you != null && !needsDeal && !gateOpen}
            seatSlot={!isWide && mySeat != null ? seatFor(mySeat, 'dock') : undefined}
          />
        </div>
      </div>

      {scoresOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setScoresOpen(false)} />
          <div className="sheet">
            <Scoreboard view={view} onClose={() => setScoresOpen(false)} />
          </div>
        </>
      )}
    </div>
  )
}
