import { PlayingCard } from './Card'
import type { GameView } from '../lib/types'

interface TrickAreaProps {
  view: GameView
  nameBySeat: (seat: number) => string
}

/** The center of the felt. During bidding it carries a bold round marker
 *  (bids themselves live at the seats); during play, the cards played so
 *  far this trick sit side by side in play order, each with the player's
 *  name underneath, so the sequence of the trick reads at a glance.
 *
 *  When a trick completes the felt doesn't clear: the finished trick
 *  lingers (winner highlighted) until the next lead is played, so everyone
 *  gets to read the showdown. The linger is derived purely from the view
 *  (`current_trick` empty + `last_trick` present), so it survives reloads. */
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

  const current = round?.current_trick ?? null
  const last = round?.tricks.at(-1) ?? null
  const lingering = (current == null || current.plays.length === 0) && last != null
  const trick = lingering ? last : current
  if (!trick || trick.plays.length === 0) {
    return (
      <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm font-semibold text-paper/70">
        waiting for the lead…
      </p>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative flex items-end gap-3">
        {trick.plays.map((play) => (
          <div key={play.seat} className="flex flex-col items-center gap-1">
            <div
              className={
                lingering && last != null && play.seat === last.winner
                  ? 'rounded-lg ring-2 ring-paper'
                  : undefined
              }
            >
              <PlayingCard card={play.card} size="sm" />
            </div>
            <span className="max-w-16 truncate text-center text-[0.68rem] font-semibold text-paper/85">
              {nameBySeat(play.seat)}
            </span>
          </div>
        ))}
        {/* Absolutely positioned so the cards don't shift when it appears. */}
        {lingering && last != null && (
          <p className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-semibold text-paper/85">
            {nameBySeat(last.winner)} takes the trick
          </p>
        )}
      </div>
    </div>
  )
}
