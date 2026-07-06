import { useQuery } from '@tanstack/react-query'

import { formatDelta } from '../lib/format'
import { roundHistoryOptions } from '../lib/query'
import type { GameView } from '../lib/types'

interface ScoreboardProps {
  view: GameView
  onClose?: () => void
}

/** The full score history: one column per player, one row per round, each
 *  cell showing bid · tricks over Δ · running total. Completed rounds come
 *  from the SSE round-history stash (rebuilt from the event replay on
 *  reload); the current round renders live bid/tricks with the rest pending.
 *  Shown in the desktop side panel and the mobile bottom sheet alike. */
export function Scoreboard({ view, onClose }: ScoreboardProps) {
  const engine = view.game
  const players = view.players

  const { data: history } = useQuery(roundHistoryOptions(view.id))

  const round = engine?.round ?? null
  // The live round: not yet in history (its round_completed hasn't fired).
  const liveIndex =
    engine != null && !history.some((r) => r.round_index === engine.round_index)
      ? engine.round_index
      : null

  return (
    <section className="scoreboard" aria-label="Scoreboard">
      <header className="scoreboard__bar">
        <h3>Scores</h3>
        {onClose && (
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </header>
      <table className="scoreboard__table scoreboard__table--rounds">
        <thead>
          <tr>
            <th className="scoreboard__round-col">Rd</th>
            {players.map((p) => (
              <th key={p.seat} className={p.is_you ? 'is-you' : ''}>
                {p.is_you ? 'You' : p.display_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((r) => (
            <tr key={r.round_index}>
              <td className="scoreboard__round-col">{r.round_index}</td>
              {players.map((p) => (
                <td key={p.seat} className={p.is_you ? 'is-you' : ''}>
                  <RoundCell
                    bid={r.bids[p.seat]}
                    tricks={r.tricks_won[p.seat]}
                    delta={r.deltas[p.seat]}
                    total={r.scores[p.seat]}
                  />
                </td>
              ))}
            </tr>
          ))}
          {liveIndex != null && (
            <tr className="scoreboard__live">
              <td className="scoreboard__round-col">{liveIndex}</td>
              {players.map((p) => (
                <td key={p.seat} className={p.is_you ? 'is-you' : ''}>
                  <RoundCell
                    bid={round?.bids[p.seat] ?? null}
                    tricks={round?.tricks_won[p.seat] ?? 0}
                  />
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
      <p className="scoreboard__legend muted">each cell: bid · tricks, then Δ · total</p>
    </section>
  )
}

function RoundCell({
  bid,
  tricks,
  delta,
  total,
}: {
  bid: number | null
  tricks: number
  delta?: number
  total?: number
}) {
  return (
    <span className="round-cell">
      <span className="round-cell__bid">{bid ?? '…'}</span>
      <span className="round-cell__tricks">{tricks}</span>
      {delta != null && total != null ? (
        <>
          <span
            className={`round-cell__delta ${delta > 0 ? 'is-gain' : delta < 0 ? 'is-loss' : ''}`}
          >
            {formatDelta(delta)}
          </span>
          <span className="round-cell__total">{total}</span>
        </>
      ) : (
        <span className="round-cell__pending muted">·</span>
      )}
    </span>
  )
}
