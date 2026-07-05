import { useEffect, useState, type ReactNode } from 'react'
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
  /** Your own seat strip on small screens (carries `data-seat` for the
   *  deal animation, which needs an anchor for every seat). */
  seatSlot?: ReactNode
}

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
  seatSlot,
}: ActionDockProps) {
  const queryClient = useQueryClient()
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [selectedBid, setSelectedBid] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Clear any in-flight selection whenever the turn hands off.
  useEffect(() => {
    setSelectedCard(null)
    setSelectedBid(null)
    setError(null)
  }, [myTurn, legalPlays, legalBids])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: gameKeys.detail(id) })
  const playMutation = useMutation({
    mutationFn: (card: Card) => api.play(id, card),
    onSettled: invalidate,
    onError: (e) => setError(isApiError(e) ? e.message : 'could not play'),
  })
  const bidMutation = useMutation({
    mutationFn: (bid: number) => api.bid(id, bid),
    onSettled: invalidate,
    onError: (e) => setError(isApiError(e) ? e.message : 'could not bid'),
  })

  const pending = playMutation.isPending || bidMutation.isPending
  function confirm() {
    if (legalPlays != null && selectedCard) playMutation.mutate(selectedCard)
    else if (legalBids != null && selectedBid != null) bidMutation.mutate(selectedBid)
  }

  const legalIds = new Set((legalPlays ?? []).map(cardId))
  const sorted = sortHand(hand)
  const isPlay = legalPlays != null
  const hasSelection = selectedCard != null || selectedBid != null

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
                  className={`chip ${selectedBid === bid ? 'is-selected' : ''}`}
                  onClick={() => setSelectedBid(bid)}
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
                const selected = selectedCard != null && cardId(selectedCard) === cid
                return (
                  <PlayingCard
                    key={cid}
                    card={card}
                    interactive={isPlay}
                    legal={legal}
                    selected={selected}
                    onClick={() => legal && setSelectedCard(card)}
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
          {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
  )
}
