import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, isApiError } from '../lib/api'
import { cardId, sortHand } from '../lib/cards'
import { gameKeys } from '../lib/query'
import { PlayingCard } from './Card'
import type { Card } from '../lib/types'

interface ActionDockProps {
  id: string
  hand: Card[]
  legalPlays: Card[] | null
  legalBids: number[] | null
  myTurn: boolean
  /** What the banner shouts when it's your turn. */
  action: 'bid' | 'play' | null
  /** False while the deal gate hides the fresh hand. */
  showActions: boolean
  /** Changes whenever the turn hands off (round/seat/action) — any stored
   *  selection from another turn reads as empty (see `Selection`). */
  turnKey: string
  /** Your own seat strip on small screens (carries `data-seat` for the
   *  deal animation, which needs an anchor for every seat). */
  seatSlot?: ReactNode
}

/** In-flight selection, tagged with the turn it belongs to. Rather than an
 *  effect that clears state when the turn changes, stale selections are
 *  simply never read: `current()` returns the empty selection whenever the
 *  stored key isn't this turn's. (A `key`-remount would also reset state,
 *  but unmounting the hand's `data-flip-id` nodes breaks GSAP Flip.) */
interface Selection {
  key: string
  card: Card | null
  bid: number | null
  error: string | null
}
const emptySelection = (key: string): Selection => ({ key, card: null, bid: null, error: null })

/** The strip beneath the felt where you act: your seat identity (small
 *  screens), a loud turn banner, the bid picker or fanned hand, and the
 *  confirm button. Mutations render from the server response — never
 *  optimistically. */
export function ActionDock({
  id,
  hand,
  legalPlays,
  legalBids,
  myTurn,
  action,
  showActions,
  turnKey,
  seatSlot,
}: ActionDockProps) {
  const queryClient = useQueryClient()
  const [stored, setStored] = useState<Selection>(() => emptySelection(turnKey))
  // A selection stored under another turn's key reads as empty — the reset
  // happens by derivation, no effect needed.
  const sel = stored.key === turnKey ? stored : emptySelection(turnKey)
  const patchSel = (patch: Partial<Selection>) =>
    setStored((prev) => ({ ...(prev.key === turnKey ? prev : emptySelection(turnKey)), ...patch }))

  const invalidate = () => queryClient.invalidateQueries({ queryKey: gameKeys.detail(id) })
  const playMutation = useMutation({
    mutationFn: (card: Card) => api.play(id, card),
    onSettled: invalidate,
    onError: (e) => patchSel({ error: isApiError(e) ? e.message : 'could not play' }),
  })
  const bidMutation = useMutation({
    mutationFn: (bid: number) => api.bid(id, bid),
    onSettled: invalidate,
    onError: (e) => patchSel({ error: isApiError(e) ? e.message : 'could not bid' }),
  })

  const pending = playMutation.isPending || bidMutation.isPending
  function confirm() {
    if (legalPlays != null && sel.card) playMutation.mutate(sel.card)
    else if (legalBids != null && sel.bid != null) bidMutation.mutate(sel.bid)
  }

  const legalIds = new Set((legalPlays ?? []).map(cardId))
  const sorted = sortHand(hand)
  const isPlay = legalPlays != null
  const hasSelection = sel.card != null || sel.bid != null

  return (
    <section className="flex flex-col items-center gap-2">
      {seatSlot}

      {showActions && (
        <>
          {myTurn && action != null && (
            <p className="rounded-md border-2 border-ink bg-trump px-4 py-1 font-display text-sm font-extrabold uppercase tracking-widest text-white shadow-hard-sm">
              Your {action}
            </p>
          )}

          {legalBids != null && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {legalBids.map((bid) => (
                <button
                  key={bid}
                  type="button"
                  className={`chip ${sel.bid === bid ? 'is-selected' : ''}`}
                  onClick={() => patchSel({ bid })}
                  disabled={pending}
                >
                  {bid}
                </button>
              ))}
            </div>
          )}

          {sorted.length > 0 && (
            <div className="hand__row">
              {sorted.map((card) => {
                const cid = cardId(card)
                const legal = isPlay && legalIds.has(cid)
                const selected = sel.card != null && cardId(sel.card) === cid
                return (
                  <PlayingCard
                    key={cid}
                    card={card}
                    interactive={isPlay}
                    legal={legal}
                    selected={selected}
                    onClick={() => legal && patchSel({ card })}
                  />
                )
              })}
            </div>
          )}

          {myTurn && (
            <button
              type="button"
              className="confirm"
              onClick={confirm}
              disabled={!hasSelection || pending}
            >
              {pending ? 'Sending…' : isPlay ? 'Play card' : 'Place bid'}
            </button>
          )}
          {sel.error && <p className="error">{sel.error}</p>}
        </>
      )}
    </section>
  )
}
