import { PlayingCard } from './Card'
import type { GameView } from '../lib/types'

interface TrickAreaProps {
  view: GameView
  nameBySeat: (seat: number) => string
}

/** The center of the felt. During bidding it carries a bold round marker
 *  (bids themselves live at the seats); during play, the cards played so
 *  far this trick sit side by side in play order, each with the player's
 *  name underneath, so the sequence of the trick reads at a glance. */
export function TrickArea({ view, nameBySeat }: TrickAreaProps) {
  const engine = view.game!
  const round = engine.round

  if (engine.phase === 'Bidding' && round) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-paper">
        <p className="font-display text-3xl font-extrabold uppercase tracking-wide [font-stretch:118%]">
          Round {engine.round_index}
        </p>
        <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-paper/75">
          {round.cards_dealt} {round.cards_dealt === 1 ? 'card' : 'cards'} · ♥ trump
        </p>
      </div>
    )
  }

  const trick = round?.current_trick ?? null
  if (!trick || trick.plays.length === 0) {
    return (
      <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm font-semibold text-paper/70">
        waiting for the lead…
      </p>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex items-end gap-3">
        {trick.plays.map((play) => (
          <div key={play.seat} className="flex flex-col items-center gap-1">
            <PlayingCard card={play.card} size="sm" />
            <span className="max-w-16 truncate text-center text-[0.68rem] font-semibold text-paper/85">
              {nameBySeat(play.seat)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
