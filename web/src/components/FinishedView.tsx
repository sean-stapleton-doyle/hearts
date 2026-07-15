import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { nameBySeat, playerBySeat } from '../lib/players'
import { gameResultOptions } from '../lib/query'
import { PlayingCard } from './Card'
import type { CompletedTrickView, GameView, PlayerInfo } from '../lib/types'

/** How long the game's final showdown holds before the standings take over.
 *  The last round is exempt from the in-game recap gate, so without this beat
 *  nobody ever sees who took the final trick. */
const FINAL_TRICK_REVEAL_MS = 4000

const playAgainLook =
  'self-center rounded-lg border-2 border-ink bg-trump px-8 py-2.5 font-display font-extrabold uppercase tracking-wider text-white shadow-hard hover:bg-trump-deep hover:no-underline'

export function FinishedView({ view }: { view: GameView }) {
  // The outcome arrives via the terminal SSE event (the finished GET view
  // has no engine/scores). It's stashed in the result cache by the SSE
  // bridge — null on a fresh load of an already-finished game, where the
  // stream never opens (hence the "scores unavailable" fallback below).
  const { data: result } = useQuery(gameResultOptions(view.id))

  const name = (seat: number) => nameBySeat(view.players, seat)

  // Reveal the game's final trick for a beat before the standings. Keyed on a
  // primitive so the auto-advance timer is armed once, not on every render.
  const finalTrick = result?.kind === 'over' ? result.finalTrick : null
  const hasFinalTrick = finalTrick != null
  const [revealDone, setRevealDone] = useState(false)
  useEffect(() => {
    if (!hasFinalTrick) return
    const t = setTimeout(() => setRevealDone(true), FINAL_TRICK_REVEAL_MS)
    return () => clearTimeout(t)
  }, [hasFinalTrick])

  if (finalTrick && !revealDone) {
    return (
      <FinalTrickReveal
        trick={finalTrick}
        players={view.players}
        onSkip={() => setRevealDone(true)}
      />
    )
  }

  if (result?.kind === 'abandoned') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 px-5 py-10 text-center">
        <h2 className="text-3xl">Game abandoned</h2>
        <p className="m-0 font-medium text-mute">{result.reason}</p>
        <Link to="/" className={playAgainLook}>
          Back to start
        </Link>
      </main>
    )
  }

  const scores = result?.kind === 'over' ? result.scores : null
  const winners = result?.kind === 'over' ? result.winners : null
  const standings =
    scores
      ?.map((score, seat) => ({ seat, score }))
      .sort((a, b) => a.score - b.score) ?? []

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 px-5 py-10 text-center">
      <h2 className="text-3xl">Game over</h2>
      {winners && (
        <p className="m-0 rounded-lg border-2 border-ink bg-chip px-5 py-2 font-display text-lg font-extrabold uppercase shadow-hard-sm">
          {winners.map((s) => name(s)).join(' & ')} {winners.length > 1 ? 'win' : 'wins'}
        </p>
      )}
      {standings.length > 0 ? (
        <ol className="m-0 w-full list-none p-0">
          {standings.map((row, i) => {
            const isWinner = winners?.includes(row.seat) ?? false
            const isYou = playerBySeat(view.players, row.seat)?.is_you ?? false
            return (
              <li
                key={row.seat}
                className={`mb-2 flex items-center gap-3 rounded-lg border-2 px-4 py-3 shadow-hard-sm ${
                  isWinner ? 'bg-chip' : 'bg-paper'
                } ${isYou ? 'border-trump' : 'border-ink'}`}
              >
                <span className="w-10 text-left font-display text-3xl font-extrabold tabular-nums">
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-left font-semibold">
                  {isYou ? 'You' : name(row.seat)}
                </span>
                <span className="font-display text-xl font-extrabold tabular-nums">{row.score}</span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="m-0 font-medium text-mute">Final scores are unavailable.</p>
      )}
      <Link to="/" className={playAgainLook}>
        Play again
      </Link>
    </main>
  )
}

/** The game's last showdown, held for a beat before the standings. Purely a
 *  display of the reconstructed final trick (see `GameOutcome.finalTrick`);
 *  the winner's card is ringed and a tap skips straight to the scores. */
function FinalTrickReveal({
  trick,
  players,
  onSkip,
}: {
  trick: CompletedTrickView
  players: PlayerInfo[]
  onSkip: () => void
}) {
  const name = (seat: number) => nameBySeat(players, seat)
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-10 text-center">
      <h2 className="text-3xl">Final trick</h2>
      <div className="flex items-end justify-center gap-3">
        {trick.plays.map((play) => (
          <div key={play.seat} className="flex flex-col items-center gap-1">
            <div className={play.seat === trick.winner ? 'rounded-lg ring-2 ring-trump' : undefined}>
              <PlayingCard card={play.card} size="sm" />
            </div>
            <span className="max-w-16 truncate text-center text-[0.7rem] font-semibold text-mute">
              {name(play.seat)}
            </span>
          </div>
        ))}
      </div>
      <p className="m-0 font-display text-lg font-extrabold uppercase tracking-wide">
        {name(trick.winner)} takes it
      </p>
      <button type="button" className="ghost" onClick={onSkip}>
        See final scores →
      </button>
    </main>
  )
}
