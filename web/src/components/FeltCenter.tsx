import { RoundSummary } from './RoundSummary'
import { TrickArea } from './TrickArea'
import type { CompletedTrickView, EngineView, PendingRecap, PlayerInfo } from '../lib/types'

/** What the middle of the felt is showing, in precedence order: the round's
 *  final showdown gets a beat, then the recap gate parks the table, then a
 *  fresh round hides behind the deal gate, and otherwise the live trick. */
export type FeltStage =
  | { kind: 'finale'; finale: CompletedTrickView }
  | { kind: 'recap'; recap: PendingRecap }
  | { kind: 'deal' }
  | { kind: 'trick' }

interface FeltCenterProps {
  stage: FeltStage
  engine: EngineView
  players: PlayerInfo[]
  nameBySeat: (seat: number) => string
  isHost: boolean
  /** True when the viewer is already up to bid in the next round. */
  myTurnToBid: boolean
  iAmDealer: boolean
  dealing: boolean
  onDeal: () => void
  onContinue: () => void
}

/** The center of the felt, one stage at a time (see FeltStage). */
export function FeltCenter({
  stage,
  engine,
  players,
  nameBySeat,
  isHost,
  myTurnToBid,
  iAmDealer,
  dealing,
  onDeal,
  onContinue,
}: FeltCenterProps) {
  if (stage.kind === 'finale') {
    // The final showdown gets its beat on the felt before the recap covers it.
    return <TrickArea engine={engine} nameBySeat={nameBySeat} finale={stage.finale} />
  }

  if (stage.kind === 'recap') {
    // Round-end recap gate: the table parks here for everyone until the host
    // acknowledges it. Takes precedence over the deal gate (the next round is
    // already dealt server-side; we just hold the reveal). Centered like the
    // deal gate so Flip's math holds.
    return (
      <div className="absolute left-1/2 top-1/2 z-20 flex max-h-[94%] w-[min(92%,24rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto">
        <RoundSummary
          summary={stage.recap}
          players={players}
          canContinue={isHost}
          myTurnToBid={myTurnToBid}
          onContinue={onContinue}
        />
      </div>
    )
  }

  if (stage.kind === 'deal') {
    return (
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
        {iAmDealer ? (
          <>
            <p className="m-0 font-semibold text-paper/85">You’re dealing</p>
            <button type="button" className="primary min-w-36" onClick={onDeal} disabled={dealing}>
              {dealing ? 'Dealing…' : 'Deal'}
            </button>
          </>
        ) : (
          <p className="m-0 font-semibold text-paper/85">
            {engine.round ? `${nameBySeat(engine.round.dealer)} is dealing…` : 'dealing…'}
          </p>
        )}
      </div>
    )
  }

  return <TrickArea engine={engine} nameBySeat={nameBySeat} />
}
