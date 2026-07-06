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

/** A trick's chips plus who won it — the caption row shared by the
 *  last-trick panel and the round recap's final-trick block. */
export function TrickTakenLine({
  trick,
  takerName,
}: {
  trick: CompletedTrickView
  takerName: string
}) {
  return (
    <div className="mt-0.5 flex items-center gap-1.5">
      <TrickChips trick={trick} />
      <span className="max-w-28 truncate text-[0.68rem] font-semibold text-mute">
        {takerName} took it
      </span>
    </div>
  )
}

interface LastTrickPanelProps {
  tricks: CompletedTrickView[]
  nameBySeat: (seat: number) => string
}

/** A compact corner reference showing only the previous trick — cards in
 *  play order plus who took it — so anyone who missed the showdown can
 *  still read it mid-trick. Deliberately not the whole round's history:
 *  remembering earlier tricks is part of the game. (The server still
 *  retains every trick for post-game review.) */
export function LastTrickPanel({ tricks, nameBySeat }: LastTrickPanelProps) {
  const last = tricks.at(-1)
  if (!last) return null

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-xl border-2 border-ink bg-paper px-2.5 py-1.5 shadow-[3px_3px_0_0_var(--color-ink)]">
      <p className="m-0 text-[0.6rem] font-bold uppercase tracking-widest text-mute">
        Last trick
      </p>
      <TrickTakenLine trick={last} takerName={nameBySeat(last.winner)} />
    </div>
  )
}
