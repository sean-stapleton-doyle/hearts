import { useRef } from 'react'

import { useSelectionLift } from '../lib/anim'
import { RANK_LABEL, SUIT_GLYPH, suitToken } from '../lib/cards'
import type { Card as CardModel } from '../lib/types'

export interface CardProps {
  card: CardModel
  /** Interactive (in the hand) vs static display (in the trick). */
  interactive?: boolean
  legal?: boolean
  selected?: boolean
  onClick?: () => void
  size?: 'sm' | 'md' | 'lg'
  /** Override the flip identity (defaults to the card). Set when two
   *  instances of the same card must animate independently. */
  flipId?: string
}

/**
 * A single playing card. This is the isolated art layer: the inner markup
 * (corners + center pip) is a clean placeholder that can be swapped for a
 * real illustration later without touching layout or animation wiring. The
 * outer element carries the `data-flip-id` GSAP Flip keys off of.
 */
export function PlayingCard({
  card,
  interactive = false,
  legal = false,
  selected = false,
  onClick,
  size = 'md',
  flipId,
}: CardProps) {
  const ref = useRef<HTMLButtonElement>(null)
  useSelectionLift(ref, selected)

  const classes = [
    'card',
    `card--${size}`,
    interactive ? 'is-interactive' : 'is-static',
    legal ? 'is-legal' : '',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const suit = suitToken(card.suit)
  const glyph = SUIT_GLYPH[card.suit]
  const rank = RANK_LABEL[card.rank]

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      data-flip-id={flipId ?? `card-${card.rank}-${card.suit}`}
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className={`card__face suit-${suit}`}>
        <span className="card__corner card__corner--top">
          <span className="card__rank">{rank}</span>
          <span className="card__suit">{glyph}</span>
        </span>
        <span className="card__pip">{glyph}</span>
        <span className="card__corner card__corner--bottom">
          <span className="card__rank">{rank}</span>
          <span className="card__suit">{glyph}</span>
        </span>
      </span>
    </button>
  )
}
