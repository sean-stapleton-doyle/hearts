import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '../lib/api'
import { runDealAnimation, useFlipLayout } from '../lib/anim'
import { chatOptions, gameKeys } from '../lib/query'
import { seatNamer } from '../lib/players'
import { seatLayout, type SeatLayoutMode } from '../lib/seatLayout'
import { useGameEvents } from '../lib/sse'
import { useCountdown } from '../hooks/useCountdown'
import { useDealGate } from '../hooks/useDealGate'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { ActionDock } from './ActionDock'
import { ChatPanel } from './ChatPanel'
import { FeltCenter, type FeltStage } from './FeltCenter'
import { LastTrickPanel } from './TricksPanel'
import { Scoreboard } from './Scoreboard'
import { SeatBubble, useSeatBubbles } from './SeatBubble'
import { TableMenu } from './TableMenu'
import { TableSeat, type SeatModel } from './TableSeat'
import type { GameView } from '../lib/types'

/** How long the round's final showdown holds the felt before the recap
 *  replaces it — without this beat the recap lands the instant the last
 *  card does, and nobody sees who took the final trick. Client-side only:
 *  the server gate is already up; we're just staging what it shows. */
const FINAL_TRICK_LINGER_MS = 4000

/** Seconds left on your own clock at which we fire the timeout warning —
 *  below the countdown ring's `is-low` (≤30s) so it reads as more urgent. */
const TIMEOUT_WARN_SECS = 20

/**
 * Fires the two turn-related toasts, isolated in its own component so its
 * hooks only run once the engine exists (the parent bails with `return null`
 * before its turn state is computed). Renders nothing.
 *
 * Both toasts are guarded by `turnKey` so they fire at most once per turn:
 * a "your turn" nudge when the turn hands to you, and a warning when your own
 * clock runs low. Fixed toast ids keep repeats from stacking.
 */
function TurnAlerts({
  myTurn,
  action,
  turnKey,
  deadlineInSecs,
}: {
  myTurn: boolean
  action: 'bid' | 'play' | null
  turnKey: string
  deadlineInSecs: number
}) {
  const nudged = useRef<string | null>(null)
  useEffect(() => {
    if (!myTurn || nudged.current === turnKey) return
    nudged.current = turnKey
    toast(`Your turn to ${action ?? 'play'}`, { id: 'your-turn' })
  }, [myTurn, turnKey, action])

  const remaining = useCountdown(myTurn ? deadlineInSecs : undefined)
  const warned = useRef<string | null>(null)
  useEffect(() => {
    if (!myTurn || remaining == null || remaining > TIMEOUT_WARN_SECS) return
    if (warned.current === turnKey) return
    warned.current = turnKey
    toast.warning("You're about to run out of time!", { id: 'timeout-warn' })
  }, [myTurn, remaining, turnKey])

  return null
}

/**
 * The round-end beat: hold the felt on the final showdown for a moment
 * before the recap takes it. Keyed on the gate, not the recap object —
 * refetches of the same held round must not restart the beat. A reload
 * mid-gate restarts it, which is harmless.
 */
function useFinaleBeat(gateOpen: boolean, pendingAck: number | null, hasFinale: boolean): boolean {
  const [done, setDone] = useState(false)
  const skipBeat = useEffectEvent(() => !hasFinale)
  useEffect(() => {
    if (!gateOpen) {
      setDone(false)
      return
    }
    if (skipBeat()) {
      setDone(true)
      return
    }
    const t = setTimeout(() => setDone(true), FINAL_TRICK_LINGER_MS)
    return () => clearTimeout(t)
  }, [gateOpen, pendingAck])
  return done
}

export function GameTable({ view }: { view: GameView }) {
  // SSE is live only mid-game; the hook leaves the stream closed otherwise.
  useGameEvents(view.status === 'in_progress' ? view.id : undefined)

  const scope = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [scoresOpen, setScoresOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  // Chat log: seeded from the history GET, appended by the SSE bridge.
  const chat = useQuery(chatOptions(view.id))
  const messages = chat.data ?? []
  const bubbles = useSeatBubbles(messages, chat.isFetched)
  const maxChatId = messages.length ? messages[messages.length - 1].id : 0
  // Unread dot on the Chat button. Baseline to the loaded backlog once (so old
  // history doesn't read as unread), then track: open marks everything seen.
  const seenChatId = useRef<number | null>(null)
  if (seenChatId.current === null && chat.isFetched) seenChatId.current = maxChatId
  if (chatOpen) seenChatId.current = maxChatId
  const hasUnreadChat =
    !chatOpen && seenChatId.current !== null && maxChatId > seenChatId.current

  // Escape closes whichever overlay is open, matching the backdrop tap.
  useEffect(() => {
    if (!scoresOpen && !chatOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setScoresOpen(false)
      setChatOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scoresOpen, chatOpen])

  const engine = view.game
  const round = engine?.round ?? null
  const me = view.players.find((p) => p.is_you)
  const mySeat = me?.seat
  const isHost = me?.is_creator === true

  // Round-end gate: server-authoritative via `pending_ack` (survives
  // reloads). The recap content rides in the same view as `pending_recap`,
  // so the gate renders the instant the refetch lands — no dependency on
  // the `round_completed` SSE event arriving first.
  const pendingAck = engine?.pending_ack ?? null
  const recap = engine?.pending_recap ?? null
  const gateOpen = pendingAck != null
  const finale = recap?.tricks?.at(-1) ?? null
  const finaleDone = useFinaleBeat(gateOpen, pendingAck, finale != null)

  const dealGate = useDealGate(view, {
    gateOpen,
    runDeal: async () => {
      if (scope.current && round) {
        await runDealAnimation({
          scope: scope.current,
          dealerSeat: round.dealer,
          seats: view.players.map((p) => p.seat),
          cardsPerPlayer: round.cards_dealt,
        })
      }
    },
  })
  const { needsDeal } = dealGate

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
  useFlipLayout(scope, [view, dealGate.dealtRound, mode])

  const continueMutation = useMutation({
    mutationFn: (id: string) => api.continueGame(id),
    // SSE drives the actual cache update (round_acknowledged clears the
    // recap, the refetch flips pending_ack to null). The mutation's job is
    // just to fire the request; a 409 not_pending_ack means someone (the
    // sweeper or a double-click) already advanced — refetch and move on.
    onError: () => queryClient.invalidateQueries({ queryKey: gameKeys.detail(view.id) }),
  })

  if (!engine) return null

  const you = engine.you
  const legalBids = you?.legal_bids ?? null
  const legalPlays = you?.legal_plays ?? null
  const myTurn = legalBids != null || legalPlays != null
  const nameBySeat = seatNamer(view.players)
  const activeSeat = engine.next?.seat
  // Include the completed-trick count so a trick winner leading back-to-back
  // tricks — same round, seat, and action — still gets a fresh key, clearing
  // ActionDock's stale selection (otherwise the confirm button stays lit on a
  // card that's already been played).
  const turnKey = `${engine.round_index}:${round?.tricks.length ?? 0}:${engine.next?.seat ?? '-'}:${engine.next?.action ?? '-'}`

  const stage: FeltStage =
    gateOpen && recap && finale && !finaleDone
      ? { kind: 'finale', finale }
      : gateOpen && recap
        ? { kind: 'recap', recap }
        : needsDeal && round
          ? { kind: 'deal' }
          : { kind: 'trick' }

  // Crowded phone tables get the tighter seat treatment.
  const compactSeats = !isWide && view.players.length > 4

  const seatModel = (seat: number): SeatModel | null => {
    const player = view.players.find((p) => p.seat === seat)
    if (!player) return null
    return {
      player,
      bid: needsDeal ? null : (round?.bids[seat] ?? null),
      tricks: round?.tricks_won[seat] ?? 0,
      isAway: engine.away[seat],
      isActive: activeSeat === seat,
      isDealer: round?.dealer === seat,
      deadlineInSecs: engine.turn_deadline_in_secs,
      deadlineTotalSecs: engine.turn_timeout_secs,
    }
  }

  const seatFor = (seat: number, variant: 'ring' | 'dock') => {
    const model = seatModel(seat)
    if (!model) return null
    return (
      <TableSeat seat={model} variant={variant} compact={variant === 'ring' && compactSeats} />
    )
  }

  return (
    <div className="table" ref={scope}>
      <TurnAlerts
        myTurn={myTurn}
        action={engine.next?.action ?? null}
        turnKey={turnKey}
        deadlineInSecs={engine.turn_deadline_in_secs}
      />
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="ghost table__chat-toggle relative"
              onClick={() => setChatOpen(true)}
            >
              Chat
              {hasUnreadChat && <span className="table__chat-dot" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="ghost table__scores-toggle"
              onClick={() => setScoresOpen(true)}
            >
              Scores
            </button>
          </div>
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
              {/* Top-of-felt seats drop the bubble below so it can't clip off
                  the felt's top edge. */}
              <SeatBubble message={bubbles[pl.seat] ?? null} below={pl.yPct < 40} />
            </div>
          ))}

          <FeltCenter
            stage={stage}
            engine={engine}
            players={view.players}
            nameBySeat={nameBySeat}
            isHost={isHost}
            myTurnToBid={legalBids != null}
            iAmDealer={dealGate.iAmDealer}
            dealing={dealGate.dealing}
            onDeal={() => void dealGate.deal()}
            onContinue={() => continueMutation.mutate(view.id)}
          />

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
            turnKey={turnKey}
            seatSlot={!isWide && mySeat != null ? seatFor(mySeat, 'dock') : undefined}
          />
        </div>
      </div>

      {scoresOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setScoresOpen(false)} />
          <div className="sheet">
            <Scoreboard view={view} onClose={() => setScoresOpen(false)} />
            <button type="button" className="sheet__close" onClick={() => setScoresOpen(false)}>
              Close scores
            </button>
          </div>
        </>
      )}

      {chatOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setChatOpen(false)} />
          <ChatPanel
            gameId={view.id}
            messages={messages}
            canSend={view.status === 'in_progress'}
            onClose={() => setChatOpen(false)}
          />
        </>
      )}
    </div>
  )
}
