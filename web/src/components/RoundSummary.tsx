import type { PendingRecap, PlayerInfo } from '../lib/types'

interface RoundSummaryProps {
  summary: PendingRecap
  players: PlayerInfo[]
  /** True when the viewer is the host (creator) and may advance the table. */
  canContinue: boolean
  /** True when the viewer is already up to bid in the next round, so the
   *  recap can warn them the turn clock starts the moment the host clicks. */
  myTurnToBid: boolean
  onContinue: () => void
}

/** Round-end recap shown embedded on the felt (not a modal overlay): bid vs
 *  tricks, score delta and new total per player, and who deals next. The
 *  table holds here for everyone until the host acknowledges it — there is
 *  no local dismissal; the server clears the gate via `round_acknowledged`. */
export function RoundSummary({ summary, players, canContinue, myTurnToBid, onContinue }: RoundSummaryProps) {
  const me = players.find((p) => p.is_you)
  const host = players.find((p) => p.is_creator)
  const nextDealerLine = (() => {
    if (summary.next_dealer == null || summary.next_round_index == null) return null
    const who =
      summary.next_dealer === me?.seat
        ? 'You'
        : (players.find((p) => p.seat === summary.next_dealer)?.display_name ??
          `seat ${summary.next_dealer}`)
    return `${who} deal${who === 'You' ? '' : 's'} round ${summary.next_round_index}`
  })()

  return (
    <section className="round-recap modal__panel" aria-label={`Round ${summary.round_index} complete`}>
      <h3>Round {summary.round_index} complete</h3>
      <table className="scoreboard__table">
        <thead>
          <tr>
            <th>Player</th>
            <th className="num">Bid</th>
            <th className="num">Tricks</th>
            <th className="num">Δ</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.seat} className={p.is_you ? 'is-you' : ''}>
              <td>{p.is_you ? 'You' : p.display_name}</td>
              <td className="num">{summary.bids[p.seat]}</td>
              <td className="num">{summary.tricks_won[p.seat]}</td>
              <td className="num">{formatDelta(summary.deltas[p.seat])}</td>
              <td className="num">{summary.scores[p.seat]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {nextDealerLine && <p className="modal__note muted">{nextDealerLine}</p>}
      {myTurnToBid && <p className="modal__note">You’re up to bid next</p>}
      {canContinue ? (
        <button type="button" className="primary" onClick={onContinue}>
          Continue
        </button>
      ) : (
        <p className="modal__note muted">
          Waiting for {host?.is_you ? 'the host' : (host?.display_name ?? 'the host')} to continue…
        </p>
      )}
    </section>
  )
}

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`
}
