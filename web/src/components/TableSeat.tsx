import { BidBadge } from './BidBadge'
import { Countdown } from './Countdown'
import { DealerButton } from './DealerButton'
import { TricksPile } from './TricksPile'

export interface TableSeatProps {
  name: string
  seat: number
  bid: number | null
  tricks: number
  isAway: boolean
  isActive: boolean
  isDealer: boolean
  isYou?: boolean
  /** Turn deadline, rendered as a ring on the active seat. */
  deadlineInSecs?: number
  /** `ring` = upright block on the felt; `dock` = horizontal strip inside
   *  the action dock (your own seat on small screens). */
  variant?: 'ring' | 'dock'
  /** Tighter paddings/type for crowded tables (6–7 players). */
  compact?: boolean
}

/** A player's presence at the table: name (with the dealer chip when they
 *  deal), bid badge, won-tricks pile, and — when it's their turn — the
 *  countdown ring. The active seat inverts to trump red so whose turn it is
 *  reads at a glance. `data-seat` anchors the deal animation. */
export function TableSeat({
  name,
  seat,
  bid,
  tricks,
  isAway,
  isActive,
  isDealer,
  isYou = false,
  deadlineInSecs,
  variant = 'ring',
  compact = false,
}: TableSeatProps) {
  const hot = isActive && !isAway
  const look = [
    'rounded-lg border-2 border-ink transition-colors duration-200',
    hot ? 'bg-trump text-white animate-seat-pulse' : 'bg-paper text-ink shadow-hard-sm',
    isAway ? 'opacity-55 saturate-50' : '',
    variant === 'ring'
      ? compact
        ? 'flex max-w-[4.8rem] min-w-[3.2rem] flex-col items-center gap-0.5 px-1 py-1'
        : 'flex min-w-[4.6rem] max-w-[7.5rem] flex-col items-center gap-1 px-2 py-1.5'
      : 'flex items-center gap-2.5 px-3 py-1.5',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={look} data-seat={seat} aria-current={isActive ? 'true' : undefined}>
      <span className="flex max-w-full items-center gap-1">
        <span
          className={`truncate font-display font-bold ${compact ? 'text-xs' : 'text-sm'}`}
          title={name}
        >
          {isYou ? 'You' : name}
        </span>
        {isDealer && <DealerButton />}
        {isAway && <span className="text-[0.65rem] font-semibold uppercase opacity-80">away</span>}
      </span>
      <span className="flex items-center gap-1.5">
        <BidBadge bid={bid} active={isActive} />
        <TricksPile count={tricks} size={compact ? 'xs' : 'sm'} />
        {hot && !compact && deadlineInSecs != null && (
          <Countdown deadlineInSecs={deadlineInSecs} active />
        )}
      </span>
    </div>
  )
}
