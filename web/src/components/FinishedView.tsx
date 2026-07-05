import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { gameKeys } from '../lib/query'
import type { GameView } from '../lib/types'

type Result =
  | { kind: 'over'; scores: number[]; winners: number[] }
  | { kind: 'abandoned'; reason: string }
  | null

const playAgainLook =
  'self-center rounded-lg border-2 border-ink bg-trump px-8 py-2.5 font-display font-extrabold uppercase tracking-wider text-white shadow-hard hover:bg-trump-deep hover:no-underline'

export function FinishedView({ view }: { view: GameView }) {
  // The outcome arrives via the terminal SSE event (the finished GET view
  // has no engine/scores). It's stashed in the result cache by the SSE bridge.
  const { data: result } = useQuery<Result>({
    queryKey: gameKeys.result(view.id),
    queryFn: async () => null,
    staleTime: Infinity,
    initialData: null,
  })

  const name = (seat: number) =>
    view.players.find((p) => p.seat === seat)?.display_name ?? `seat ${seat}`

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
            const isYou = view.players.find((p) => p.seat === row.seat)?.is_you ?? false
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
