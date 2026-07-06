import { useState } from 'react'

import { formatCard, suitToken } from '../lib/cards'
import type { CompletedTrickView } from '../lib/types'

/** One completed trick as a row of compact text chips in play order, the
 *  winner's chip outlined. Text chips rather than `PlayingCard`s: these
 *  cards may simultaneously be lingering in the trick area, and two live
 *  nodes sharing a `data-flip-id` would confuse GSAP Flip. */
export function TrickChips({ trick }: { trick: CompletedTrickView }) {
  return (
    <div className="flex items-center gap-1">
      {trick.plays.map((play) => (
        <span
          key={play.seat}
          data-testid="trick-chip"
          className={`suit-${suitToken(play.card.suit)} rounded-md px-1 text-sm font-bold ${
            play.seat === trick.winner ? 'ring-2 ring-ink' : ''
          }`}
        >
          {formatCard(play.card)}
        </span>
      ))}
    </div>
  )
}

interface TricksPanelProps {
  tricks: CompletedTrickView[]
  nameBySeat: (seat: number) => string
}

/** A compact corner reference for the round's trick history. Collapsed it
 *  shows just the previous trick — cards in play order plus who took it —
 *  so anyone who missed the showdown can still read it mid-trick; clicking
 *  expands it to every completed trick this round, oldest first. */
export function TricksPanel({ tricks, nameBySeat }: TricksPanelProps) {
  const [expanded, setExpanded] = useState(false)
  if (tricks.length === 0) return null

  const shown = expanded ? tricks : tricks.slice(-1)
  const canExpand = tricks.length > 1

  return (
    <button
      type="button"
      onClick={() => canExpand && setExpanded((open) => !open)}
      aria-expanded={expanded}
      className={`absolute bottom-3 left-3 z-10 rounded-xl border-2 border-ink bg-paper px-2.5 py-1.5 text-left shadow-[3px_3px_0_0_var(--color-ink)] ${
        canExpand ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <p className="m-0 text-[0.6rem] font-bold uppercase tracking-widest text-mute">
        {expanded ? 'Tricks this round' : 'Last trick'}
        {canExpand && (
          <span className="ml-1 normal-case tracking-normal">{expanded ? '▾' : `+${tricks.length - 1} ▸`}</span>
        )}
      </p>
      {shown.map((trick, i) => (
        <div key={expanded ? i : tricks.length - 1} className="mt-0.5 flex items-center gap-1.5">
          <TrickChips trick={trick} />
          <span className="max-w-28 truncate text-[0.68rem] font-semibold text-mute">
            {nameBySeat(trick.winner)} took it
          </span>
        </div>
      ))}
    </button>
  )
}
