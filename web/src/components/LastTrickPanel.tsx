import { formatCard, suitToken } from '../lib/cards'
import type { CompletedTrickView } from '../lib/types'

interface LastTrickPanelProps {
  trick: CompletedTrickView | null
  nameBySeat: (seat: number) => string
}

/** A compact corner reference showing the previous trick — cards in play
 *  order plus who took it — so anyone who missed the showdown can still
 *  read it mid-trick. Text chips rather than `PlayingCard`s: these cards
 *  may simultaneously be lingering in the trick area, and two live nodes
 *  sharing a `data-flip-id` would confuse GSAP Flip. */
export function LastTrickPanel({ trick, nameBySeat }: LastTrickPanelProps) {
  if (!trick) return null

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-xl border-2 border-ink bg-paper px-2.5 py-1.5 shadow-[3px_3px_0_0_var(--color-ink)]">
      <p className="m-0 text-[0.6rem] font-bold uppercase tracking-widest text-mute">
        Last trick
      </p>
      <div className="mt-0.5 flex items-center gap-1">
        {trick.plays.map((play) => (
          <span
            key={play.seat}
            data-testid="last-trick-chip"
            className={`suit-${suitToken(play.card.suit)} rounded-md px-1 text-sm font-bold ${
              play.seat === trick.winner ? 'ring-2 ring-ink' : ''
            }`}
          >
            {formatCard(play.card)}
          </span>
        ))}
      </div>
      <p className="m-0 mt-0.5 max-w-36 truncate text-[0.68rem] font-semibold text-mute">
        {nameBySeat(trick.winner)} took it
      </p>
    </div>
  )
}
